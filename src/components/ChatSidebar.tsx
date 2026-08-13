import { invoke } from "@tauri-apps/api/core";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";
import { useManagedDictatorSessionIds } from "@/hooks/useDictators";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface ChatSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onSessionSelect: () => void;
  onOpenSettings: () => void;
}

interface VscodeBridgeInfo {
  port: number;
  token: string;
}

function formatTime(timestamp: number): string {
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusDot(status?: { type: string }): string {
  if (!status) return "bg-stone-300";
  switch (status.type) {
    case "busy":
      return "bg-amber-400 animate-pulse";
    case "idle":
      return "bg-stone-300";
    default:
      return "bg-stone-300";
  }
}

const ChatSidebar = memo(function ChatSidebar({
  collapsed,
  onToggle,
  onSessionSelect,
  onOpenSettings,
}: ChatSidebarProps) {
  const { data: sessions = [] } = useSessions();
  const managedDictatorSessionIds = useManagedDictatorSessionIds();
  const { activeSessionId, selectSession } = useActiveSession();
  const { data: sessionStatuses = {} } = useSessionStatuses();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const {
    folders,
    sessionFolderById,
    favoriteSessionIdsByWorkspace,
    activeWorkspace,
    setActiveWorkspace,
    createFolder,
    renameFolder,
    assignSessionFolder,
    toggleFavoriteSession,
    workspaceSettingsByName,
    updateWorkspaceSettings,
  } = usePreferences();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pickerSessionId, setPickerSessionId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [settingsWorkspaceName, setSettingsWorkspaceName] = useState<string | null>(null);
  const [settingsNameDraft, setSettingsNameDraft] = useState("");
  const [settingsInstructionsDraft, setSettingsInstructionsDraft] = useState("");
  const [settingsTypeDraft, setSettingsTypeDraft] = useState<"standard" | "vscode">("standard");
  const [settingsPathDraft, setSettingsPathDraft] = useState("");
  const [settingsCompanionDraft, setSettingsCompanionDraft] = useState(false);
  const [bridgeInfo, setBridgeInfo] = useState<VscodeBridgeInfo | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  function handleSelect(id: string) {
    onSessionSelect();
    selectSession(id);
  }

  function handleCreate() {
    onSessionSelect();
    createSession.mutate();
  }

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!pickerSessionId) return;
    function onClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerSessionId(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerSessionId]);

  const visibleSessions = useMemo(() => {
    const normalSessions = sessions.filter((session) => !managedDictatorSessionIds.has(session.id));
    if (activeWorkspace === "all") return normalSessions;
    if (activeWorkspace === "unfiled") {
      return normalSessions.filter((session) => !sessionFolderById[session.id]);
    }
    return normalSessions.filter((session) => sessionFolderById[session.id] === activeWorkspace);
  }, [activeWorkspace, managedDictatorSessionIds, sessionFolderById, sessions]);

  const favoriteSessionIds = useMemo(
    () =>
      new Set(
        activeWorkspace === "all"
          ? Object.values(favoriteSessionIdsByWorkspace).flat()
          : (favoriteSessionIdsByWorkspace[activeWorkspace] ?? []),
      ),
    [activeWorkspace, favoriteSessionIdsByWorkspace],
  );

  const orderedSessions = useMemo(() => {
    const favorites = visibleSessions.filter((session) => favoriteSessionIds.has(session.id));
    const others = visibleSessions.filter((session) => !favoriteSessionIds.has(session.id));
    return [...favorites, ...others];
  }, [favoriteSessionIds, visibleSessions]);

  function startRename(session: { id: string; title?: string }) {
    setEditingId(session.id);
    setEditValue(session.title || "Untitled");
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      renameSession.mutate({ sessionID: editingId, title: editValue.trim() });
    }
    setEditingId(null);
  }

  function handleCreateFolder() {
    const input = window.prompt("Folder name");
    if (!input) return;
    createFolder(input);
  }

  function openWorkspaceSettings(folderName: string) {
    const settings = workspaceSettingsByName[folderName];
    setSettingsWorkspaceName(folderName);
    setSettingsNameDraft(folderName);
    setSettingsInstructionsDraft(settings?.instructions ?? "");
    setSettingsTypeDraft(settings?.type ?? "standard");
    setSettingsPathDraft(settings?.vscodePath ?? "");
    setSettingsCompanionDraft(settings?.vscodeCompanionEnabled ?? false);
    invoke<VscodeBridgeInfo>("get_vscode_bridge_info")
      .then(setBridgeInfo)
      .catch(() => setBridgeInfo(null));
  }

  function moveSession(sessionId: string, folderName: string | null) {
    assignSessionFolder(sessionId, folderName);
    setPickerSessionId(null);
    setNewFolderName("");
  }

  function handleCreateAndMove(sessionId: string) {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    createFolder(trimmed);
    assignSessionFolder(sessionId, trimmed);
    setPickerSessionId(null);
    setNewFolderName("");
  }

  function closeWorkspaceSettings() {
    setSettingsWorkspaceName(null);
  }

  function saveWorkspaceSettings() {
    if (!settingsWorkspaceName) return;
    const originalName = settingsWorkspaceName;
    const nextName = settingsNameDraft.trim();
    if (!nextName) return;

    updateWorkspaceSettings(originalName, {
      type: settingsTypeDraft,
      instructions: settingsInstructionsDraft,
      vscodePath: settingsPathDraft.trim(),
      vscodeCompanionEnabled: settingsCompanionDraft,
      defaultAgent: settingsTypeDraft === "vscode" ? "vscode-workspace" : null,
    });
    if (nextName !== originalName) {
      renameFolder(originalName, nextName);
      setSettingsWorkspaceName(nextName);
    }
    closeWorkspaceSettings();
  }

  return (
    <div
      className={`flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-out ${
        collapsed ? "w-10" : "w-56"
      }`}
    >
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center justify-between py-2">
          <div className="flex flex-col items-center">
            <button
              onClick={onToggle}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Expand sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              onClick={handleCreate}
              className="mt-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New session"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <button
            onClick={onOpenSettings}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Settings"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div className="flex h-10 items-center justify-between border-b px-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sessions
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleCreate}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="New session"
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
              </button>
              <button
                onClick={onToggle}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Collapse sidebar"
              >
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
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative isolate flex-1 overflow-y-auto overflow-x-hidden py-1">
            <div className="px-2 pb-2 pt-1">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspaces
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={activeWorkspace}
                  onChange={(event) => setActiveWorkspace(event.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[11px] outline-none ring-ring focus-visible:ring-1"
                >
                  <option value="all">All sessions</option>
                  <option value="unfiled">Unfiled</option>
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreateFolder}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Create folder"
                >
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
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </button>
                {activeWorkspace !== "all" && activeWorkspace !== "unfiled" && (
                  <button
                    onClick={() => openWorkspaceSettings(activeWorkspace)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Workspace settings"
                  >
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
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                )}
              </div>
              {activeWorkspace !== "all" && activeWorkspace !== "unfiled" && (
                <div className="mt-2 flex items-center justify-between rounded-md border bg-background/60 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium">{activeWorkspace}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {workspaceSettingsByName[activeWorkspace]?.type === "vscode"
                        ? "VS Code workspace"
                        : "Standard workspace"}
                    </div>
                  </div>
                  <button
                    onClick={() => openWorkspaceSettings(activeWorkspace)}
                    className="shrink-0 rounded border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent"
                  >
                    Settings
                  </button>
                </div>
              )}
            </div>

            {visibleSessions.length === 0 && (
              <div className="animate-fade-in px-3 py-6 text-center text-xs text-muted-foreground">
                {sessions.length === 0 ? (
                  <>
                    No sessions yet.
                    <br />
                    Start a new one to begin.
                  </>
                ) : (
                  <>
                    No sessions in this workspace.
                    <br />
                    Pick another workspace or move a session.
                  </>
                )}
              </div>
            )}

            {orderedSessions.map((session, index) => {
              const isActive = session.id === activeSessionId;
              const isEditing = session.id === editingId;
              const isFavorite = favoriteSessionIds.has(session.id);
              const status = sessionStatuses[session.id];
              const folder = sessionFolderById[session.id];
              const showFavoriteDivider =
                index > 0 && !isFavorite && favoriteSessionIds.has(orderedSessions[index - 1].id);

              return (
                <div key={session.id}>
                  {showFavoriteDivider && (
                    <div
                      className="mx-3 my-1 border-t"
                      data-testid="favorites-divider"
                      aria-hidden="true"
                    />
                  )}
                  <div
                    className={`animate-slide-in-left ${pickerSessionId === session.id ? "relative z-[90]" : ""}`}
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div
                      data-testid={`session-row-${session.id}`}
                      className={`group relative mx-1 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ${
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }`}
                      onClick={() => !isEditing && handleSelect(session.id)}
                    >
                      <div
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${statusDot(status)}`}
                      />
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            ref={editRef}
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitRename();
                              if (event.key === "Escape") setEditingId(null);
                            }}
                            className="w-full rounded bg-background px-1 text-xs outline-none ring-1 ring-ring"
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : (
                          <div className="truncate text-xs font-medium leading-snug">
                            {session.title || "Untitled"}
                          </div>
                        )}
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatTime(session.time.updated)}
                        </div>
                        {folder && (
                          <div className="mt-1 inline-flex rounded bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                            {folder}
                          </div>
                        )}
                      </div>

                      {!isEditing && (
                        <div
                          className={`absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md pl-4 pr-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${
                            isActive
                              ? "bg-gradient-to-l from-accent from-60% to-transparent"
                              : "bg-gradient-to-l from-card from-60% to-transparent group-hover:from-accent/50"
                          }`}
                        >
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavoriteSession(session.id);
                            }}
                            className={`flex h-5 w-5 items-center justify-center rounded transition-colors hover:text-foreground ${
                              isFavorite ? "text-amber-500" : "text-muted-foreground"
                            }`}
                            title={isFavorite ? "Remove from favourites" : "Add to favourites"}
                            aria-label={isFavorite ? "Remove from favourites" : "Add to favourites"}
                          >
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill={isFavorite ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              startRename(session);
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                            title="Rename"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setPickerSessionId((prev) =>
                                prev === session.id ? null : session.id,
                              );
                              setNewFolderName("");
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                            title="Move to folder"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteSession.mutate(session.id);
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
                            title="Delete"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      )}

                      {pickerSessionId === session.id && (
                        <div
                          ref={pickerRef}
                          className="absolute right-2 top-7 z-[100] w-44 rounded-md border bg-popover p-2 text-[11px] shadow-lg"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="mb-1 font-medium text-foreground">Move to folder</div>
                          <div className="max-h-28 space-y-1 overflow-y-auto">
                            <button
                              onClick={() => moveSession(session.id, null)}
                              className="w-full rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              Unfiled
                            </button>
                            {folders.map((folderName) => (
                              <button
                                key={folderName}
                                onClick={() => moveSession(session.id, folderName)}
                                className="w-full rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                {folderName}
                              </button>
                            ))}
                          </div>

                          <div className="mt-2 flex items-center gap-1">
                            <input
                              value={newFolderName}
                              onChange={(event) => setNewFolderName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  handleCreateAndMove(session.id);
                                }
                              }}
                              placeholder="New folder"
                              className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-[11px] outline-none ring-ring focus-visible:ring-1"
                            />
                            <button
                              onClick={() => handleCreateAndMove(session.id)}
                              className="h-7 rounded border px-2 text-[10px] font-medium transition-colors hover:bg-accent"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1 shrink-0 border-t px-3 py-2">
            <button
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
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
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </button>
          </div>

          {settingsWorkspaceName && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4">
              <div className="w-full max-w-md rounded-lg border bg-background shadow-2xl">
                <div className="flex h-11 items-center justify-between border-b px-4">
                  <div>
                    <div className="text-xs font-semibold">Workspace Settings</div>
                    <div className="text-[10px] text-muted-foreground">{settingsWorkspaceName}</div>
                  </div>
                  <button
                    onClick={closeWorkspaceSettings}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Close"
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
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-3 p-4">
                  <label className="block">
                    <span className="text-[11px] font-medium">Name</span>
                    <input
                      value={settingsNameDraft}
                      onChange={(event) => setSettingsNameDraft(event.target.value)}
                      className="mt-1 h-8 w-full rounded border bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-1"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-medium">Type</span>
                    <select
                      value={settingsTypeDraft}
                      onChange={(event) =>
                        setSettingsTypeDraft(
                          event.target.value === "vscode" ? "vscode" : "standard",
                        )
                      }
                      className="mt-1 h-8 w-full rounded border bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-1"
                    >
                      <option value="standard">Standard</option>
                      <option value="vscode">VS Code</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-medium">Workspace instructions</span>
                    <textarea
                      value={settingsInstructionsDraft}
                      onChange={(event) => setSettingsInstructionsDraft(event.target.value)}
                      placeholder="Project context / pre-instructions for this workspace"
                      className="mt-1 min-h-24 w-full resize-y rounded border bg-background px-2 py-1.5 text-xs outline-none ring-ring focus-visible:ring-1"
                    />
                  </label>

                  {settingsTypeDraft === "vscode" && (
                    <div className="space-y-3 rounded-md border bg-card p-3">
                      <label className="block">
                        <span className="text-[11px] font-medium">VS Code folder path</span>
                        <input
                          value={settingsPathDraft}
                          onChange={(event) => setSettingsPathDraft(event.target.value)}
                          placeholder="C:\Projects\MyGame"
                          className="mt-1 h-8 w-full rounded border bg-background px-2 font-mono text-xs outline-none ring-ring focus-visible:ring-1"
                        />
                      </label>
                      <label className="flex items-center justify-between gap-3">
                        <span>
                          <span className="block text-[11px] font-medium">Companion mode</span>
                          <span className="block text-[10px] text-muted-foreground">
                            Send file changes to the VS Code extension for review.
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={settingsCompanionDraft}
                          onChange={(event) => setSettingsCompanionDraft(event.target.checked)}
                          className="h-4 w-4"
                        />
                      </label>
                      <div className="rounded border bg-background p-2">
                        <div className="text-[11px] font-medium">Companion pairing</div>
                        {bridgeInfo ? (
                          <div className="mt-1 space-y-1 font-mono text-[10px] text-muted-foreground">
                            <div>URL: http://127.0.0.1:{bridgeInfo.port}</div>
                            <div className="break-all">Token: {bridgeInfo.token}</div>
                          </div>
                        ) : (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            Bridge details are not available yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t px-4 py-3">
                  <button
                    onClick={closeWorkspaceSettings}
                    className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveWorkspaceSettings}
                    className="h-8 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default ChatSidebar;
