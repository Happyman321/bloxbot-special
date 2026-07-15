import { openUrl } from "@tauri-apps/plugin-opener";
import type { ClipboardEvent } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useAddImageGeneration,
  useCreateImageProject,
  useDeleteImageProject,
  useImageProjects,
  useRenameImageProject,
} from "@/hooks/useImageProjects";
import { createImageTurn, createImageUsageRecord } from "@/lib/imageProjects";
import {
  aggregateImageSpend,
  clearOpenRouterApiKey,
  estimateOpenRouterImageCost,
  fetchOpenRouterCredits,
  fetchOpenRouterImageModels,
  filterAndSortOpenRouterImageModels,
  formatOpenRouterPrice,
  generateOpenRouterImage,
  loadOpenRouterImageConfig,
  makeImageResult,
  normalizeImageGenerationSettings,
  saveOpenRouterApiKey,
} from "@/lib/openRouterImages";
import type {
  ImageGenerationSettings,
  ImageProject,
  ImageReference,
  ImageResult,
  ImageTurn,
  OpenRouterCredits,
  OpenRouterImageModel,
} from "@/types/image";

const ACCEPTED_REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_REFERENCE_SIZE = 20 * 1024 * 1024;
const MAX_REFERENCES = 4;

function formatTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCurrency(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0.0000";
  return `$${value.toFixed(4)}`;
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function imageDownloadFilename(modelId: string, index: number) {
  return `bloxbot-${modelId.replace(/[^a-z0-9]+/gi, "-")}-${index + 1}.png`;
}

function projectPreview(project: ImageProject): string | null {
  const result = project.results[project.results.length - 1];
  if (result?.dataUrl) return result.dataUrl;
  for (let index = project.turns.length - 1; index >= 0; index--) {
    const reference = project.turns[index].references[0];
    if (reference?.dataUrl) return reference.dataUrl;
  }
  return null;
}

const ImageProjectSidebar = memo(function ImageProjectSidebar({
  projects,
  activeProjectId,
  onSelect,
  onCreate,
  onDelete,
}: {
  projects: ImageProject[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onDelete: (projectId: string) => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-10 items-center justify-between border-b px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Image projects
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="New image project"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <line x1="12" y1="5" x2="12" y2="19" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No image projects yet.
          </div>
        ) : (
          projects.map((project) => {
            const preview = projectPreview(project);
            const isActive = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-md p-1.5 transition-colors ${
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60"
                }`}
                onClick={() => onSelect(project.id)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-background">
                  {preview ? (
                    <img src={preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-muted-foreground/60"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{project.title}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatTime(project.updatedAt)}
                  </div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">
                    {project.results.length} image{project.results.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(project.id);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                  title="Delete image project"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <line x1="18" y1="6" x2="6" y2="18" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
});

function ConnectionPanel({
  apiKey,
  draftKey,
  credits,
  loading,
  error,
  onDraftKey,
  onConnect,
  onDisconnect,
  onRefresh,
}: {
  apiKey: string | null;
  draftKey: string;
  credits: OpenRouterCredits | null;
  loading: boolean;
  error: string | null;
  onDraftKey: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="flex flex-col gap-2 min-[1180px]:flex-row min-[1180px]:items-center min-[1180px]:justify-between">
        <div>
          <div className="text-xs font-semibold">OpenRouter</div>
          <div className="text-[11px] text-muted-foreground">
            Image generations spend OpenRouter credits.
          </div>
        </div>
        {apiKey && (
          <button
            type="button"
            onClick={onDisconnect}
            className="h-7 rounded-md border px-2 text-[11px] hover:bg-accent"
          >
            Disconnect
          </button>
        )}
      </div>
      {!apiKey ? (
        <div className="mt-3 flex flex-col gap-2 min-[1180px]:flex-row">
          <input
            type="password"
            value={draftKey}
            onChange={(event) => onDraftKey(event.target.value)}
            placeholder="sk-or-..."
            className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs outline-none ring-ring focus-visible:ring-1"
          />
          <button
            type="button"
            onClick={onConnect}
            disabled={!draftKey.trim() || loading}
            className="h-8 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-40"
          >
            Connect
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] min-[1180px]:grid-cols-3">
          <div className="rounded-md border bg-card p-2">
            <div className="text-muted-foreground">Remaining</div>
            <div className="mt-1 font-semibold">{formatCurrency(credits?.remainingCredits)}</div>
          </div>
          <div className="rounded-md border bg-card p-2">
            <div className="text-muted-foreground">Credits</div>
            <div className="mt-1 font-semibold">{formatCurrency(credits?.totalCredits)}</div>
          </div>
          <div className="rounded-md border bg-card p-2">
            <div className="text-muted-foreground">Used</div>
            <div className="mt-1 font-semibold">{formatCurrency(credits?.totalUsage)}</div>
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-col gap-2 min-[1180px]:flex-row min-[1180px]:items-center min-[1180px]:justify-between">
        <button
          type="button"
          onClick={() => openUrl("https://openrouter.ai/keys")}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          OpenRouter keys
        </button>
        {apiKey && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 rounded-md border px-2 text-[11px] hover:bg-accent disabled:opacity-40"
          >
            Refresh
          </button>
        )}
      </div>
      {error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

function ImageSettingsPanel({
  isOpen,
  apiKey,
  draftKey,
  credits,
  connectionError,
  loading,
  models,
  selectedModel,
  selectedModelId,
  settings,
  modelSearch,
  providerFilter,
  sortMode,
  localSpend,
  onDraftKey,
  onConnect,
  onDisconnect,
  onRefresh,
  onModelChange,
  onSettingsChange,
  onModelSearch,
  onProviderFilter,
  onSortMode,
  onToggle,
}: {
  isOpen: boolean;
  apiKey: string | null;
  draftKey: string;
  credits: OpenRouterCredits | null;
  connectionError: string | null;
  loading: boolean;
  models: OpenRouterImageModel[];
  selectedModel: OpenRouterImageModel | null;
  selectedModelId: string;
  settings: ImageGenerationSettings;
  modelSearch: string;
  providerFilter: string;
  sortMode: "name" | "price";
  localSpend: { today: number; month: number; allTime: number };
  onDraftKey: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onModelChange: (modelId: string) => void;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
  onModelSearch: (value: string) => void;
  onProviderFilter: (value: string) => void;
  onSortMode: (value: "name" | "price") => void;
  onToggle: () => void;
}) {
  const providers = useMemo(
    () => ["all", ...Array.from(new Set(models.map((model) => model.providerName))).sort()],
    [models],
  );
  const visibleModels = useMemo(
    () =>
      filterAndSortOpenRouterImageModels(models, {
        query: modelSearch,
        provider: providerFilter,
        sort: sortMode,
      }),
    [modelSearch, models, providerFilter, sortMode],
  );
  const costEstimate = selectedModel ? estimateOpenRouterImageCost(selectedModel, settings) : null;

  function patchSettings(patch: Partial<ImageGenerationSettings>) {
    const nextSettings = { ...settings, ...patch };
    onSettingsChange(
      selectedModel ? normalizeImageGenerationSettings(selectedModel, nextSettings) : nextSettings,
    );
  }

  if (!isOpen) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l bg-card py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Open image settings"
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
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="mt-3 rotate-90 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Settings
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[18rem] min-w-[14rem] max-w-[36vw] shrink-0 overflow-y-auto border-l bg-card p-3 min-[1180px]:w-80 min-[1180px]:p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Image settings
        </h3>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Collapse image settings"
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
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
      <div className="space-y-4">
        <ConnectionPanel
          apiKey={apiKey}
          draftKey={draftKey}
          credits={credits}
          loading={loading}
          error={connectionError}
          onDraftKey={onDraftKey}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onRefresh={onRefresh}
        />

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="mb-2 text-xs font-semibold">BloxBot image spend</div>
          <div className="grid grid-cols-1 gap-2 text-[11px] min-[1180px]:grid-cols-3">
            <div className="rounded-md border bg-card p-2">
              <div className="text-muted-foreground">Today</div>
              <div className="mt-1 font-semibold">{formatCurrency(localSpend.today)}</div>
            </div>
            <div className="rounded-md border bg-card p-2">
              <div className="text-muted-foreground">Month</div>
              <div className="mt-1 font-semibold">{formatCurrency(localSpend.month)}</div>
            </div>
            <div className="rounded-md border bg-card p-2">
              <div className="text-muted-foreground">All</div>
              <div className="mt-1 font-semibold">{formatCurrency(localSpend.allTime)}</div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <input
            value={modelSearch}
            onChange={(event) => onModelSearch(event.target.value)}
            placeholder="Search image models..."
            className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-1"
          />
          <div className="grid grid-cols-1 gap-2 min-[1180px]:grid-cols-2">
            <select
              value={providerFilter}
              onChange={(event) => onProviderFilter(event.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs outline-none"
            >
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === "all" ? "All providers" : provider}
                </option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(event) => onSortMode(event.target.value as "name" | "price")}
              className="h-8 rounded-md border bg-background px-2 text-xs outline-none"
            >
              <option value="price">Sort by price</option>
              <option value="name">Sort by name</option>
            </select>
          </div>
          <div className="rounded-md border bg-background">
            <div className="border-b px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
              {apiKey ? "OpenRouter image models" : "Connect OpenRouter to load models"}
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {visibleModels.length === 0 ? (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {apiKey ? "No image models match this filter." : "No models loaded."}
                </div>
              ) : (
                visibleModels.map((model) => {
                  const selected = model.id === selectedModelId;
                  return (
                    <button
                      type="button"
                      key={model.id}
                      onClick={() => onModelChange(model.id)}
                      disabled={!apiKey}
                      className={`mb-1 w-full rounded-md border px-2 py-2 text-left transition-colors last:mb-0 disabled:opacity-50 ${
                        selected
                          ? "border-foreground bg-accent text-foreground"
                          : "border-transparent hover:bg-accent/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="break-words text-xs font-medium leading-snug">
                            {model.name}
                          </div>
                          <div className="mt-0.5 break-all text-[10px] text-muted-foreground">
                            {model.id}
                          </div>
                        </div>
                        <div className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-right text-[10px] font-medium text-muted-foreground">
                          {formatOpenRouterPrice(model)}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {selectedModel && (
            <div className="rounded-md border bg-background/70 p-2 text-[11px] leading-relaxed text-muted-foreground">
              <div className="font-medium text-foreground">{selectedModel.id}</div>
              <div>{formatOpenRouterPrice(selectedModel)}</div>
              {selectedModel.description && <div className="mt-1">{selectedModel.description}</div>}
            </div>
          )}
        </div>

        {selectedModel && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Aspect ratio
              </span>
              <select
                value={settings.aspectRatio ?? "1:1"}
                onChange={(event) => patchSettings({ aspectRatio: event.target.value })}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none"
              >
                {selectedModel.supportedAspectRatios.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Image size
              </span>
              <select
                value={settings.imageSize ?? "1024x1024"}
                onChange={(event) => patchSettings({ imageSize: event.target.value })}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none"
              >
                {selectedModel.supportedImageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Images
              </span>
              <select
                value={settings.outputCount ?? 1}
                onChange={(event) => patchSettings({ outputCount: Number(event.target.value) })}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none"
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            {costEstimate && (
              <div className="rounded-md border bg-background/70 p-2 text-[11px] leading-relaxed">
                <div className="font-medium text-foreground">{costEstimate.label}</div>
                <div className="mt-1 text-muted-foreground">{costEstimate.basis}</div>
                <div className="mt-1 text-muted-foreground">
                  Actual charge is recorded from OpenRouter after generation.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function ImageMode() {
  const { data: projects = [] } = useImageProjects();
  const createProject = useCreateImageProject();
  const deleteProject = useDeleteImageProject();
  const renameProject = useRenameImageProject();
  const addGeneration = useAddImageGeneration();

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(false);
  const [models, setModels] = useState<OpenRouterImageModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [sortMode, setSortMode] = useState<"name" | "price">("price");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [pendingTurns, setPendingTurns] = useState<Record<string, ImageTurn[]>>({});
  const [previewImage, setPreviewImage] = useState<{
    result: ImageResult;
    modelId: string;
    index: number;
  } | null>(null);
  const [settings, setSettings] = useState<ImageGenerationSettings>({
    aspectRatio: "1:1",
    imageSize: "1K",
    outputCount: 1,
  });
  const [references, setReferences] = useState<ImageReference[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const allUsageRecords = projects.flatMap((project) => project.usageRecords);
  const localSpend = aggregateImageSpend(allUsageRecords);
  const activePendingTurns = activeProject ? (pendingTurns[activeProject.id] ?? []) : [];
  const visibleTurns = activeProject ? [...activeProject.turns, ...activePendingTurns] : [];
  const isGenerating = activePendingTurns.length > 0 || addGeneration.isPending;
  const canSubmit =
    !!apiKey && !!activeProject && !!selectedModel && !!prompt.trim() && !isGenerating;

  async function refreshOpenRouter(key = apiKey) {
    if (!key) return;
    setLoadingConnection(true);
    setConnectionError(null);
    try {
      const [nextModels, nextCredits] = await Promise.all([
        fetchOpenRouterImageModels(key),
        fetchOpenRouterCredits(key).catch(() => null),
      ]);
      setModels(nextModels);
      setCredits(nextCredits);
      if (!selectedModelId && nextModels[0]) setSelectedModelId(nextModels[0].id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionError(message);
      toast.error("OpenRouter connection failed", { description: message });
    } finally {
      setLoadingConnection(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Load the persisted OpenRouter key once on mount.
  useEffect(() => {
    loadOpenRouterImageConfig().then((config) => {
      setApiKey(config.apiKey);
      if (config.apiKey) refreshOpenRouter(config.apiKey);
    });
  }, []);

  useEffect(() => {
    if (!activeProjectId && projects[0]) setActiveProjectId(projects[0].id);
    if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(projects[0]?.id ?? null);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!selectedModel) return;
    setSettings((current) => {
      const normalized = normalizeImageGenerationSettings(selectedModel, current);
      if (
        normalized.aspectRatio === current.aspectRatio &&
        normalized.imageSize === current.imageSize &&
        normalized.outputCount === current.outputCount
      ) {
        return current;
      }
      return normalized;
    });
  }, [selectedModel]);

  async function handleConnect() {
    const key = draftKey.trim();
    if (!key) return;
    await saveOpenRouterApiKey(key);
    setApiKey(key);
    setDraftKey("");
    await refreshOpenRouter(key);
  }

  async function handleDisconnect() {
    await clearOpenRouterApiKey();
    setApiKey(null);
    setCredits(null);
    setModels([]);
    setSelectedModelId("");
    setConnectionError(null);
  }

  async function handleCreateProject() {
    const project = await createProject.mutateAsync("New image project");
    setActiveProjectId(project.id);
  }

  function handleRename() {
    if (!activeProject) return;
    const next = window.prompt("Image project name", activeProject.title);
    if (!next?.trim()) return;
    renameProject.mutate({ projectId: activeProject.id, title: next.trim() });
  }

  async function addReferenceFiles(files: FileList | File[]) {
    const fileList = Array.from(files);
    const remaining = MAX_REFERENCES - references.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_REFERENCES} reference images allowed`);
      return;
    }
    const accepted = fileList.slice(0, remaining).filter((file) => {
      if (!ACCEPTED_REFERENCE_TYPES.includes(file.type)) {
        toast.error("Use PNG, JPEG, or WebP reference images.");
        return false;
      }
      if (file.size > MAX_REFERENCE_SIZE) {
        toast.error("Reference images must be under 20 MB.");
        return false;
      }
      return true;
    });
    const loaded = await Promise.all(
      accepted.map(async (file) => ({
        id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        dataUrl: await fileToDataURL(file),
        mime: file.type,
        filename: file.name,
        createdAt: Date.now(),
      })),
    );
    setReferences((prev) => [...prev, ...loaded]);
  }

  function handlePromptPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) return;
    event.preventDefault();
    if (!selectedModel?.supportsReferenceImages) {
      toast.error("The selected model does not support pasted reference images.");
      return;
    }
    addReferenceFiles(imageFiles);
  }

  async function handleSubmit() {
    if (!apiKey || !activeProject || !selectedModel || !prompt.trim() || isGenerating) return;
    const requestPrompt = prompt.trim();
    const requestReferences = references;
    const projectId = activeProject.id;
    const pendingTurn = createImageTurn({
      source: "openrouter",
      prompt: requestPrompt,
      openRouterModelId: selectedModel.id,
      modelName: selectedModel.name,
      settings,
      references: requestReferences,
      resultIds: [],
      status: "pending",
      statusMessage: "Request sent. OpenRouter is generating your image.",
    });
    setPrompt("");
    setReferences([]);
    setPendingTurns((current) => ({
      ...current,
      [projectId]: [...(current[projectId] ?? []), pendingTurn],
    }));

    try {
      const response = await generateOpenRouterImage({
        apiKey,
        model: selectedModel,
        prompt: requestPrompt,
        settings,
        references: requestReferences,
      });
      if (response.images.length === 0) {
        throw new Error("OpenRouter response did not include image data.");
      }
      const createdAt = Date.now();
      const results = response.images.map((image) =>
        makeImageResult({
          dataUrl: image.dataUrl,
          mime: image.mime,
          prompt: requestPrompt,
          modelId: selectedModel.id,
          settings,
          createdAt,
        }),
      );
      const usageRecord = createImageUsageRecord({
        modelId: selectedModel.id,
        prompt: requestPrompt,
        imageCount: results.length,
        cost: response.cost,
        usage: response.usage,
        responseId: response.responseId,
      });
      const turn = createImageTurn({
        source: "openrouter",
        prompt: requestPrompt,
        openRouterModelId: selectedModel.id,
        modelName: selectedModel.name,
        settings,
        references: requestReferences,
        resultIds: results.map((result) => result.id),
        status: "completed",
        statusMessage: `Generated ${results.length} image${results.length === 1 ? "" : "s"} through OpenRouter.`,
        cost: response.cost,
        usage: response.usage,
        responseId: response.responseId,
      });
      await addGeneration.mutateAsync({
        projectId,
        turn,
        results,
        usageRecord,
      });
      toast.success("Image generated", {
        description:
          typeof response.cost === "number"
            ? `OpenRouter reported ${formatCurrency(response.cost)} for this request.`
            : "OpenRouter did not return cost details for this request.",
      });
      refreshOpenRouter(apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const turn = createImageTurn({
        source: "openrouter",
        prompt: requestPrompt,
        openRouterModelId: selectedModel.id,
        modelName: selectedModel.name,
        settings,
        references: requestReferences,
        resultIds: [],
        status: "failed",
        statusMessage: message,
      });
      await addGeneration.mutateAsync({ projectId, turn, results: [] });
      toast.error("Image generation failed", { description: message });
    } finally {
      setPendingTurns((current) => ({
        ...current,
        [projectId]: (current[projectId] ?? []).filter((turn) => turn.id !== pendingTurn.id),
      }));
    }
  }

  function reuseTurn(turnPrompt: string, turnSettings: ImageGenerationSettings) {
    setPrompt(turnPrompt);
    setSettings(turnSettings);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ImageProjectSidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelect={setActiveProjectId}
        onCreate={handleCreateProject}
        onDelete={(projectId) => deleteProject.mutate(projectId)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b px-4">
          <button
            type="button"
            onClick={handleRename}
            disabled={!activeProject}
            className="truncate text-left text-xs font-semibold disabled:cursor-default"
            title="Rename image project"
          >
            {activeProject?.title ?? "OpenRouter image generation"}
          </button>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
            OpenRouter credits are used for generations
          </div>
        </div>

        {!activeProject ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="text-center">
              <h2 className="font-serif text-2xl italic text-foreground">
                What should the image look like?
              </h2>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Connect OpenRouter, pick an image model, and keep generations organized by project.
              </p>
              <button
                type="button"
                onClick={handleCreateProject}
                className="mt-5 h-9 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                New image project
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {visibleTurns.length === 0 ? (
                <div className="flex min-h-full items-center justify-center">
                  <div className="max-w-md text-center">
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-lg border bg-card">
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-muted-foreground"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold">No OpenRouter images yet</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Choose a model, describe the image, then generate. Costs are tracked locally
                      when OpenRouter returns usage data.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-5xl space-y-4">
                  {visibleTurns.map((turn) => {
                    const results = activeProject.results.filter((result) =>
                      turn.resultIds.includes(result.id),
                    );
                    return (
                      <div key={turn.id} className="rounded-lg border bg-card p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-muted-foreground">
                              {turn.modelName} - {formatTime(turn.createdAt)}
                              {typeof turn.cost === "number"
                                ? ` - ${formatCurrency(turn.cost)}`
                                : ""}
                            </div>
                            <p className="mt-1 text-sm leading-relaxed">{turn.prompt}</p>
                          </div>
                          {turn.status !== "pending" && (
                            <button
                              type="button"
                              onClick={() => reuseTurn(turn.prompt, turn.settings)}
                              className="h-7 shrink-0 rounded-md border px-2 text-[11px] font-medium hover:bg-accent"
                            >
                              Reuse
                            </button>
                          )}
                        </div>
                        {turn.status === "pending" && (
                          <div className="mt-3 rounded-lg border bg-background/70 p-3">
                            <div className="flex items-center gap-2 text-xs font-medium">
                              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                              Generating image
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              OpenRouter accepted the request. This can take a little while for
                              image models.
                            </div>
                          </div>
                        )}
                        {results.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                            {results.map((result, index) => (
                              <div
                                key={result.id}
                                className="group overflow-hidden rounded-lg border bg-background"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewImage({
                                      result,
                                      modelId: turn.openRouterModelId,
                                      index,
                                    })
                                  }
                                  className="block w-full"
                                  title="Open image preview"
                                >
                                  <img
                                    src={result.dataUrl}
                                    alt={result.prompt}
                                    className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                                  />
                                </button>
                                <div className="flex items-center justify-between gap-2 border-t px-2 py-1">
                                  <div className="min-w-0 truncate text-[10px] text-muted-foreground">
                                    Preview
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadDataUrl(
                                        result.dataUrl,
                                        imageDownloadFilename(turn.openRouterModelId, index),
                                      )
                                    }
                                    className="h-6 rounded border px-2 text-[10px] font-medium hover:bg-accent"
                                    title="Download image"
                                  >
                                    Download
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {turn.references.length > 0 && (
                          <div className="mt-3 flex gap-2 overflow-x-auto">
                            {turn.references.map((reference) => (
                              <img
                                key={reference.id}
                                src={reference.dataUrl}
                                alt={reference.filename}
                                className="h-14 w-14 rounded-md border object-cover"
                              />
                            ))}
                          </div>
                        )}
                        <div
                          className={`mt-3 rounded-md border px-2 py-1.5 text-xs ${
                            turn.status === "failed"
                              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                              : "bg-background/70 text-muted-foreground"
                          }`}
                        >
                          {turn.statusMessage}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t bg-card p-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) addReferenceFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              {references.length > 0 && (
                <div className="mb-2 flex gap-2 overflow-x-auto">
                  {references.map((reference) => (
                    <div key={reference.id} className="group relative shrink-0">
                      <img
                        src={reference.dataUrl}
                        alt={reference.filename}
                        className="h-14 w-14 rounded-md border object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setReferences((prev) => prev.filter((item) => item.id !== reference.id))
                        }
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 group-hover:opacity-100"
                        title="Remove reference"
                      >
                        <svg
                          width="8"
                          height="8"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                        >
                          <line
                            x1="18"
                            y1="6"
                            x2="6"
                            y2="18"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                          <line
                            x1="6"
                            y1="6"
                            x2="18"
                            y2="18"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-xl border bg-background">
                <div className="flex items-start gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!selectedModel?.supportsReferenceImages}
                    className="mt-0.5 p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                    title="Attach reference images"
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
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </button>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onPaste={handlePromptPaste}
                    placeholder={
                      apiKey
                        ? "Describe the image, or paste reference images here..."
                        : "Connect OpenRouter before generating images..."
                    }
                    rows={2}
                    className="max-h-36 min-h-10 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                  />
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-30"
                    title="Generate with OpenRouter"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 3v18" />
                      <path d="M5 10l7-7 7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <ImageSettingsPanel
        isOpen={settingsOpen}
        apiKey={apiKey}
        draftKey={draftKey}
        credits={credits}
        connectionError={connectionError}
        loading={loadingConnection}
        models={models}
        selectedModel={selectedModel}
        selectedModelId={selectedModelId}
        settings={settings}
        modelSearch={modelSearch}
        providerFilter={providerFilter}
        sortMode={sortMode}
        localSpend={localSpend}
        onDraftKey={setDraftKey}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefresh={() => refreshOpenRouter()}
        onModelChange={setSelectedModelId}
        onSettingsChange={setSettings}
        onModelSearch={setModelSearch}
        onProviderFilter={setProviderFilter}
        onSortMode={setSortMode}
        onToggle={() => setSettingsOpen((prev) => !prev)}
      />
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
              <div className="min-w-0 truncate text-xs font-medium">
                {previewImage.result.prompt}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadDataUrl(
                      previewImage.result.dataUrl,
                      imageDownloadFilename(previewImage.modelId, previewImage.index),
                    )
                  }
                  className="h-7 rounded-md border px-2 text-[11px] font-medium hover:bg-accent"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Close preview"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <line x1="18" y1="6" x2="6" y2="18" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-background p-3">
              <img
                src={previewImage.result.dataUrl}
                alt={previewImage.result.prompt}
                className="mx-auto max-h-[78vh] max-w-full rounded-md object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImageMode;
