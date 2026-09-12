use std::path::PathBuf;

pub fn captures_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_local_dir()
        .ok_or("Could not locate local application data")?
        .join("BloxBot")
        .join("changes"))
}

fn valid_capture_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

#[tauri::command]
pub async fn read_studio_capture(capture_id: String) -> Result<serde_json::Value, String> {
    if !valid_capture_id(&capture_id) {
        return Err("Invalid capture ID".into());
    }
    let path = captures_dir()?.join(format!("{capture_id}.json"));
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Capture unavailable: {e}"))?;
    if metadata.len() > 40 * 1024 * 1024 {
        return Err("Capture exceeds size limit".into());
    }
    let content = tokio::fs::read(path)
        .await
        .map_err(|e| format!("Cannot read capture: {e}"))?;
    serde_json::from_slice(&content).map_err(|e| format!("Invalid capture: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_ids_cannot_escape_storage() {
        assert!(valid_capture_id("12345678-1234-1234-1234-123456789abc"));
        for id in [
            "../secret",
            "C:\\secret",
            "12345678-1234-1234-1234-123456789ab/",
            "",
        ] {
            assert!(!valid_capture_id(id));
        }
    }
}
