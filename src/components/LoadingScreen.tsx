import BotFace from "@/components/BotFace";

interface LoadingScreenProps {
  message?: string;
  detail?: string;
  /** When true, shows the error state with help actions instead of the dot loader. */
  error?: boolean;
  /** Called when the user clicks "Try Again". */
  onRetry?: () => void;
  /** When true, shows a spinner on the retry button. */
  retrying?: boolean;
}

/**
 * Full-screen loading state featuring the animated BloxBot face.
 * Used during server startup and SDK initialization.
 *
 * When `error` is true, shows a sad face with retry and support actions.
 */
function LoadingScreen({
  message = "Starting up...",
  detail,
  error,
  onRetry,
  retrying,
}: LoadingScreenProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6">
      <div className="animate-fade-in flex flex-col items-center">
        <BotFace
          mood={error ? "error" : "idle"}
          accessory="none"
          size={80}
          animated={!error}
          showAccessory={false}
        />

        {/* Status text */}
        <p className="mt-5 text-sm font-medium text-foreground/70">{message}</p>

        {detail && <p className="mt-1.5 max-w-xs text-center text-xs text-destructive">{detail}</p>}

        {/* Error state: help actions */}
        {error ? (
          <div className="mt-5 flex flex-col items-center gap-3">
            {/* Retry button */}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {retrying ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                    Restarting...
                  </>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 2v6h-6" />
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                      <path d="M3 22v-6h6" />
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                    Try Again
                  </>
                )}
              </button>
            )}

            {/* Secondary actions  - text links only */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <a
                href="https://bloxbot.ai"
                target="_blank"
                rel="noreferrer"
                className="underline transition-colors hover:text-foreground"
              >
                bloxbot.ai
              </a>
            </div>
          </div>
        ) : (
          /* Loading state: dot animation */
          <div className="mt-4 flex gap-1">
            <span className="bloxbot-dot h-1 w-1 rounded-full bg-foreground/25" />
            <span className="bloxbot-dot h-1 w-1 rounded-full bg-foreground/25 [animation-delay:150ms]" />
            <span className="bloxbot-dot h-1 w-1 rounded-full bg-foreground/25 [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}

export default LoadingScreen;
