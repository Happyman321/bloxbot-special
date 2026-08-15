import { PostHogProvider } from "@posthog/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const POSTHOG_API_KEY = "phc_bOlMECnl02VBjOp2Y8PNOD36gSBmAuekirxhPKxjbEz";
const POSTHOG_API_HOST = "https://eu.i.posthog.com";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PostHogProvider
      apiKey={POSTHOG_API_KEY}
      options={{
        api_host: POSTHOG_API_HOST,
        defaults: "2026-01-30",
        advanced_disable_toolbar_metrics: true,
        disable_session_recording: true,
      }}
    >
      <App />
    </PostHogProvider>
  </React.StrictMode>,
);

// The native window starts hidden so users never see an unpainted white webview.
// Reveal it after React has had two frames to paint the personalized startup companion,
// without waiting for the OpenCode sidecar to finish booting.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    getCurrentWindow()
      .show()
      .catch(() => {
        // Browser previews do not expose a Tauri window.
      });
  });
});
