//! OpenCode server management.
//!
//! Starts the OpenCode server as a child process on app launch, waits
//! for it to be ready, then injects the port into the webview so the
//! frontend can connect directly via the OpenCode SDK.
//!
//! If the sidecar can't start, the app exits.

use std::sync::Arc;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstance {
    pub id: String,
    pub name: String,
    pub active: bool,
}

/// BloxBot's reserved port range within the IANA dynamic/private range
/// (49152-65535). The block is 10 ports; the app binds to the first
/// available port in the block.
const OC_PORT_START: u16 = 59200;
const PORT_RANGE: u16 = 10;
const OPENCODE_PLUGINS: &[&str] = &["opencode-gemini-auth@latest"];
const ROBLOX_MCP_REQUEST_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// All servers bind to IPv4 loopback.
pub const LOOPBACK: &str = "127.0.0.1";


// ── State ───────────────────────────────────────────────────────────────

pub struct OpenCodeState {
    pub port: u16,
    pub workspace: String,
    pub(crate) child: Option<CommandChild>,
}

impl Default for OpenCodeState {
    fn default() -> Self {
        Self {
            port: 0,
            workspace: String::new(),
            child: None,
        }
    }
}

pub type SharedOpenCodeState = Arc<Mutex<OpenCodeState>>;

// ── Helpers ─────────────────────────────────────────────────────────────

/// Find the first available TCP port starting from `start`.
async fn find_available_port(start: u16) -> u16 {
    for port in start..start.saturating_add(PORT_RANGE) {
        if tokio::net::TcpListener::bind((LOOPBACK, port))
            .await
            .is_ok()
        {
            return port;
        }
        log::debug!("Port {port} unavailable, skipping");
    }
    log::error!(
        "All ports {start}-{} are unavailable!",
        start.saturating_add(PORT_RANGE - 1)
    );
    start
}

/// Strip the Windows extended-length path prefix (`\\?\`).
#[cfg(windows)]
fn strip_win_prefix(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

// ── Studio MCP binary resolution ────────────────────────────────────────

fn studio_mcp_command() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        vec!["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP".to_string()]
    }
    #[cfg(target_os = "windows")]
    {
        let local_app = dirs::data_local_dir()
            .map(|p| p.join("Roblox").join("mcp.bat"))
            .unwrap_or_else(|| {
                std::path::PathBuf::from(r"C:\Users\Default\AppData\Local\Roblox\mcp.bat")
            });
        vec![
            "cmd.exe".to_string(),
            "/c".to_string(),
            local_app.to_string_lossy().to_string(),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec!["studio-mcp".to_string()]
    }
}

fn mcp_servers_config(
    studio_mcp_cmd: Vec<String>,
    vscode_mcp_cmd: Vec<String>,
    vscode_bridge: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "roblox-studio": {
            "type": "local",
            "command": studio_mcp_cmd,
            "enabled": true,
            "timeout": ROBLOX_MCP_REQUEST_TIMEOUT_MS
        },
        "bloxbot-vscode": {
            "type": "local",
            "command": vscode_mcp_cmd,
            "environment": vscode_bridge.clone(),
            "env": vscode_bridge,
            "enabled": true
        }
    })
}

fn vscode_mcp_command(nodejs_bin_dir: &std::path::Path) -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    let node_path = nodejs_bin_dir.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let node_path = nodejs_bin_dir.join("node");

    let server_path = crate::paths::bundled_vscode_mcp_server_path()?;

    #[cfg(target_os = "windows")]
    let node = strip_win_prefix(&node_path);
    #[cfg(not(target_os = "windows"))]
    let node = node_path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let server = strip_win_prefix(&server_path);
    #[cfg(not(target_os = "windows"))]
    let server = server_path.to_string_lossy().to_string();

    Ok(vec![node, server])
}

// ── Startup cleanup ─────────────────────────────────────────────────────

/// Kill any stale processes listening on our reserved port range.
pub fn cleanup_stale_processes() {
    let start = OC_PORT_START;
    let end = OC_PORT_START + PORT_RANGE;
    log::info!("Checking for stale processes on ports {start}-{}", end - 1);

    #[cfg(unix)]
    {
        let mut killed = 0u32;
        for port in start..end {
            let output = std::process::Command::new("lsof")
                .args(["-ti", &format!("tcp:{port}")])
                .output();

            if let Ok(out) = output {
                let pids = String::from_utf8_lossy(&out.stdout);
                for pid_str in pids.split_whitespace() {
                    if let Ok(pid) = pid_str.trim().parse::<u32>() {
                        log::info!("Killing stale process PID {pid} on port {port}");
                        let _ = std::process::Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                        killed += 1;
                    }
                }
            }
        }
        if killed > 0 {
            log::info!("Killed {killed} stale process(es)");
        } else {
            log::info!("No stale processes found");
        }
    }

    #[cfg(windows)]
    {
        let output = std::process::Command::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for port in start..end {
                let needle = format!("{}:{}", LOOPBACK, port);
                for line in text.lines() {
                    if line.contains(&needle) && line.contains("LISTENING") {
                        if let Some(pid_str) = line.split_whitespace().last() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                if pid > 0 {
                                    log::info!("Killing stale process PID {pid} on port {port}");
                                    let _ = std::process::Command::new("taskkill")
                                        .args(["/F", "/PID", &pid.to_string()])
                                        .output();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Tauri command ───────────────────────────────────────────────────────

/// Returns the OpenCode server port and workspace directory.
/// Called by the frontend to create the SDK client.
#[tauri::command]
pub async fn get_opencode_info(
    state: tauri::State<'_, SharedOpenCodeState>,
) -> Result<(u16, String), String> {
    let s = state.lock().await;
    if s.port == 0 {
        return Err("OpenCode is not running".to_string());
    }
    Ok((s.port, s.workspace.clone()))
}

#[tauri::command]
pub async fn list_roblox_studios(
    state: tauri::State<'_, SharedOpenCodeState>,
) -> Result<Vec<StudioInstance>, String> {
    let response = call_studio_bridge(&state, reqwest::Method::GET, None).await?;
    parse_studio_instances(&response)
}

#[tauri::command]
pub async fn set_active_roblox_studio(
    state: tauri::State<'_, SharedOpenCodeState>,
    studio_id: String,
) -> Result<(), String> {
    let studio_id = studio_id.trim();
    if studio_id.is_empty() {
        return Err("Studio ID cannot be empty".to_string());
    }
    call_studio_bridge(&state, reqwest::Method::POST, Some(studio_id)).await?;
    Ok(())
}

// ── Core lifecycle ──────────────────────────────────────────────────────

/// Start the OpenCode server. Called automatically on app launch.
pub async fn start_opencode_server(
    state: SharedOpenCodeState,
    app: AppHandle,
) -> Result<u16, String> {
    // Guard: don't double-start
    {
        let current = state.lock().await;
        if current.child.is_some() {
            return Ok(current.port);
        }
    }

    let nodejs_bin_dir = crate::paths::bundled_nodejs_bin_dir()?;
    log::info!("Node.js bin: {}", nodejs_bin_dir.display());

    let port = do_start(&state, &app, &nodejs_bin_dir).await?;

    // Store workspace in state so the frontend can retrieve it via command
    let workspace = crate::paths::workspace_dir()?;
    {
        let mut s = state.lock().await;
        s.workspace = workspace.to_string_lossy().to_string();
    }

    Ok(port)
}

/// Inner startup logic.
async fn do_start(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    nodejs_bin_dir: &std::path::Path,
) -> Result<u16, String> {
    cleanup_stale_processes();
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    let port = find_available_port(OC_PORT_START).await;
    log::info!("OpenCode port: {port}");

    {
        let mut s = state.lock().await;
        s.port = port;
    }

    let studio_mcp_cmd = studio_mcp_command();
    log::info!("Studio MCP command: {:?}", studio_mcp_cmd);
    let vscode_mcp_cmd = vscode_mcp_command(nodejs_bin_dir)?;
    log::info!("VS Code MCP command: {:?}", vscode_mcp_cmd);
    let vscode_bridge = {
        let bridge = app
            .state::<crate::vscode_bridge::SharedVscodeBridgeState>()
            .inner()
            .lock()
            .await;
        serde_json::json!({
            "BLOXBOT_VSCODE_BRIDGE_URL": format!("http://{}:{}", LOOPBACK, bridge.port),
            "BLOXBOT_VSCODE_BRIDGE_TOKEN": bridge.token.clone(),
        })
    };

    let mcp_config = serde_json::json!({
        "plugin": OPENCODE_PLUGINS,
        "mcp": mcp_servers_config(studio_mcp_cmd, vscode_mcp_cmd, vscode_bridge),
        "default_agent": "studio",
        "agent": {
            "build": {
                "description": "Executes tools based on the conversation"
            },
            "studio": {
                "mode": "primary",
                "description": "Roblox Studio development assistant",
                "permission": {
                    "read": "deny",
                    "grep": "deny",
                    "glob": "deny",
                    "list": "deny",
                    "bash": "deny",
                    "edit": "deny",
                    "task": "deny",
                    "todowrite": "deny"
                },
                "prompt": concat!(
                    "You are BloxBot, an expert Roblox game developer working directly inside Roblox Studio via the official built-in MCP server. ",
                    "You build games by using MCP tools to read, write, and execute code in the live Studio session — never by showing code snippets for the user to paste.\n\n",

                    "## Environment Boundary\n",
                    "The user's Roblox project lives in the connected Roblox Studio DataModel, not in BloxBot's local app directory, OpenCode internals, package sources, or the user's PC filesystem. ",
                    "When working on a Roblox game, do not use `dir`, PowerShell, shell commands, local file reads, local grep/glob/list, package-source inspection, or BloxBot/OpenCode files to understand or debug the game. ",
                    "Use Roblox Studio MCP tools for project exploration, script reads/searches, edits, verification, and debugging.\n\n",

                    "## Tool Error Recovery\n",
                    "If a Roblox MCP tool returns a schema, type, or argument-shape error, correct the MCP tool call and retry once with valid arguments. ",
                    "If the correct call shape is unclear, use another Roblox MCP tool or ask the user for the missing detail. ",
                    "If a Roblox MCP tool returns `-32001 Request timed out`, treat it as an operation timeout, not proof that Studio is closed or disconnected. ",
                    "Call `get_studio_state` once to check the connection. If Studio responds, retry once with a narrower task or complete focused verification with direct Studio tools; do not repeat the same broad timed-out call unchanged. ",
                    "Studio discovery is eventually consistent: one empty or failed `list_roblox_studios` response does not prove Studio is disconnected. Retry `list_roblox_studios` once before drawing a conclusion. If the retry finds a Studio, continue normally without mentioning the transient miss. If the retry is still empty or fails, call `get_studio_state` once. ",
                    "Only ask the user to verify or reconnect Studio when the discovery retry and `get_studio_state` both fail. ",
                    "Do not pivot to local filesystem, package-source, shell, PowerShell, or BloxBot/OpenCode internals to debug Roblox MCP tool errors.\n\n",

                    "## Workflow\n",
                    "1. **Explore first.** Use `search_game_tree` (depth 5-10), `inspect_instance`, `script_search`, and `script_read` to understand the project before changing anything. Never guess at paths or names.\n",
                    "2. **Edit with tools.** Use `multi_edit` for script changes and `execute_luau` for instance creation, property changes, and batch operations. Never tell the user to paste code.\n",
                    "3. **Verify after.** Re-read scripts with `script_read` and confirm DataModel changes with `inspect_instance` or `search_game_tree`.\n",
                    "4. **Debug with playtests.** Instrument code → `start_stop_play(\"start\")` → simulate input or ask the user to act → `console_output()` + `execute_luau` to probe live state → `start_stop_play(\"stop\")` → fix → repeat.\n\n",

                    "## Project Awareness\n",
                    "At the start of a session, scan the Roblox Studio DataModel and scripts through MCP to learn the game's architecture. Use `search_game_tree` with high depth, then read key scripts with `script_read`. Identify:\n",
                    "- **Frameworks**: Knit, AeroGameFramework, Rojo, Nevermore, Fusion, Roact/React-lua, Rodux, ProfileService, DataStore2, etc. All new code must follow existing patterns.\n",
                    "- **Folder conventions**: How are scripts organized? Place new code where it belongs.\n",
                    "- **Module patterns**: Return table, OOP metatables, functional? Match the style.\n",
                    "- **Communication patterns**: Direct RemoteEvents, or wrapped (Knit, BridgeNet2, Red)? Use the same approach.\n",
                    "- **Naming conventions**: PascalCase, camelCase, prefix systems? Be consistent.\n\n",
                    "Carry this context throughout the session. Do not introduce new frameworks or architectural styles unless the user explicitly asks.\n\n",

                    "## Tool Guide\n\n",

                    "### Scripts\n",
                    "- `script_read(path)` — Read script content using dot-notation (e.g. `game.ServerScriptService.MyScript`). Supports `start_line`/`end_line` for ranges. Always read before editing.\n",
                    "- `multi_edit(path, edits[])` — Atomic sequential edits using exact string matching. Copy the exact text from `script_read` output as the match target. Prefer narrow, targeted edits over full rewrites. Can create new scripts if the path doesn't exist.\n",
                    "- `script_search(query)` — Fuzzy search script names (max 10 results).\n",
                    "- `script_grep(pattern)` — Search all script contents for a string pattern (max 50 matches). Use to find references, remote names, API usage.\n\n",

                    "### Data Model\n",
                    "- `explore_subagent(objective)` - Read-only investigation of larger places. Use when the project is broad enough that parallel exploration will save time, not for tiny targeted changes.\n",
                    "- `search_game_tree(path?, instance_type?, keyword?, depth?)` — Explore the instance hierarchy as flat JSON. Default depth 3, max 10.\n",
                    "- `inspect_instance(path)` — All readable properties, custom attributes, children count, descendants. Always inspect before modifying properties via Luau.\n\n",

                    "### Code Execution\n",
                    "`execute_luau(code)` — Execute Luau directly in Studio. This is your primary tool for:\n",
                    "- **Creating instances**: `Instance.new(\"Part\", workspace)`\n",
                    "- **Setting properties**: `workspace.Part.Color = Color3.new(1, 0, 0)`\n",
                    "- **Batch operations**: Updating many objects, building folder structures, migrations\n",
                    "- **Runtime inspection**: Querying live state during playtests\n",
                    "- **Anything the focused tools don't cover**\n\n",
                    "Keep `execute_luau` code minimal and explicit. Print or return confirmation data. Prefer idempotent operations.\n\n",

                    "### Playtesting & Debugging\n",
                    "- `screen_capture()` - Capture the current Studio viewport during playtests when visual state matters.\n",
                    "- `playtest_subagent(objective)` - Run heavier gameplay scenario testing. Use for risky, multi-system, visual, physics, networking, economy, combat, save-data, or regression-prone changes.\n",
                    "- `start_stop_play(\"start\")` / `start_stop_play(\"stop\")` — Start/stop playtesting.\n",
                    "- `console_output()` — Retrieve console logs. Check immediately after starting a playtest or triggering a feature.\n",
                    "- **Always stop playtesting before making structural edits** to ensure changes persist in the Edit session.\n\n",
                    "Debug loop:\n",
                    "1. Add strategic print/warn statements to trace execution\n",
                    "2. Start playtest\n",
                    "3. Trigger the behavior — use input simulation or ask the user\n",
                    "4. `console_output()` to read logs + `execute_luau` to probe live state\n",
                    "5. Stop playtest\n",
                    "6. Apply minimal fix\n",
                    "7. Repeat until resolved\n\n",

                    "### Input Simulation\n",
                    "Use during active playtests to validate gameplay and UI:\n",
                    "- `character_navigation(target)` — Move player to a position or instance path\n",
                    "- `keyboard_input(action, key)` — Key presses, holds, text input\n",
                    "- `mouse_input(action, position?)` — Clicks, movement, scrolling\n\n",

                    "### Restricted Asset Generation\n",
                    "- `generate_mesh(prompt)` - Generate a textured 3D mesh only when the user directly asks for generated mesh/model assets.\n",
                    "- `generate_material(prompt)` - Generate a custom material or texture only when the user directly asks for generated materials/textures.\n",
                    "- `generate_procedural_model(prompt)` - Generate a procedural model only when the user directly asks for generated procedural content.\n",
                    "- `insert_from_creator_store(query_or_asset)` - Insert Creator Store assets only when the user directly asks to insert something from Creator Store.\n",
                    "Do not use generation or Creator Store insertion tools as part of normal exploration, building, debugging, or verification. For ordinary work, use DataModel/script tools and `execute_luau`.\n\n",
                    "### Session Management\n",

                    "- `list_roblox_studios()` — List connected Studio instances\n",
                    "- `set_active_studio(studio_id)` — Target a specific instance before making changes\n",
                    "- If BloxBot says a Studio target is already active, use it directly without listing Studios or selecting it again.\n\n",

                    "## MicroProfiler / LibMP\n",
                    "Use `execute_luau` to inspect MicroProfiler data through LibMP when the user asks about frame spikes, FPS drops, CPU/GPU bottlenecks, memory allocation, or profiling. ",
                    "For Studio MCP and Assistant-style workflows, use `require(\"@rbx/LibMP\")`. ",
                    "Prefer paused or snapshotted MicroProfiler captures for deeper analysis so the dataset stays stable while you inspect frames, threads, timers, groups, and counters. ",
                    "Do not force a switch to Play mode if the user already has static MicroProfiler data captured. ",
                    "When mentioning profiler frames, report both the regular frame ID and absolute frame ID so the user can find the frame programmatically and in the UI.\n\n",

                    "## Proportional Verification\n",
                    "Always verify changes, but scale verification to the risk and blast radius. ",
                    "For small low-risk changes, such as numeric tuning, copy text, simple property edits, or narrowly scoped script changes, use focused `script_read`, `inspect_instance`, `search_game_tree`, or a light playtest only when useful. ",
                    "Do not turn every tiny edit into a long playtest loop or subagent run unless the user explicitly asks for exhaustive validation. ",
                    "Use `screen_capture`, `playtest_subagent`, broader playtesting, and extra regression checks for risky, visual, multi-system, physics, networking, economy, combat, save-data, or regression-prone changes.\n\n",

                    "## Roblox Architecture\n\n",

                    "**DataModel**: game → Services → Instances. Key services:\n",
                    "- `Workspace` — 3D world. BaseParts, Models, Terrain, Camera. Replicated.\n",
                    "- `ServerScriptService` — Server Scripts. Never accessible from client.\n",
                    "- `ServerStorage` — Server-only assets and data. Not replicated.\n",
                    "- `ReplicatedStorage` — Shared modules, RemoteEvents, RemoteFunctions, assets.\n",
                    "- `StarterPlayerScripts` / `StarterCharacterScripts` — LocalScripts cloned per player.\n",
                    "- `StarterGui` — ScreenGuis/LocalScripts cloned to PlayerGui.\n",
                    "- `Players`, `Lighting`, `SoundService` — as named.\n",
                    "- Access all services via `:GetService()`.\n\n",

                    "**Client-server model**: Server is authoritative. Clients see a replicated subset. Communicate via RemoteEvents (fire-and-forget) and RemoteFunctions (request-response). ",
                    "**Never trust the client.** Validate all inputs server-side.\n\n",

                    "**Script types**: `Script` (server), `LocalScript` (client), `ModuleScript` (shared via `require()`). Place them in the correct service.\n\n",

                    "## Luau Style\n",
                    "- Idiomatic Luau: type annotations, string interpolation, `if-then-else` expressions.\n",
                    "- Descriptive names: `player` not `p`, `character` not `char`, `humanoid` not `hum`.\n",
                    "- PascalCase for services/instances/properties/methods. camelCase for locals.\n",
                    "- `:GetService()` for services. `:WaitForChild()` on client for instances that may not have replicated.\n",
                    "- `task.spawn`, `task.defer`, `task.delay`, `task.wait` — never legacy `spawn`/`wait`/`delay`.\n",
                    "- Clean up: disconnect connections, destroy clones, cancel threads.\n\n",

                    "## Safety\n",
                    "- Never overwrite large scripts unless necessary. Prefer targeted `multi_edit`.\n",
                    "- Never invent paths, remotes, or instances without verifying they exist.\n",
                    "- Never claim a fix works until verified with `script_read`, `inspect_instance`, or playtesting.\n",
                    "- If a change is risky or destructive, say so and proceed carefully.\n\n",

                    "## Communication\n",
                    "Be concise and practical. State what you did, not how to do it — the tools already did it. ",
                    "Explain *why* when it's non-obvious. When console errors appear, immediately read the relevant script to diagnose. ",
                    "If a request is outside what the tools can do (publishing, Team Create, marketplace), say so clearly.\n\n",

                    "## MCP Connection Issues\n",
                    "Never report Studio as disconnected from one empty discovery result, one failed tool call, or one timeout. Follow the recovery steps above first. ",
                    "Ask the user to verify Studio is running with MCP enabled only after the single discovery retry and `get_studio_state` both fail. ",
                    "When that confirmation is necessary, tell the user: \"Roblox Studio must be open and configured. See https://create.roblox.com/docs/studio/mcp\"."
                )
            },
            "vscode-workspace": {
                "mode": "primary",
                "description": "Plan-first VS Code workspace assistant with Studio context.",
                "permission": {
                    "read": "deny",
                    "grep": "deny",
                    "glob": "deny",
                    "list": "deny",
                    "bash": "deny",
                    "edit": "deny",
                    "task": "deny",
                    "todowrite": "allow"
                },
                "prompt": concat!(
                    "You are BloxBot's VS Code Workspace assistant. You help move Roblox-related code and project files into the user's configured VS Code project folder while still using Roblox Studio MCP for context.\n\n",
                    "## Default posture\n",
                    "Start in a plan/review mindset. Explain the intended file changes before proposing edits. Use todos for multi-step work. ",
                    "When Roblox Studio context matters, inspect the DataModel and scripts through the Roblox Studio MCP tools. Studio MCP is available for context, but avoid Studio mutations unless the user explicitly asks for them.\n\n",
                    "## File workflow\n",
                    "For VS Code project files, use the `bloxbot-vscode` MCP tools. Do not use local shell, local filesystem read/list/grep, or generic edit tools for project files. ",
                    "Read/search through the VS Code MCP tools, then call the proposal tool with complete target file contents. The VS Code extension will show the changes to the user and apply only approved edits.\n\n",
                    "## Safety\n",
                    "Treat the configured VS Code folder as the project boundary. Never propose writes outside it. If the VS Code companion is disconnected or a proposal is denied, report that clearly and continue with planning or explanation. ",
                    "Do not claim files changed until the VS Code bridge reports approval."
                )
            },
            "dictator": {
                "mode": "primary",
                "description": "Plans high-level requests, coordinates worker subagents, and reports progress.",
                "permission": {
                    "task": {
                        "*": "deny",
                        "dictator-*": "allow"
                    },
                    "todowrite": "allow",
                    "edit": "ask",
                    "bash": "ask",
                    "question": "allow"
                },
                "prompt": concat!(
                    "You are The Dictator, BloxBot's orchestration agent. The user gives you high-level game or app goals. ",
                    "Your job is to plan, divide, coordinate, and verify work through worker subagents while protecting the project from conflicts.\n\n",
                    "## Mandatory workflow\n",
                    "1. First respond with a concrete plan, task list, worker allocation, ownership boundaries, risks, and an explicit request for UI approval.\n",
                    "2. Do not invoke the Task tool or create worker subagents until the user has approved the plan. Approval will arrive as a message beginning with `[Dictator Plan Approved]`.\n",
                    "3. After approval, dispatch independent workers in parallel whenever their ownership scopes are disjoint. Do not serialize read-only exploration work unless one task truly depends on another.\n",
                    "4. Assign every worker a narrow, disjoint ownership scope. Include files, Roblox services, instance paths, or systems they may touch.\n",
                    "5. Treat Roblox Studio/DataModel mutation as a single write lane unless the approval message explicitly allows more write workers.\n",
                    "6. Track progress with todos. Update todos as tasks move from pending to in progress to completed.\n",
                    "7. Synthesize worker results, resolve conflicts, and run a final review before claiming completion.\n\n",
                    "## Worker usage\n",
                    "- Use `dictator-explorer` for read-only investigation.\n",
                    "- Use `dictator-worker` for tightly scoped implementation.\n",
                    "- Use `dictator-reviewer` for final review and integration checks.\n",
                    "- Never ask two workers to edit the same file, script, Roblox service, or instance subtree at the same time.\n",
                    "- Give every Task a concrete description like `Inspect Studio hierarchy`, `Build shared inventory module`, or `Review final integration`; never use generic descriptions like `dictator-worker`.\n\n",
                    "## Communication\n",
                    "Be direct and operational. Show the plan and status clearly. Ask for clarification only when the missing detail changes the build."
                )
            },
            "dictator-explorer": {
                "mode": "subagent",
                "hidden": true,
                "description": "Read-only investigation worker for Dictator Mode.",
                "permission": {
                    "read": "allow",
                    "grep": "allow",
                    "glob": "allow",
                    "list": "allow",
                    "bash": {
                        "*": "deny",
                        "git status*": "allow",
                        "rg *": "allow"
                    },
                    "edit": "deny",
                    "task": "deny",
                    "todowrite": "deny"
                },
                "prompt": concat!(
                    "You are a Dictator Mode read-only explorer. Investigate only the assigned scope. ",
                    "Do not modify files or Roblox Studio state. Return concise findings, relevant paths, risks, and recommended next steps."
                )
            },
            "dictator-worker": {
                "mode": "subagent",
                "hidden": true,
                "description": "Scoped implementation worker for Dictator Mode.",
                "permission": {
                    "task": "deny",
                    "todowrite": "deny",
                    "edit": "ask",
                    "bash": "ask"
                },
                "prompt": concat!(
                    "You are a Dictator Mode implementation worker. You are not alone in the project. ",
                    "Only work inside your assigned ownership scope. Do not revert or overwrite work from other workers. ",
                    "Explore before editing, keep changes minimal, verify what you changed, and report changed paths plus any conflicts or follow-up risks."
                )
            },
            "dictator-reviewer": {
                "mode": "subagent",
                "hidden": true,
                "description": "Final review worker for Dictator Mode.",
                "permission": {
                    "read": "allow",
                    "grep": "allow",
                    "glob": "allow",
                    "list": "allow",
                    "bash": {
                        "*": "ask",
                        "git status*": "allow",
                        "rg *": "allow"
                    },
                    "edit": "deny",
                    "task": "deny",
                    "todowrite": "deny"
                },
                "prompt": concat!(
                    "You are a Dictator Mode reviewer. Review the finished work for bugs, conflicts, missing verification, and scope drift. ",
                    "Do not make changes. Report findings by severity with exact files, scripts, or Roblox instance paths when available."
                )
            }
        }
    });
    let config_content = serde_json::to_string_pretty(&mcp_config)
        .map_err(|e| format!("Failed to serialize OpenCode config: {e}"))?;

    log::debug!("Config: {config_content}");

    let workspace = crate::paths::workspace_dir()?;

    // Create isolated XDG directories under ~/BloxBot/.opencode/
    let opencode_home = workspace.join(".opencode");
    let xdg_data = opencode_home.join("data");
    let xdg_config = opencode_home.join("config");
    let xdg_cache = opencode_home.join("cache");
    let xdg_state = opencode_home.join("state");

    for dir in [&xdg_data, &xdg_config, &xdg_cache, &xdg_state] {
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create directory {}: {e}", dir.display()))?;
        }
    }

    let config_dir = xdg_config.join("opencode");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    let config_file = config_dir.join("opencode.json");
    std::fs::write(&config_file, &config_content)
        .map_err(|e| format!("Failed to write OpenCode config: {e}"))?;
    log::info!("Wrote OpenCode config to {}", config_file.display());

    let sidecar_dir = crate::paths::sidecar_dir()?;

    #[cfg(unix)]
    let nodejs_bin = nodejs_bin_dir.to_string_lossy().to_string();
    #[cfg(windows)]
    let nodejs_bin = strip_win_prefix(nodejs_bin_dir);

    #[cfg(unix)]
    let sidecar_path_str = sidecar_dir.to_string_lossy().to_string();
    #[cfg(windows)]
    let sidecar_path_str = strip_win_prefix(&sidecar_dir);

    #[cfg(unix)]
    let minimal_path = format!(
        "{}:{}:/usr/bin:/bin:/usr/sbin:/sbin",
        nodejs_bin, sidecar_path_str
    );
    #[cfg(windows)]
    let minimal_path = format!(
        "{};{};C:\\Windows\\System32;C:\\Windows",
        nodejs_bin, sidecar_path_str
    );

    let (rx, child) = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| {
            let msg = format!("Failed to create sidecar command: {e}");
            log::error!("{msg}");
            msg
        })?
        .args([
            "serve",
            "--port",
            &port.to_string(),
            "--hostname",
            LOOPBACK,
            "--print-logs",
            "--log-level",
            "DEBUG",
        ])
        .current_dir(&workspace)
        .env("XDG_DATA_HOME", &xdg_data)
        .env("XDG_CONFIG_HOME", &xdg_config)
        .env("XDG_CACHE_HOME", &xdg_cache)
        .env("XDG_STATE_HOME", &xdg_state)
        .env("PATH", &minimal_path)
        .spawn()
        .map_err(|e| {
            let msg = format!("Failed to start OpenCode server: {e}");
            log::error!("{msg}");
            msg
        })?;

    log::info!("Isolated environment: {}", opencode_home.display());
    log::debug!("PATH: {}", minimal_path);

    {
        let mut s = state.lock().await;
        s.child = Some(child);
    }

    // Spawn event handler for stdout, stderr, and process exit.
    spawn_event_handler(rx, Arc::clone(state), app.clone());

    // Wait for the HTTP server to be ready.
    // Use /global/health instead of /session — the health endpoint responds
    // immediately while /session triggers full bootstrapping (Bun plugin
    // installation, project init, LSP setup) that can hang on slow networks
    // or when antivirus intercepts downloads. The frontend handles the
    // "still bootstrapping" state via its own polling.
    let health_url = format!("http://{LOOPBACK}:{port}/global/health");
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Check if the process already exited.
        {
            let s = state.lock().await;
            if s.child.is_none() {
                let err = "OpenCode process exited before becoming ready".to_string();
                log::error!("{err}");
                return Err(err);
            }
        }

        match http_client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                log::info!("Server ready on port {port} (status {})", resp.status());
                return Ok(port);
            }
            Ok(resp) => {
                log::debug!("Health check returned non-success status: {}", resp.status());
            }
            Err(_) => {
                log::trace!("Server not ready yet, retrying...");
            }
        }
    }
}

async fn call_studio_bridge(
    state: &SharedOpenCodeState,
    method: reqwest::Method,
    studio_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let (port, workspace) = {
        let state = state.lock().await;
        if state.port == 0 {
            return Err("OpenCode is not running".to_string());
        }
        (state.port, state.workspace.clone())
    };
    let suffix = if studio_id.is_some() { "/active" } else { "" };
    let mut url = reqwest::Url::parse(&format!(
        "http://{LOOPBACK}:{port}/mcp/roblox-studio/studios{suffix}"
    ))
    .map_err(|e| format!("Failed to build Studio picker bridge URL: {e}"))?;
    url.query_pairs_mut().append_pair("directory", &workspace);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create Studio bridge client: {e}"))?;
    let mut request = client.request(method, url);
    if let Some(studio_id) = studio_id {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "studioId": studio_id }).to_string());
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Studio picker bridge unavailable: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Studio picker bridge response: {e}"))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .or_else(|| value.get("error"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.trim().to_string());
        return Err(if detail.is_empty() {
            format!("Studio picker bridge returned {status}")
        } else {
            format!("Studio picker bridge returned {status}: {detail}")
        });
    }
    serde_json::from_str(&body).map_err(|e| format!("Malformed Studio picker bridge response: {e}"))
}

fn parse_studio_instances(value: &serde_json::Value) -> Result<Vec<StudioInstance>, String> {
    let mut studios = Vec::new();
    let mut found_list = false;
    collect_studio_instances(value, &mut studios, &mut found_list)?;
    if found_list {
        Ok(studios)
    } else {
        Err("Studio picker bridge returned no Studio list".to_string())
    }
}

fn collect_studio_instances(
    value: &serde_json::Value,
    studios: &mut Vec<StudioInstance>,
    found_list: &mut bool,
) -> Result<(), String> {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                collect_studio_instances(item, studios, found_list)?;
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(items) = obj.get("studios") {
                let items = items.as_array().ok_or_else(|| {
                    "Studio picker response has a non-array studios field".to_string()
                })?;
                *found_list = true;
                for item in items {
                    let map = item.as_object().ok_or_else(|| {
                        "Studio picker response contains a malformed Studio".to_string()
                    })?;
                    let id = studio_id_from_object(map).ok_or_else(|| {
                        "Studio picker response contains a Studio without an ID".to_string()
                    })?;
                    if !studios.iter().any(|studio| studio.id == id) {
                        studios.push(StudioInstance {
                            name: studio_name_from_object(map)
                                .unwrap_or_else(|| format!("Studio {id}")),
                            active: map
                                .get("active")
                                .and_then(serde_json::Value::as_bool)
                                .unwrap_or(false),
                            id,
                        });
                    }
                }
            }
            for item in obj.values() {
                collect_studio_instances(item, studios, found_list)?;
            }
        }
        serde_json::Value::String(text) => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
                collect_studio_instances(&parsed, studios, found_list)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn studio_id_from_object(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    for key in [
        "studio_id",
        "studioId",
        "studioid",
        "instance_id",
        "instanceId",
        "instanceid",
        "id",
    ] {
        if let Some(id) = normalize_studio_id(map.get(key)) {
            return Some(id);
        }
    }
    None
}

fn studio_name_from_object(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    for key in [
        "name",
        "label",
        "title",
        "place_name",
        "placeName",
        "project_name",
    ] {
        if let Some(name) = map.get(key).and_then(serde_json::Value::as_str) {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn normalize_studio_id(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(id)) => {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(serde_json::Value::Number(id)) => Some(id.to_string()),
        _ => None,
    }
}

/// Spawn an event handler task for stdout/stderr/exit.
fn spawn_event_handler(
    rx: tauri::async_runtime::Receiver<CommandEvent>,
    state: SharedOpenCodeState,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::error!("Failed to build tokio runtime for event handler: {e}");
                return;
            }
        };

        rt.block_on(async move {
            process_events(rx, &state, &app).await;
        });
    });
}

/// Sidecar stderr lines matching these are high-frequency noise.
const NOISY_PATTERNS: &[&str] = &[
    "path=/mcp request",
    "path=/global/health request",
    "service=server method=",
    "service=server status=",
    "service=bus type=",
    "service=tool.registry",
    "service=permission",
];

fn parse_sidecar_level(line: &str) -> log::Level {
    let trimmed = line.trim_start();
    if trimmed.starts_with("ERROR") {
        log::Level::Error
    } else if trimmed.starts_with("WARN") {
        log::Level::Warn
    } else if trimmed.starts_with("DEBUG") {
        log::Level::Debug
    } else if trimmed.starts_with("INFO") {
        log::Level::Info
    } else {
        log::Level::Warn
    }
}

fn is_noisy_sidecar_line(line: &str) -> bool {
    NOISY_PATTERNS.iter().any(|p| line.contains(p))
}

async fn process_events(
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    state: &SharedOpenCodeState,
    app: &AppHandle,
) {
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim_end();
                if is_noisy_sidecar_line(trimmed) {
                    log::trace!(target: "opencode::stdout", "{trimmed}");
                } else {
                    log::info!(target: "opencode::stdout", "{trimmed}");
                }
            }
            CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim_end();
                if trimmed.is_empty() {
                    continue;
                }
                if is_noisy_sidecar_line(trimmed) {
                    log::trace!(target: "opencode::stderr", "{trimmed}");
                } else {
                    match parse_sidecar_level(trimmed) {
                        log::Level::Error => {
                            log::error!(target: "opencode::stderr", "{trimmed}")
                        }
                        log::Level::Warn => log::warn!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Info => log::info!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Debug => {
                            log::debug!(target: "opencode::stderr", "{trimmed}")
                        }
                        _ => log::debug!(target: "opencode::stderr", "{trimmed}"),
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                handle_process_exit(state, app, &payload).await;
                return;
            }
            _ => {}
        }
    }
}

/// Handle process termination. Logs, clears state, and exits the app.
/// The app cannot function without the OpenCode sidecar.
async fn handle_process_exit(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    payload: &tauri_plugin_shell::process::TerminatedPayload,
) {
    let mut s = state.lock().await;
    s.child = None;

    if payload.code == Some(0) {
        log::info!("OpenCode process exited cleanly");
        app.exit(0);
    } else {
        log::error!(
            "OpenCode process exited with code {:?} (signal {:?})",
            payload.code,
            payload.signal
        );
        app.exit(1);
    }
}

/// Gracefully stop the OpenCode sidecar process.
pub async fn stop_all(state: &SharedOpenCodeState, _app: &AppHandle) {
    let mut s = state.lock().await;
    if let Some(child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = 0;
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_is_port_zero() {
        let state = OpenCodeState::default();
        assert_eq!(state.port, 0);
        assert!(state.child.is_none());
    }

    #[test]
    fn port_range_within_iana_dynamic_range() {
        assert!(OC_PORT_START >= 49152);
        assert!((OC_PORT_START + PORT_RANGE) as u32 <= 65535);
    }

    #[test]
    fn loopback_is_ipv4() {
        assert_eq!(LOOPBACK, "127.0.0.1");
    }

    #[test]
    fn plugins_do_not_override_builtin_openai_oauth() {
        assert_eq!(OPENCODE_PLUGINS, &["opencode-gemini-auth@latest"]);
        assert!(!OPENCODE_PLUGINS
            .iter()
            .any(|plugin| plugin.contains("multi-auth-codex")));
    }

    #[test]
    fn parse_sidecar_level_error() {
        assert_eq!(
            parse_sidecar_level("ERROR 2026-03-22T12:00:00 something broke"),
            log::Level::Error
        );
    }

    #[test]
    fn parse_sidecar_level_warn() {
        assert_eq!(
            parse_sidecar_level("WARN  2026-03-22T12:00:00 deprecated usage"),
            log::Level::Warn
        );
    }

    #[test]
    fn parse_sidecar_level_info() {
        assert_eq!(
            parse_sidecar_level("INFO  2026-03-22T12:00:00 server started"),
            log::Level::Info
        );
    }

    #[test]
    fn parse_sidecar_level_debug() {
        assert_eq!(
            parse_sidecar_level("DEBUG 2026-03-22T12:00:00 tick"),
            log::Level::Debug
        );
    }

    #[test]
    fn parse_sidecar_level_unknown_defaults_to_warn() {
        assert_eq!(
            parse_sidecar_level("some random stack trace line"),
            log::Level::Warn
        );
    }

    #[test]
    fn parse_sidecar_level_leading_whitespace() {
        assert_eq!(
            parse_sidecar_level("  ERROR trailing text"),
            log::Level::Error
        );
    }

    #[test]
    fn noisy_patterns_detected() {
        assert!(is_noisy_sidecar_line("path=/mcp request id=123"));
        assert!(is_noisy_sidecar_line("path=/global/health request"));
        assert!(is_noisy_sidecar_line("service=server method=GET"));
        assert!(is_noisy_sidecar_line("service=server status=200"));
        assert!(is_noisy_sidecar_line("service=bus type=event"));
        assert!(is_noisy_sidecar_line("service=tool.registry loading"));
        assert!(is_noisy_sidecar_line("service=permission check=true"));
    }

    #[test]
    fn non_noisy_lines_pass_through() {
        assert!(!is_noisy_sidecar_line("ERROR something important"));
        assert!(!is_noisy_sidecar_line("server listening on port 59200"));
        assert!(!is_noisy_sidecar_line(""));
    }

    #[test]
    fn studio_mcp_command_returns_non_empty_vec() {
        let cmd = studio_mcp_command();
        assert!(!cmd.is_empty());
        #[cfg(target_os = "macos")]
        assert!(cmd[0].contains("StudioMCP"));
        #[cfg(target_os = "windows")]
        assert_eq!(cmd[0], "cmd.exe");
    }

    #[test]
    fn studio_mcp_config_uses_ten_minute_request_timeout() {
        let servers = mcp_servers_config(
            vec!["studio-mcp".to_string()],
            vec!["node".to_string(), "server.js".to_string()],
            serde_json::json!({ "BLOXBOT_VSCODE_BRIDGE_TOKEN": "test-token" }),
        );
        let studio = &servers["roblox-studio"];

        assert_eq!(
            studio["timeout"].as_u64(),
            Some(ROBLOX_MCP_REQUEST_TIMEOUT_MS)
        );
        assert_eq!(studio["command"], serde_json::json!(["studio-mcp"]));
        assert_eq!(studio["type"], serde_json::json!("local"));
        assert_eq!(studio["enabled"], serde_json::json!(true));
    }

    #[test]
    fn studio_timeout_does_not_apply_to_other_mcp_servers() {
        let bridge = serde_json::json!({
            "BLOXBOT_VSCODE_BRIDGE_URL": "http://127.0.0.1:12345",
            "BLOXBOT_VSCODE_BRIDGE_TOKEN": "test-token"
        });
        let servers = mcp_servers_config(
            vec!["studio-mcp".to_string()],
            vec!["node".to_string(), "server.js".to_string()],
            bridge.clone(),
        );
        let vscode = &servers["bloxbot-vscode"];

        assert!(vscode.get("timeout").is_none());
        assert_eq!(vscode["environment"], bridge);
        assert_eq!(vscode["env"], bridge);
    }

    #[test]
    fn extracts_studio_instances_from_direct_tool_result() {
        let value = serde_json::json!({
            "content": [{
                "type": "text",
                "text": "{\"studios\":[{\"id\":\"12345\",\"name\":\"Main Place\",\"active\":true},{\"id\":\"abc-123\",\"name\":\"Tést 世界\",\"active\":false}]}"
            }]
        });

        assert_eq!(
            parse_studio_instances(&value).unwrap(),
            vec![
                StudioInstance {
                    id: "12345".to_string(),
                    name: "Main Place".to_string(),
                    active: true,
                },
                StudioInstance {
                    id: "abc-123".to_string(),
                    name: "Tést 世界".to_string(),
                    active: false,
                },
            ]
        );
    }

    #[test]
    fn extracts_empty_studio_list() {
        let value =
            serde_json::json!({ "content": [{ "type": "text", "text": "{\"studios\":[]}" }] });
        assert_eq!(parse_studio_instances(&value).unwrap(), Vec::new());
    }

    #[test]
    fn rejects_malformed_studio_data() {
        let value =
            serde_json::json!({ "content": [{ "type": "text", "text": "{\"studios\":{}}" }] });
        assert!(parse_studio_instances(&value)
            .unwrap_err()
            .contains("non-array"));
    }

    #[test]
    fn rejects_missing_studio_list() {
        let value = serde_json::json!({ "content": [{ "type": "text", "text": "not json" }] });
        assert!(parse_studio_instances(&value)
            .unwrap_err()
            .contains("no Studio list"));
    }

    #[tokio::test]
    async fn find_available_port_returns_port_in_range() {
        let port = find_available_port(OC_PORT_START).await;
        assert!(port >= OC_PORT_START);
        assert!(port < OC_PORT_START + PORT_RANGE);
    }
}
