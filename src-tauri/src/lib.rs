mod logging;
mod opencode;
mod paths;
mod skills;
mod vscode_bridge;

use opencode::SharedOpenCodeState;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::webview::PageLoadEvent;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    let opencode_state: SharedOpenCodeState =
        Arc::new(Mutex::new(opencode::OpenCodeState::default()));
    let vscode_bridge_state: vscode_bridge::SharedVscodeBridgeState =
        Arc::new(Mutex::new(vscode_bridge::VscodeBridgeState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(opencode_state)
        .manage(vscode_bridge_state)
        .invoke_handler(tauri::generate_handler![
            opencode::get_opencode_info,
            opencode::list_roblox_studios,
            opencode::set_active_roblox_studio,
            skills::list_bloxbot_skills,
            skills::get_bloxbot_skill,
            skills::save_bloxbot_skill,
            skills::duplicate_bloxbot_skill,
            skills::set_bloxbot_skill_enabled,
            skills::delete_bloxbot_skill,
            vscode_bridge::get_vscode_bridge_info
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                if let Err(error) = webview.window().show() {
                    log::warn!("Failed to reveal the painted startup window: {error}");
                }
            }
        })
        .setup(|app| {
            // ── Application menu ──────────────────────────────────
            let app_submenu = SubmenuBuilder::new(app, "BloxBot")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .close_window()
                .build()?;

            let debug_toggle = MenuItemBuilder::with_id("debug_opencode_ui", "OpenCode Web UI")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            let debug_submenu = SubmenuBuilder::new(app, "Debug")
                .item(&debug_toggle)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .item(&debug_submenu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                if event.id() == debug_toggle.id() {
                    let state = app_handle.state::<SharedOpenCodeState>().inner().clone();
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let port = {
                            let s = state.lock().await;
                            s.port
                        };
                        if port > 0 {
                            let url = format!("http://{}:{}", opencode::LOOPBACK, port);
                            let _ = handle.opener().open_url(&url, None::<&str>);
                        }
                    });
                }
            });

            // ── Start OpenCode in the background ─────────────────
            // The frontend reveals the native window as soon as its personalized
            // loading companion has painted, so this work remains visible progress.
            let state = app.state::<SharedOpenCodeState>().inner().clone();
            let bridge_state = app
                .state::<vscode_bridge::SharedVscodeBridgeState>()
                .inner()
                .clone();
            let handle = app.handle().clone();
            log::info!("BloxBot starting up");
            tauri::async_runtime::spawn(async move {
                if let Err(e) = vscode_bridge::start_vscode_bridge(bridge_state).await {
                    log::error!("VS Code bridge failed to start: {e}");
                }
                match opencode::start_opencode_server(state, handle.clone()).await {
                    Ok(port) => {
                        log::info!("OpenCode ready on port {port}");
                    }
                    Err(e) => {
                        log::error!("OpenCode failed to start: {e} — exiting");
                        handle.exit(1);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window
                    .app_handle()
                    .state::<SharedOpenCodeState>()
                    .inner()
                    .clone();
                let handle = window.app_handle().clone();
                tauri::async_runtime::block_on(async {
                    opencode::stop_all(&state, &handle).await;
                });
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running BloxBot");
}
