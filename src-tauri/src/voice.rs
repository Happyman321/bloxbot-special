use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct VoiceState(Mutex<Option<Worker>>);

struct Worker {
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceUpdate {
    partial: String,
    final_text: String,
}

// Node's entry-point resolver rejects Windows verbatim paths returned by Tauri.
// Keep UNC paths valid when removing that prefix.
fn node_path(path: &std::path::Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return std::path::PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return std::path::PathBuf::from(rest);
        }
    }
    path.to_owned()
}

impl Worker {
    async fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let script = resources.join("resources/voice/worker.cjs");
        #[cfg(debug_assertions)]
        let script = {
            let development =
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/voice/worker.cjs");
            if development.exists() {
                development
            } else {
                script
            }
        };
        let node = crate::paths::bundled_nodejs_bin_dir()?.join(if cfg!(windows) {
            "node.exe"
        } else {
            "node"
        });
        let mut command = Command::new(node_path(&node));
        command
            .arg(node_path(&script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start voice engine: {e}"))?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log::warn!(
                        "Voice engine: {}",
                        line.chars().take(1000).collect::<String>()
                    );
                }
            });
        }
        let input = child
            .stdin
            .take()
            .ok_or("Voice input pipe is unavailable")?;
        let output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or("Voice output pipe is unavailable")?,
        );
        let mut worker = Self {
            _child: child,
            input,
            output,
        };
        let ready = tokio::time::timeout(Duration::from_secs(20), worker.read())
            .await
            .map_err(|_| "Voice engine took too long to load. Try again.")??;
        if ready.get("ready").and_then(Value::as_bool) != Some(true) {
            return Err("Voice model could not be loaded. Reinstall BloxBot to restore it.".into());
        }
        log::info!("Local voice model ready");
        Ok(worker)
    }

    async fn read(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        let count = self
            .output
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if count == 0 {
            return Err("Voice engine stopped. Click the microphone to restart it.".into());
        }
        let result: Value =
            serde_json::from_str(&line).map_err(|_| "Invalid voice engine response")?;
        if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(error.to_owned());
        }
        Ok(result)
    }

    async fn request(&mut self, request: Value) -> Result<VoiceUpdate, String> {
        let mut bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        self.input
            .write_all(&bytes)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_value(self.read().await?)
            .map_err(|_| "Invalid voice transcription response".into())
    }
}

async fn request(
    app: &tauri::AppHandle,
    state: &VoiceState,
    value: Value,
) -> Result<VoiceUpdate, String> {
    let session = value
        .get("session")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if session.is_empty() || session.len() > 128 {
        return Err("Invalid voice session".into());
    }
    let mut guard = state.0.lock().await;
    if guard.is_none() {
        *guard = Some(Worker::spawn(app).await?);
    }
    let result = tokio::time::timeout(
        Duration::from_secs(10),
        guard
            .as_mut()
            .ok_or("Voice engine is unavailable")?
            .request(value),
    )
    .await
    .unwrap_or_else(|_| Err("Voice engine stopped responding. Try again.".into()));
    if result
        .as_ref()
        .is_err_and(|error| error != "Voice session is no longer active.")
    {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn voice_prepare(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if guard.is_none() {
        *guard = Some(Worker::spawn(&app).await?);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
    session: String,
) -> Result<VoiceUpdate, String> {
    request(&app, &state, json!({"op":"start", "session":session})).await
}

#[tauri::command]
pub async fn voice_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
    session: String,
    samples: Vec<f32>,
    sample_rate: u32,
) -> Result<VoiceUpdate, String> {
    validate_audio(&samples, sample_rate)?;
    request(
        &app,
        &state,
        json!({"op":"audio", "session":session, "samples":samples, "sampleRate":sample_rate}),
    )
    .await
}

fn validate_audio(samples: &[f32], sample_rate: u32) -> Result<(), String> {
    if samples.len() > 48000
        || !(8000..=96000).contains(&sample_rate)
        || samples.iter().any(|s| !s.is_finite())
    {
        return Err("Invalid microphone audio".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_finish(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
    session: String,
) -> Result<VoiceUpdate, String> {
    request(&app, &state, json!({"op":"finish", "session":session})).await
}

#[tauri::command]
pub async fn voice_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
    session: String,
) -> Result<(), String> {
    request(&app, &state, json!({"op":"cancel", "session":session}))
        .await
        .map(|_| ())
}

pub async fn shutdown(state: &VoiceState) {
    *state.0.lock().await = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn normalizes_tauri_paths_for_node_without_breaking_unc_paths() {
        use std::path::{Path, PathBuf};
        assert_eq!(
            node_path(Path::new(r"\\?\C:\Program Files\BloxBot\worker.cjs")),
            PathBuf::from(r"C:\Program Files\BloxBot\worker.cjs")
        );
        assert_eq!(
            node_path(Path::new(r"\\?\UNC\server\share\worker.cjs")),
            PathBuf::from(r"\\server\share\worker.cjs")
        );
        assert_eq!(
            node_path(Path::new(r"C:\BloxBot\worker.cjs")),
            PathBuf::from(r"C:\BloxBot\worker.cjs")
        );
    }
    #[test]
    fn rejects_invalid_audio_before_sending_to_native_engine() {
        assert!(validate_audio(&[0.0; 2048], 16000).is_ok());
        assert!(validate_audio(&[f32::NAN], 16000).is_err());
        assert!(validate_audio(&[f32::INFINITY], 16000).is_err());
        assert!(validate_audio(&[], 0).is_err());
        assert!(validate_audio(&vec![0.0; 48001], 16000).is_err());
    }
}
