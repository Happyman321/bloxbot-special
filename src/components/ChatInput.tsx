import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAbort } from "@/hooks/mutations/useAbort";
import { useSendMessage } from "@/hooks/mutations/useSendMessage";
import { useAgents } from "@/hooks/useAgents";
import { useAllModels, useConnectedProviders } from "@/hooks/useProviders";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo } from "@/types";

// ── Image attachment helpers ────────────────────────────────────────────

interface ImageAttachment {
  id: string;
  dataUrl: string;
  mime: string;
  filename: string;
}

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

let attachmentCounter = 0;

function normalizeStudioId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractStudioIdsFromValue(value: unknown): string[] {
  const ids = new Set<string>();
  const visited = new WeakSet<object>();
  const keysThatLookLikeStudioId = ["studio_id", "studioid", "id", "instance_id", "instanceid"];

  function walk(node: unknown, contextKey?: string) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, contextKey);
      return;
    }
    if (typeof node !== "object") {
      if (typeof node === "string" && contextKey) {
        const normalizedKey = contextKey.toLowerCase();
        if (keysThatLookLikeStudioId.includes(normalizedKey) && normalizedKey.includes("id")) {
          const studioId = normalizeStudioId(node);
          if (studioId) ids.add(studioId);
        }
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);

    const obj = node as Record<string, unknown>;
    const hasStudioHint = Object.keys(obj).some((key) => key.toLowerCase().includes("studio"));

    for (const [key, val] of Object.entries(obj)) {
      const normalizedKey = key.toLowerCase();
      const normalizedVal = normalizeStudioId(val);
      if (
        normalizedVal &&
        keysThatLookLikeStudioId.includes(normalizedKey) &&
        (hasStudioHint || normalizedKey.includes("studio") || normalizedKey.includes("instance"))
      ) {
        ids.add(normalizedVal);
      }
      walk(val, key);
    }
  }

  walk(value);
  return [...ids];
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ── Lightbox overlay ────────────────────────────────────────────────────

const LightboxOverlay = memo(function LightboxOverlay({
  urls,
  index,
  slideDir,
  animKey,
  onClose,
  onPrev,
  onNext,
}: {
  urls: string[];
  index: number;
  slideDir: "left" | "right" | null;
  animKey: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const hasMultiple = urls.length > 1;
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (hasMultiple && (e.key === "ArrowRight" || e.key === "ArrowDown")) onNext();
      if (hasMultiple && (e.key === "ArrowLeft" || e.key === "ArrowUp")) onPrev();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onPrev, onNext, hasMultiple]);

  const slideClass =
    slideDir === "left"
      ? "animate-lightbox-slide-left"
      : slideDir === "right"
        ? "animate-lightbox-slide-right"
        : "animate-lightbox-image";

  return (
    <div
      className="animate-lightbox-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg
          width="16"
          height="16"
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
      {hasMultiple && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      <img
        key={animKey}
        src={urls[index]}
        alt={`Attachment ${index + 1} of ${urls.length}`}
        className={`max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl ${slideClass}`}
        onClick={(e) => e.stopPropagation()}
      />
      {hasMultiple && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      {hasMultiple && (
        <div className="animate-fade-in-up absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  );
});

// ── Send/Abort button ───────────────────────────────────────────────────

const SendButton = memo(function SendButton({
  text,
  hasAttachments,
  onSend,
}: {
  text: string;
  hasAttachments: boolean;
  onSend: () => void;
}) {
  const { activeSessionId } = useActiveSession();
  const isBusy = useIsBusy(activeSessionId);
  const abort = useAbort();
  const canSend = !isBusy;

  return (
    <>
      {isBusy ? (
        <button
          onClick={() => abort.mutate()}
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Stop"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={(!text.trim() && !hasAttachments) || !canSend}
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-30"
          title="Send"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      )}
    </>
  );
});

const StatusHint = memo(function StatusHint() {
  return (
    <div className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
      Shift+Enter for new line
    </div>
  );
});

function ChatInput() {
  const allModels = useAllModels();
  const connectedProviders = useConnectedProviders();
  const agents = useAgents();
  const { activeSessionId } = useActiveSession();
  const { client } = useOpenCodeClient();
  const isBusy = useIsBusy(activeSessionId);
  const {
    selectedModel,
    selectedAgent,
    selectedVariant,
    hiddenModels,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    preferredStudioId,
    knownStudioIds,
    setPreferredStudioId,
    addKnownStudioId,
    fastMode,
  } = usePreferences();
  const sendMessage = useSendMessage();

  // Available variants for the currently selected model
  const availableVariants = useMemo(() => {
    if (!selectedModel) return [];
    const [, modelId] = splitModelKey(selectedModel);
    const model = allModels.find((m) => m.id === modelId);
    return model?.variants ? Object.keys(model.variants) : [];
  }, [selectedModel, allModels]);
  const canAutoUseFastVariant = fastMode && availableVariants.includes("fast");

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lbSlideDir, setLbSlideDir] = useState<"left" | "right" | null>(null);
  const [lbAnimKey, setLbAnimKey] = useState(0);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showStudioPicker, setShowStudioPicker] = useState(false);
  const [loadingStudios, setLoadingStudios] = useState(false);
  const [detectedStudioIds, setDetectedStudioIds] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [rejectShake, setRejectShake] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const studioPickerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const triggerRejectShake = useCallback(() => {
    setRejectShake(true);
    clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = setTimeout(() => setRejectShake(false), 600);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(rejectTimerRef.current);
    };
  }, []);

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const toAdd: File[] = [];
      for (const file of Array.from(files)) {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          toast.error("That file isn't an image. Try a PNG, JPEG, GIF, or WebP instead.");
          triggerRejectShake();
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error("That image is too large. Please use one under 20 MB.");
          triggerRejectShake();
          continue;
        }
        toAdd.push(file);
      }
      if (toAdd.length === 0) return;
      const results = await Promise.allSettled(
        toAdd.map(async (file) => {
          const dataUrl = await fileToDataURL(file);
          return { dataUrl, mime: file.type, filename: file.name };
        }),
      );
      const succeeded: { dataUrl: string; mime: string; filename: string }[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          succeeded.push(r.value);
        } else {
          toast.error("Failed to read an image file");
          triggerRejectShake();
        }
      }
      if (succeeded.length === 0) return;
      setAttachments((prev) => {
        const remaining = MAX_ATTACHMENTS - prev.length;
        if (remaining <= 0) {
          toast.error(`Maximum ${MAX_ATTACHMENTS} images allowed`);
          triggerRejectShake();
          return prev;
        }
        const allowed = succeeded.slice(0, remaining);
        if (succeeded.length > remaining) {
          toast.error(`Only ${remaining} more image(s) allowed`);
          triggerRejectShake();
        }
        return [
          ...prev,
          ...allowed.map((s) => ({
            id: `img-${++attachmentCounter}`,
            dataUrl: s.dataUrl,
            mime: s.mime,
            filename: s.filename,
          })),
        ];
      });
    },
    [triggerRejectShake],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const lightboxUrls = useMemo(() => attachments.map((a) => a.dataUrl), [attachments]);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const lightboxPrev = useCallback(() => {
    setLbSlideDir("right");
    setLbAnimKey((k) => k + 1);
    setLightboxIndex((i) =>
      i !== null ? (i - 1 + attachments.length) % attachments.length : null,
    );
  }, [attachments.length]);
  const lightboxNext = useCallback(() => {
    setLbSlideDir("left");
    setLbAnimKey((k) => k + 1);
    setLightboxIndex((i) => (i !== null ? (i + 1) % attachments.length : null));
  }, [attachments.length]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addImageFiles(e.dataTransfer.files);
    },
    [addImageFiles],
  );

  function resizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
        setModelSearch("");
      }
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
      if (studioPickerRef.current && !studioPickerRef.current.contains(e.target as Node)) {
        setShowStudioPicker(false);
      }
    }
    if (showModelPicker || showAgentPicker || showStudioPicker) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showModelPicker, showAgentPicker, showStudioPicker]);

  const modelsByProvider = useMemo(() => {
    const POPULAR = [
      "opencode",
      "anthropic",
      "github-copilot",
      "openai",
      "google",
      "openrouter",
      "vercel",
    ];
    const query = modelSearch.toLowerCase().trim();
    const groups: Record<string, { providerName: string; models: ModelInfo[] }> = {};
    for (const model of allModels) {
      if (!connectedProviders.includes(model.providerId)) continue;
      const modelKey = `${model.providerId}/${model.id}`;
      if (hiddenModels.has(modelKey)) continue;
      if (query) {
        const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      if (!groups[model.providerId])
        groups[model.providerId] = { providerName: model.providerName, models: [] };
      groups[model.providerId].models.push(model);
    }
    for (const group of Object.values(groups))
      group.models.sort((a, b) => a.name.localeCompare(b.name));
    // Sort provider groups: popular first, then alphabetical
    const entries = Object.entries(groups);
    entries.sort(([aId], [bId]) => {
      const aIdx = POPULAR.indexOf(aId);
      const bIdx = POPULAR.indexOf(bId);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return groups[aId].providerName.localeCompare(groups[bId].providerName);
    });
    return entries;
  }, [allModels, connectedProviders, hiddenModels, modelSearch]);

  const visibleAgents = useMemo(
    () => agents.filter((a) => !a.hidden && (a.mode === "primary" || a.mode === "all")),
    [agents],
  );
  const availableStudioIds = useMemo(() => {
    const deduped = new Set<string>();
    for (const id of detectedStudioIds) deduped.add(id);
    for (const id of knownStudioIds) deduped.add(id);
    return [...deduped];
  }, [detectedStudioIds, knownStudioIds]);

  const refreshStudios = useCallback(async () => {
    if (!client) return;
    setLoadingStudios(true);
    try {
      const res = await client.mcp.status({});
      const mcpServers = res.data ?? {};
      const studioServerStatus =
        mcpServers["roblox-studio"] ?? mcpServers.roblox_studio ?? mcpServers.studio;
      const ids = extractStudioIdsFromValue(studioServerStatus);
      setDetectedStudioIds(ids);
      if (ids.length > 0) {
        for (const id of ids) addKnownStudioId(id);
      }
    } catch (err) {
      console.error("Failed to detect Roblox Studio sessions:", err);
    } finally {
      setLoadingStudios(false);
    }
  }, [addKnownStudioId, client]);

  useEffect(() => {
    if (!showStudioPicker) return;
    refreshStudios();
  }, [refreshStudios, showStudioPicker]);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isBusy) return;
    const images =
      attachments.length > 0
        ? attachments.map((a) => ({ mime: a.mime, url: a.dataUrl, filename: a.filename }))
        : undefined;
    sendMessage.mutate({
      text: trimmed || " ",
      images,
      preferFastVariant: canAutoUseFastVariant,
    });
    setText("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isBusy) return;
      handleSubmit();
    }
  }

  function handleModelClick(model: ModelInfo) {
    const fullId = `${model.providerId}/${model.id}`;
    setSelectedModel(fullId);
    setShowModelPicker(false);
    setModelSearch("");
  }

  const modelDisplay = selectedModel
    ? (selectedModel.split("/").pop() ?? selectedModel)
    : "Select model";
  const agentDisplay = selectedAgent ?? "Default agent";

  const studioDisplay = preferredStudioId ? `Studio ${preferredStudioId}` : "Auto studio";

  function handleAddStudioId() {
    const entered = window.prompt("Enter Roblox Studio instance ID");
    const normalized = entered?.trim();
    if (!normalized) return;
    addKnownStudioId(normalized);
    setPreferredStudioId(normalized);
    setShowStudioPicker(false);
  }

  function statusBadge(status?: string) {
    if (status === "beta")
      return (
        <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700">
          beta
        </span>
      );
    if (status === "alpha")
      return (
        <span className="shrink-0 rounded bg-purple-100 px-1 text-[9px] font-medium text-purple-700">
          alpha
        </span>
      );
    if (status === "deprecated")
      return (
        <span className="shrink-0 rounded bg-stone-100 px-1 text-[9px] font-medium text-stone-500">
          deprecated
        </span>
      );
    return null;
  }

  function renderProviderGroup(
    providerId: string,
    group: { providerName: string; models: ModelInfo[] },
  ) {
    return (
      <div key={providerId}>
        <div className="flex items-center gap-1.5 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.providerName}
          </span>
        </div>
        {group.models.map((model) => {
          const fullId = `${model.providerId}/${model.id}`;
          const isSelected = selectedModel === fullId;
          return (
            <button
              key={fullId}
              onClick={() => handleModelClick(model)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${isSelected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              <span className="truncate">{model.name}</span>
              {statusBadge(model.status)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      <div className="relative mb-2 flex items-center gap-1">
        <div className="relative" ref={modelPickerRef}>
          <button
            onClick={() => {
              setShowModelPicker(!showModelPicker);
              setShowAgentPicker(false);
              if (showModelPicker) {
                setModelSearch("");
              }
            }}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
            {modelDisplay}
          </button>
          {showModelPicker && (
            <div className="absolute bottom-full left-0 z-50 mb-1 flex max-h-80 w-80 flex-col rounded-lg border bg-popover shadow-lg">
              <div className="shrink-0 border-b px-2 py-1.5">
                <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-muted-foreground/50"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    ref={modelSearchRef}
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models..."
                    className="h-7 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                    autoFocus
                  />
                  {modelSearch && (
                    <button
                      onClick={() => {
                        setModelSearch("");
                        modelSearchRef.current?.focus();
                      }}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-1">
                {modelsByProvider.map(([id, group]) => renderProviderGroup(id, group))}
                {modelsByProvider.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No models matching "{modelSearch}"
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {visibleAgents.length > 1 && (
          <div className="relative" ref={agentPickerRef}>
            <button
              onClick={() => {
                setShowAgentPicker(!showAgentPicker);
                setShowModelPicker(false);
              }}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {agentDisplay}
            </button>
            {showAgentPicker && (
              <div className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                {visibleAgents.map((agent) => {
                  const isSelected = selectedAgent === agent.name;
                  return (
                    <button
                      key={agent.name}
                      onClick={() => {
                        setSelectedAgent(agent.name);
                        setShowAgentPicker(false);
                      }}
                      className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors ${isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                    >
                      <span className="text-xs font-medium">{agent.name}</span>
                      {agent.description && (
                        <span className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
                          {agent.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="relative" ref={studioPickerRef}>
          <button
            onClick={() => {
              setShowStudioPicker(!showStudioPicker);
              setShowModelPicker(false);
              setShowAgentPicker(false);
            }}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Pick a Roblox Studio instance"
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
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 9h6v6H9z" />
            </svg>
            {studioDisplay}
          </button>
          {showStudioPicker && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border bg-popover p-1 shadow-lg">
              <button
                onClick={() => {
                  setPreferredStudioId(null);
                  setShowStudioPicker(false);
                }}
                className={`flex w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${preferredStudioId === null ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                Auto-select studio
              </button>
              {availableStudioIds.map((studioId) => (
                <button
                  key={studioId}
                  onClick={() => {
                    setPreferredStudioId(studioId);
                    setShowStudioPicker(false);
                  }}
                  className={`flex w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${preferredStudioId === studioId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                >
                  {studioId}
                </button>
              ))}
              {availableStudioIds.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {loadingStudios
                    ? "Looking for active Studio sessions…"
                    : "No active Studio sessions detected yet."}
                </div>
              )}
              <button
                onClick={refreshStudios}
                disabled={loadingStudios}
                className="mt-1 flex w-full rounded-md border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingStudios ? "Refreshing…" : "Refresh Studio list"}
              </button>
              <button
                onClick={handleAddStudioId}
                className="mt-1 flex w-full rounded-md border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                + Enter Studio ID manually…
              </button>
            </div>
          )}
        </div>

        {availableVariants.length > 0 && (
          <button
            onClick={() => {
              if (!selectedVariant) setSelectedVariant(availableVariants[0]);
              else {
                const idx = availableVariants.indexOf(selectedVariant);
                if (idx === -1 || idx === availableVariants.length - 1) setSelectedVariant(null);
                else setSelectedVariant(availableVariants[idx + 1]);
              }
            }}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] capitalize text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={`Click to cycle variant (${["default", ...availableVariants].join(" → ")})`}
          >
            {selectedVariant ?? (canAutoUseFastVariant ? "fast (auto)" : "default")}
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addImageFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-xl border bg-background transition-shadow focus-within:ring-2 ring-ring/20 ${isDragging ? "ring-2 ring-blue-400 border-blue-300 bg-blue-50/30" : ""}`}
      >
        {attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1">
            {attachments.map((a, idx) => (
              <div key={a.id} className="group relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setLightboxIndex(idx);
                    setLbSlideDir(null);
                    setLbAnimKey((k) => k + 1);
                  }}
                  className="block cursor-zoom-in overflow-hidden rounded-lg border transition-opacity hover:opacity-80"
                >
                  <img src={a.dataUrl} alt={a.filename} className="h-16 w-16 object-cover" />
                </button>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
                  title="Remove"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <div className="mt-0.5 max-w-[64px] truncate text-center text-[9px] text-muted-foreground">
                  {a.filename}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-1 px-3 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`mt-0.5 shrink-0 p-0.5 transition-colors hover:text-foreground ${rejectShake ? "animate-reject-shake text-red-500" : "text-muted-foreground/60"}`}
            title="Attach images"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              resizeTextarea(e.target);
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const items = e.clipboardData.items;
              const imageFiles: File[] = [];
              for (const item of Array.from(items)) {
                if (item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
                  const file = item.getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                addImageFiles(imageFiles);
              }
            }}
            placeholder={isDragging ? "Drop images here..." : "Describe what you want to build..."}
            rows={1}
            className="max-h-40 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <SendButton text={text} hasAttachments={attachments.length > 0} onSend={handleSubmit} />
        </div>
      </div>

      <StatusHint />

      {lightboxIndex !== null && attachments[lightboxIndex] && (
        <LightboxOverlay
          urls={lightboxUrls}
          index={lightboxIndex}
          slideDir={lbSlideDir}
          animKey={lbAnimKey}
          onClose={closeLightbox}
          onPrev={lightboxPrev}
          onNext={lightboxNext}
        />
      )}
    </div>
  );
}

export default ChatInput;
