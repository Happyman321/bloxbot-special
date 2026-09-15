/// Use the Windows dictation service instead of WebView2's Web Speech service.
/// The frontend focuses the composer before invoking this command.
#[tauri::command]
pub fn start_voice_typing(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_H, VK_LWIN,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        // Never send the shortcut to another application if focus changed.
        if unsafe { GetForegroundWindow() } != hwnd.0 as _ {
            return Err("Focus the BloxBot window and try voice input again.".into());
        }
        let key = |code, flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: code,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [
            key(VK_LWIN, 0),
            key(VK_H, 0),
            key(VK_H, KEYEVENTF_KEYUP),
            key(VK_LWIN, KEYEVENTF_KEYUP),
        ];
        // SAFETY: inputs contains initialized INPUT records with the correct size.
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            if sent > 0 {
                let releases = [key(VK_H, KEYEVENTF_KEYUP), key(VK_LWIN, KEYEVENTF_KEYUP)];
                unsafe {
                    SendInput(
                        releases.len() as u32,
                        releases.as_ptr(),
                        std::mem::size_of::<INPUT>() as i32,
                    );
                }
            }
            return Err(
                "Windows could not open voice typing. Try Windows + H in the message box.".into(),
            );
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Windows voice typing is only available on Windows.".into())
    }
}
