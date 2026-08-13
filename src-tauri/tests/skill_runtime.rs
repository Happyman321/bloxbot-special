#[cfg(target_os = "windows")]
mod windows {
    use serde_json::Value;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    struct ChildGuard(Child);

    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn contains_name(value: &Value, expected: &str) -> bool {
        match value {
            Value::Array(items) => items.iter().any(|item| contains_name(item, expected)),
            Value::Object(object) => object.values().any(|item| contains_name(item, expected)),
            Value::String(value) => value == expected || value == &format!("/{expected}"),
            _ => false,
        }
    }

    #[tokio::test]
    async fn pinned_sidecar_discovers_agent_skill_and_command() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let binary = manifest
            .join("binaries")
            .join("opencode-x86_64-pc-windows-msvc.exe");
        assert!(binary.is_file(), "Pinned OpenCode sidecar is missing");
        let fixture = manifest
            .join("tests")
            .join("fixtures")
            .join("skill-runtime");

        let listener = TcpListener::bind("127.0.0.1:0").expect("reserve loopback port");
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let state_root = std::env::temp_dir().join(format!(
            "bloxbot-opencode-skill-test-{}-{suffix}",
            std::process::id()
        ));
        for name in ["data", "config", "cache", "state"] {
            std::fs::create_dir_all(state_root.join(name)).unwrap();
        }
        let skills_path = fixture.join(".agents").join("skills");
        let injected_config = serde_json::json!({
            "skills": { "paths": [skills_path], "urls": [] }
        })
        .to_string();

        let child = Command::new(binary)
            .args([
                "serve",
                "--port",
                &port.to_string(),
                "--hostname",
                "127.0.0.1",
            ])
            .current_dir(&fixture)
            .env("XDG_DATA_HOME", state_root.join("data"))
            .env("XDG_CONFIG_HOME", state_root.join("config"))
            .env("XDG_CACHE_HOME", state_root.join("cache"))
            .env("XDG_STATE_HOME", state_root.join("state"))
            .env("OPENCODE_DISABLE_DEFAULT_PLUGINS", "1")
            .env("OPENCODE_DISABLE_EXTERNAL_SKILLS", "1")
            .env("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS", "1")
            .env("OPENCODE_CONFIG_CONTENT", injected_config)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("launch pinned OpenCode sidecar");
        let _guard = ChildGuard(child);

        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}");
        let mut skills = None;
        for _ in 0..50 {
            if let Ok(response) = client.get(format!("{base}/skill")).send().await {
                if response.status().is_success() {
                    let body = response.text().await.expect("read skill response");
                    skills = Some(serde_json::from_str::<Value>(&body).expect("valid skill JSON"));
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let skills = skills.expect("OpenCode skill endpoint did not become ready");
        assert!(
            contains_name(&skills, "runtime-fixture"),
            "fixture missing from /skill: {skills}"
        );

        let commands = client
            .get(format!("{base}/command"))
            .send()
            .await
            .expect("query command endpoint")
            .error_for_status()
            .expect("command endpoint status")
            .text()
            .await
            .expect("read command response");
        let commands = serde_json::from_str::<Value>(&commands).expect("valid command JSON");
        assert!(
            contains_name(&commands, "runtime-fixture"),
            "fixture missing from /command: {commands}"
        );

        drop(_guard);
        let _ = std::fs::remove_dir_all(state_root);
    }
}
