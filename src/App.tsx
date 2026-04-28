import { useRef, useState } from "react";

import Chat from "@/components/Chat";
import DictatorMode from "@/components/DictatorMode";
import ErrorBoundary from "@/components/ErrorBoundary";
import ImageMode from "@/components/ImageMode";
import { Toaster } from "@/components/ui/sonner";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientProvider } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { QueryProvider } from "@/providers/QueryProvider";

function AppInner() {
  const [mode, setMode] = useState<"chat" | "image" | "dictator">("chat");

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b bg-card px-3"
        data-tauri-drag-region
      >
        <div
          className="flex items-center rounded-md border bg-background p-0.5"
          data-tauri-drag-region="false"
        >
          <button
            type="button"
            onClick={() => setMode("chat")}
            className={`h-6 rounded px-3 text-[11px] font-medium transition-colors ${
              mode === "chat"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setMode("image")}
            className={`h-6 rounded px-3 text-[11px] font-medium transition-colors ${
              mode === "image"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Image
          </button>
          <button
            type="button"
            onClick={() => setMode("dictator")}
            className={`h-6 rounded px-3 text-[11px] font-medium transition-colors ${
              mode === "dictator"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Dictator
          </button>
        </div>
      </div>
      <ErrorBoundary>
        {mode === "chat" ? <Chat /> : mode === "image" ? <ImageMode /> : <DictatorMode />}
      </ErrorBoundary>
      <Toaster />
    </main>
  );
}

function App() {
  const activeSessionIdRef = useRef<string | null>(null);

  return (
    <QueryProvider>
      <OpenCodeClientProvider activeSessionIdRef={activeSessionIdRef}>
        <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
          <PreferencesProvider>
            <AppInner />
          </PreferencesProvider>
        </ActiveSessionProvider>
      </OpenCodeClientProvider>
    </QueryProvider>
  );
}

export default App;
