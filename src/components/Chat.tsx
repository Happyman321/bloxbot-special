import { lazy, Suspense, useCallback, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import ChatSidebar from "@/components/ChatSidebar";
import DiffViewer from "@/components/DiffViewer";
import LoadingScreen from "@/components/LoadingScreen";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useSessionChanges } from "@/hooks/useSessionChanges";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const Settings = lazy(() => import("@/components/Settings"));

function Chat() {
  const { ready, initError } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const isBusy = useIsBusy(activeSessionId);
  const createSession = useCreateSession();
  const { data: allSessions } = useSessions();

  // Get active session title from the sessions list
  const activeSessionTitle = allSessions?.find((s) => s.id === activeSessionId)?.title ?? null;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const sessionChanges = useSessionChanges();

  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);
  const handleSessionSelect = useCallback(() => setShowSettings(false), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleOpenChanges = useCallback(() => setShowChanges(true), []);
  const handleCloseChanges = useCallback(() => setShowChanges(false), []);

  // Main chat UI
  return (
    <div className="flex min-h-0 flex-1">
      <ChatSidebar
        collapsed={sidebarCollapsed}
        onToggle={handleToggleSidebar}
        onSessionSelect={handleSessionSelect}
        onOpenSettings={handleOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {showSettings ? (
          <Suspense fallback={<LoadingScreen message="Loading settings..." />}>
            <Settings onClose={handleSessionSelect} />
          </Suspense>
        ) : !ready ? (
          <LoadingScreen message="Initializing..." />
        ) : !activeSessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="animate-fade-in-up text-center">
              <h2 className="font-serif text-2xl italic text-foreground">
                What would you like to build?
              </h2>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Create a new session or pick one from the sidebar to continue where you left off.
              </p>
              <button
                onClick={() => createSession.mutate()}
                className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Session
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center justify-between border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-xs font-semibold">
                  {activeSessionTitle || "Untitled"}
                </h3>
                {isBusy && (
                  <span className="flex items-center gap-1 text-[10px] text-warning-foreground">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning-border" />
                    Working
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleOpenChanges}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
              >
                Changes
                <span className="ml-1 text-muted-foreground">({sessionChanges.length})</span>
              </button>
            </div>

            <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border/60 bg-muted/20 px-4 py-1 text-[10px] text-muted-foreground">
              <svg
                aria-hidden="true"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <span>Studio not detected? If Studio is connected, tell BloxBot to try again.</span>
            </div>

            <ChatMessages />
            <ChatInput />
          </>
        )}

        <DiffViewer changes={sessionChanges} open={showChanges} onClose={handleCloseChanges} />

        {initError && (
          <div className="shrink-0 border-t border-danger-border bg-danger-surface px-4 py-2 text-xs text-danger-foreground">
            {initError}
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;
