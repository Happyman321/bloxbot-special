import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";
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

const UNFILED_KEY = "__unfiled__";
const UNFILED_LABEL = "Unfiled";

const ChatSidebar = memo(function ChatSidebar({
  collapsed,
  onToggle,
  onSessionSelect,
  onOpenSettings,
}: ChatSidebarProps) {
  const { data: sessions = [] } = useSessions();
  const { activeSessionId, selectSession } = useActiveSession();
  const { data: sessionStatuses = {} } = useSessionStatuses();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const {
    folders,
    sessionFolderById,
    folderOpenState,
    activeWorkspace,
    setActiveWorkspace,
    createFolder,
    assignSessionFolder,
    toggleFolderOpen,
  } = usePreferences();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pickerSessionId, setPickerSessionId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  function handleSelect(id: string) {
    onSessionSelect();
    selectSession(id);
  }

  function handleCreate() {
    onSessionSelect();
    createSession.mutate();
  }

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

  function moveSession(sessionId: string, folderName: string | null) {
    assignSessionFolder(sessionId, folderName);
    setPickerSessionId(null);
  }

  function handleCreateAndMove(sessionId: string) {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    createFolder(trimmed);
    assignSessionFolder(sessionId, trimmed);
    setNewFolderName("");
    setPickerSessionId(null);
  }

  const unfiledSessions = useMemo(
    () => sessions.filter((session) => !sessionFolderById[session.id]),
    [sessions, sessionFolderById],
  );

  const folderSections = useMemo(
    () => [
      { key: UNFILED_KEY, label: UNFILED_LABEL, sessions: unfiledSessions },
      ...folders.map((folder) => ({
        key: folder,
        label: folder,
        sessions: sessions.filter((session) => sessionFolderById[session.id] === folder),
      })),
    ],
    [folders, sessionFolderById, sessions, unfiledSessions],
  );

  const visibleSections = useMemo(() => {
    if (activeWorkspace === "all") return folderSections;
    if (activeWorkspace === "unfiled") {
      return folderSections.filter((section) => section.key === UNFILED_KEY);
    }
    return folderSections.filter((section) => section.key === activeWorkspace);
  }, [activeWorkspace, folderSections]);

  function renderSessionItem(
    session: (typeof sessions)[number],
    index: number,
    folderLabel: string | null,
  ) {
    const isActive = session.id === activeSessionId;
    const isEditing = session.id === editingId;
    const status = sessionStatuses[session.id];

    return (
      <div
        key={session.id}
        className="animate-slide-in-left"
        style={{ animationDelay: `${index * 30}ms` }}
      >
        <div
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
            {folderLabel && (
              <div className="mt-1 inline-flex rounded bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                {folderLabel}
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
                  setPickerSessionId((prev) => (prev === session.id ? null : session.id));
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
              className="absolute right-2 top-7 z-20 w-44 rounded-md border bg-popover p-2 text-[11px] shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-1 font-medium text-foreground">Move to folder</div>
              <div className="max-h-28 space-y-1 overflow-y-auto">
                <button
                  onClick={() => moveSession(session.id, null)}
                  className="w-full rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {UNFILED_LABEL}
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => moveSession(session.id, folder)}
                    className="w-full rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {folder}
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
    );
  }

  function renderFolderSection(
    folderKey: string,
    label: string,
    folderSessions: (typeof sessions),
  ) {
    const isOpen = folderOpenState[folderKey] ?? folderKey === UNFILED_KEY;

    return (
      <div key={folderKey} className="px-1">
        <button
          onClick={() => toggleFolderOpen(folderKey)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span className="truncate">{label}</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px]">{folderSessions.length}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </button>

        {isOpen && (
          <div className="mt-1 space-y-0.5">
            {folderSessions.length === 0 ? (
              <div className="px-2 py-1 text-[10px] text-muted-foreground">No chats.</div>
            ) : (
              folderSessions.map((session, index) => renderSessionItem(session, index, label))
            )}
          </div>
        )}
      </div>
    );
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

          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
            <div className="px-2 pb-2 pt-1">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspace
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
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="animate-fade-in px-3 py-6 text-center text-xs text-muted-foreground">
                No sessions yet.
                <br />
                Start a new one to begin.
              </div>
            ) : (
              <div className="space-y-1">
                {visibleSections.map((section) =>
                  renderFolderSection(section.key, section.label, section.sessions),
                )}
              </div>
            )}
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
        </>
      )}
    </div>
  );
});

export default ChatSidebar;
