use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

const BRIDGE_PORT_START: u16 = 59300;
const BRIDGE_PORT_RANGE: u16 = 10;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeBridgeInfo {
    pub port: u16,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeChange {
    pub relative_path: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProposalRequest {
    summary: String,
    workspace_path: String,
    changes: Vec<VscodeChange>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRequest {
    decision: String,
    result: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Proposal {
    id: String,
    summary: String,
    workspace_path: String,
    changes: Vec<VscodeChange>,
    status: String,
    result: Option<String>,
    created_at: u128,
}

#[derive(Default)]
pub struct VscodeBridgeState {
    pub port: u16,
    pub token: String,
    proposals: HashMap<String, Proposal>,
}

pub type SharedVscodeBridgeState = Arc<Mutex<VscodeBridgeState>>;

#[tauri::command]
pub async fn get_vscode_bridge_info(
    state: tauri::State<'_, SharedVscodeBridgeState>,
) -> Result<VscodeBridgeInfo, String> {
    let bridge = state.lock().await;
    if bridge.port == 0 || bridge.token.is_empty() {
        return Err("VS Code bridge is not running".to_string());
    }
    Ok(VscodeBridgeInfo {
        port: bridge.port,
        token: bridge.token.clone(),
    })
}

pub async fn start_vscode_bridge(state: SharedVscodeBridgeState) -> Result<VscodeBridgeInfo, String> {
    {
        let bridge = state.lock().await;
        if bridge.port != 0 {
            return Ok(VscodeBridgeInfo {
                port: bridge.port,
                token: bridge.token.clone(),
            });
        }
    }

    let (listener, port) = bind_bridge_listener().await?;
    let token = generate_token();

    {
        let mut bridge = state.lock().await;
        bridge.port = port;
        bridge.token = token.clone();
    }

    log::info!("VS Code bridge listening on 127.0.0.1:{port}");
    let server_state = state.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    let request_state = server_state.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = handle_connection(stream, request_state).await {
                            log::debug!("VS Code bridge request failed: {err}");
                        }
                    });
                }
                Err(err) => {
                    log::warn!("VS Code bridge accept failed: {err}");
                    break;
                }
            }
        }
    });

    Ok(VscodeBridgeInfo { port, token })
}

async fn bind_bridge_listener() -> Result<(TcpListener, u16), String> {
    for port in BRIDGE_PORT_START..BRIDGE_PORT_START.saturating_add(BRIDGE_PORT_RANGE) {
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => return Ok((listener, port)),
            Err(_) => continue,
        }
    }
    Err(format!(
        "No VS Code bridge ports available in {}-{}",
        BRIDGE_PORT_START,
        BRIDGE_PORT_START + BRIDGE_PORT_RANGE - 1
    ))
}

fn generate_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{now:x}-{:x}", std::process::id())
}

async fn handle_connection(
    mut stream: TcpStream,
    state: SharedVscodeBridgeState,
) -> Result<(), String> {
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut read = 0usize;
    let header_end;

    loop {
        let n = stream
            .read(&mut buffer[read..])
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            return Err("client disconnected".to_string());
        }
        read += n;
        if let Some(idx) = find_header_end(&buffer[..read]) {
            header_end = idx;
            break;
        }
        if read == buffer.len() {
            return Err("request too large".to_string());
        }
    }

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines.next().ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let raw_target = request_parts.next().unwrap_or_default().to_string();

    let content_length = header_text
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let body_start = header_end + 4;
    let needed = body_start + content_length;
    while read < needed {
        let n = stream
            .read(&mut buffer[read..])
            .await
            .map_err(|e| format!("body read failed: {e}"))?;
        if n == 0 {
            return Err("client disconnected during body".to_string());
        }
        read += n;
    }
    let body = &buffer[body_start..needed];

    let response = route_request(&method, &raw_target, body, state).await;
    write_json_response(&mut stream, response).await
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn route_request(
    method: &str,
    raw_target: &str,
    body: &[u8],
    state: SharedVscodeBridgeState,
) -> HttpJson {
    let (path, query) = split_target(raw_target);

    if method == "OPTIONS" {
        return HttpJson::ok(serde_json::json!({ "ok": true }));
    }
    if method == "GET" && path == "/health" {
        return HttpJson::ok(serde_json::json!({ "ok": true }));
    }

    if !token_is_valid(query, &state).await {
        return HttpJson::status(401, serde_json::json!({ "error": "Invalid bridge token" }));
    }

    match (method, path.as_str()) {
        ("GET", "/proposals") => list_proposals(state).await,
        ("POST", "/proposals") => create_proposal(body, state).await,
        _ => {
            if method == "GET" && path.starts_with("/proposals/") {
                return get_proposal(path, state).await;
            }
            if method == "POST" && path.starts_with("/proposals/") && path.ends_with("/decision") {
                return decide_proposal(path, body, state).await;
            }
            HttpJson::status(404, serde_json::json!({ "error": "Not found" }))
        }
    }
}

fn split_target(raw_target: &str) -> (String, &str) {
    match raw_target.split_once('?') {
        Some((path, query)) => (path.to_string(), query),
        None => (raw_target.to_string(), ""),
    }
}

async fn token_is_valid(query: &str, state: &SharedVscodeBridgeState) -> bool {
    let requested = query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        if key == "token" {
            Some(value)
        } else {
            None
        }
    });
    let bridge = state.lock().await;
    requested == Some(bridge.token.as_str())
}

async fn list_proposals(state: SharedVscodeBridgeState) -> HttpJson {
    let bridge = state.lock().await;
    let proposals: Vec<_> = bridge.proposals.values().cloned().collect();
    HttpJson::ok(serde_json::json!({ "proposals": proposals }))
}

async fn create_proposal(body: &[u8], state: SharedVscodeBridgeState) -> HttpJson {
    let request = match serde_json::from_slice::<CreateProposalRequest>(body) {
        Ok(request) => request,
        Err(err) => {
            return HttpJson::status(400, serde_json::json!({ "error": err.to_string() }));
        }
    };
    let id = format!("vscode-{}", generate_token());
    let proposal = Proposal {
        id: id.clone(),
        summary: request.summary,
        workspace_path: request.workspace_path,
        changes: request.changes,
        status: "pending".to_string(),
        result: None,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    };
    let mut bridge = state.lock().await;
    bridge.proposals.insert(id.clone(), proposal);
    HttpJson::ok(serde_json::json!({ "id": id }))
}

async fn get_proposal(path: String, state: SharedVscodeBridgeState) -> HttpJson {
    let id = path.trim_start_matches("/proposals/");
    let bridge = state.lock().await;
    match bridge.proposals.get(id) {
        Some(proposal) => HttpJson::ok(serde_json::json!({ "proposal": proposal })),
        None => HttpJson::status(404, serde_json::json!({ "error": "Proposal not found" })),
    }
}

async fn decide_proposal(path: String, body: &[u8], state: SharedVscodeBridgeState) -> HttpJson {
    let id = path
        .trim_start_matches("/proposals/")
        .trim_end_matches("/decision")
        .trim_end_matches('/');
    let request = match serde_json::from_slice::<DecisionRequest>(body) {
        Ok(request) => request,
        Err(err) => {
            return HttpJson::status(400, serde_json::json!({ "error": err.to_string() }));
        }
    };
    let mut bridge = state.lock().await;
    match bridge.proposals.get_mut(id) {
        Some(proposal) => {
            proposal.status = match request.decision.as_str() {
                "approve" | "approved" | "applied" => "approved".to_string(),
                "deny" | "denied" | "reject" => "denied".to_string(),
                other => other.to_string(),
            };
            proposal.result = request.result;
            HttpJson::ok(serde_json::json!({ "ok": true }))
        }
        None => HttpJson::status(404, serde_json::json!({ "error": "Proposal not found" })),
    }
}

struct HttpJson {
    status: u16,
    body: serde_json::Value,
}

impl HttpJson {
    fn ok(body: serde_json::Value) -> Self {
        Self { status: 200, body }
    }

    fn status(status: u16, body: serde_json::Value) -> Self {
        Self { status, body }
    }
}

async fn write_json_response(stream: &mut TcpStream, response: HttpJson) -> Result<(), String> {
    let body = serde_json::to_vec(&response.body)
        .map_err(|e| format!("response serialization failed: {e}"))?;
    let reason = match response.status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        reason,
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|e| format!("response header write failed: {e}"))?;
    stream
        .write_all(&body)
        .await
        .map_err(|e| format!("response body write failed: {e}"))?;
    Ok(())
}
