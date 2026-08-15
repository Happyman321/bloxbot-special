import { type CSSProperties, useEffect } from "react";

import BotFace from "@/components/BotFace";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { COMPANION_SIZE_PIXELS, type CompanionPreferences } from "@/lib/companion";
import type { ThemeDefinition } from "@/lib/themes";

interface StartupCompanionScreenProps {
  ready: boolean;
  error?: string | null;
  companion: CompanionPreferences;
  theme: ThemeDefinition;
  onComplete: () => void;
}

function StartupCompanionScreen({
  ready,
  error,
  companion,
  theme,
  onComplete,
}: StartupCompanionScreenProps) {
  const reducedMotion = useReducedMotion();
  const motionEnabled = companion.animations && !reducedMotion;
  const phase = ready ? "handoff" : "loading";
  const size = COMPANION_SIZE_PIXELS[companion.size];

  useEffect(() => {
    if (!ready) return;
    if (!motionEnabled) {
      onComplete();
      return;
    }
    const timer = window.setTimeout(onComplete, 1_050);
    return () => window.clearTimeout(timer);
  }, [motionEnabled, onComplete, ready]);

  const positionStyle = {
    "--startup-companion-size": `${size}px`,
  } as CSSProperties;

  return (
    <div
      className="bloxbot-startup-screen fixed inset-0 overflow-hidden bg-background text-foreground"
      data-phase={phase}
      data-accessory={companion.accessory}
      data-accessory-brightness={companion.accessoryBrightness}
      aria-busy={!ready}
      style={positionStyle}
    >
      <div className="bloxbot-startup-companion">
        <BotFace
          mood={ready ? "success" : error ? "error" : "thinking"}
          accessory={companion.accessory}
          accessoryBrightness={companion.accessoryBrightness}
          eyes={companion.eyes}
          shell={companion.shell}
          theme={theme}
          size={size}
          animated={motionEnabled}
          preserveEyeStyle={ready}
          title={ready ? "BloxBot is ready" : "BloxBot is starting up"}
          className="bloxbot-startup-face h-full w-full drop-shadow-lg"
        />
      </div>

      <div className="bloxbot-startup-copy absolute left-1/2 top-1/2 flex -translate-x-1/2 flex-col items-center text-center">
        <p className="text-sm font-medium text-foreground/75">
          {ready ? "Ready!" : error ? "Failed to connect to OpenCode" : "Starting up..."}
        </p>
        {error && <p className="mt-1.5 max-w-xs text-xs text-danger-foreground">{error}</p>}
        {error && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}

export default StartupCompanionScreen;
