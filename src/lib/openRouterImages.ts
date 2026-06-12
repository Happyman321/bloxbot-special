import { LazyStore } from "@tauri-apps/plugin-store";
import type {
  ImageGenerationSettings,
  ImageResult,
  ImageUsageRecord,
  OpenRouterCredits,
  OpenRouterImageModel,
  OpenRouterPricing,
} from "@/types/image";

const configStore = new LazyStore("bloxbot-openrouter-images.json");
const API_KEY = "openRouterApiKey";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const EXTENDED_GEMINI_ASPECT_RATIOS = ["1:4", "4:1", "1:8", "8:1"];
const DEFAULT_IMAGE_SIZES = ["1K", "2K", "4K"];
const OPENAI_IMAGE_SIZES = ["1K", "2K"];
const LEGACY_PIXEL_SIZE_TO_OPENROUTER_SIZE: Record<string, string> = {
  "1024x1024": "1K",
  "1344x768": "1K",
  "768x1344": "1K",
  "1184x864": "1K",
  "864x1184": "1K",
  "1536x1024": "1K",
  "1024x1536": "1K",
  "2048x2048": "2K",
  "2048x1152": "2K",
  "3840x2160": "4K",
  "2160x3840": "4K",
};
const ESTIMATED_PROMPT_TOKENS = 300;
const ESTIMATED_IMAGE_OUTPUT_TOKENS = 4000;

export interface OpenRouterImageConfig {
  apiKey: string | null;
}

export interface OpenRouterGenerateInput {
  apiKey: string;
  model: OpenRouterImageModel;
  prompt: string;
  settings: ImageGenerationSettings;
  references: Array<{ dataUrl: string; mime: string; filename: string }>;
}

export interface OpenRouterGenerateResult {
  responseId?: string;
  images: Array<{ dataUrl: string; mime: string }>;
  usage?: unknown;
  cost?: number;
}

type OpenRouterModelPayload = {
  id?: string;
  name?: string;
  description?: string;
  pricing?: OpenRouterPricing;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  top_provider?: {
    name?: string;
  };
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
};

export async function loadOpenRouterImageConfig(): Promise<OpenRouterImageConfig> {
  const apiKey = await configStore.get<string>(API_KEY).catch(() => null);
  return { apiKey: apiKey?.trim() || null };
}

export async function saveOpenRouterApiKey(apiKey: string): Promise<void> {
  await configStore.set(API_KEY, apiKey.trim());
}

export async function clearOpenRouterApiKey(): Promise<void> {
  await configStore.delete(API_KEY);
}

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://bloxbot.ai",
    "X-Title": "BloxBot",
  };
}

function providerFromModelId(id: string): string {
  const [provider] = id.split("/");
  return provider || "OpenRouter";
}

function normalizeModalities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function priceNumber(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDollars(value: number): string {
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  if (value > 0) return `$${value.toPrecision(2)}`;
  return "$0.0000";
}

function getModelImageCapabilities(id: string) {
  if (id.startsWith("openai/")) {
    return {
      supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
      supportedImageSizes: OPENAI_IMAGE_SIZES,
    };
  }
  if (id === "google/gemini-3.1-flash-image-preview") {
    return {
      supportedAspectRatios: [...DEFAULT_ASPECT_RATIOS, ...EXTENDED_GEMINI_ASPECT_RATIOS],
      supportedImageSizes: ["0.5K", ...DEFAULT_IMAGE_SIZES],
    };
  }
  return {
    supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
    supportedImageSizes: DEFAULT_IMAGE_SIZES,
  };
}

export function normalizeOpenRouterImageModel(
  raw: OpenRouterModelPayload,
): OpenRouterImageModel | null {
  if (!raw.id) return null;
  const inputModalities = normalizeModalities(
    raw.input_modalities ?? raw.architecture?.input_modalities,
  );
  const outputModalities = normalizeModalities(
    raw.output_modalities ?? raw.architecture?.output_modalities,
  );
  if (!outputModalities.includes("image")) return null;
  const capabilities = getModelImageCapabilities(raw.id);

  return {
    id: raw.id,
    name: raw.name || raw.id,
    providerName: raw.top_provider?.name || providerFromModelId(raw.id),
    description: raw.description,
    pricing: raw.pricing,
    inputModalities,
    outputModalities,
    supportedAspectRatios: capabilities.supportedAspectRatios,
    supportedImageSizes: capabilities.supportedImageSizes,
    supportsReferenceImages: inputModalities.includes("image"),
  };
}

export function normalizeImageGenerationSettings(
  model: OpenRouterImageModel,
  settings: ImageGenerationSettings,
): ImageGenerationSettings {
  const imageSize =
    settings.imageSize && model.supportedImageSizes.includes(settings.imageSize)
      ? settings.imageSize
      : settings.imageSize
        ? LEGACY_PIXEL_SIZE_TO_OPENROUTER_SIZE[settings.imageSize]
        : undefined;
  return {
    aspectRatio:
      settings.aspectRatio && model.supportedAspectRatios.includes(settings.aspectRatio)
        ? settings.aspectRatio
        : model.supportedAspectRatios[0],
    imageSize:
      imageSize && model.supportedImageSizes.includes(imageSize)
        ? imageSize
        : model.supportedImageSizes[0],
    outputCount: settings.outputCount,
  };
}

export function formatOpenRouterPrice(model: OpenRouterImageModel): string {
  const image = priceNumber(model.pricing?.image);
  if (image !== null) return `${formatDollars(image)} / image`;
  const completion = priceNumber(model.pricing?.completion);
  if (completion !== null) return `${formatDollars(completion * 1_000_000)} / 1M output`;
  const prompt = priceNumber(model.pricing?.prompt);
  if (prompt !== null) return `${formatDollars(prompt * 1_000_000)} / 1M input`;
  return "Price unavailable";
}

export function estimateComparableModelPrice(model: OpenRouterImageModel): number {
  const image = priceNumber(model.pricing?.image);
  if (image !== null) return image;
  const completion = priceNumber(model.pricing?.completion);
  const prompt = priceNumber(model.pricing?.prompt);
  if (completion === null && prompt === null) return Number.POSITIVE_INFINITY;
  return (
    (completion ?? 0) * ESTIMATED_IMAGE_OUTPUT_TOKENS + (prompt ?? 0) * ESTIMATED_PROMPT_TOKENS
  );
}

function imageSizeFactor(settings: ImageGenerationSettings): number {
  const match = /^(\d+)x(\d+)$/.exec(settings.imageSize ?? "");
  if (!match) return 1;
  const pixels = Number(match[1]) * Number(match[2]);
  if (!Number.isFinite(pixels) || pixels <= 0) return 1;
  return Math.max(0.75, Math.min(2, pixels / (1024 * 1024)));
}

export function estimateOpenRouterImageCost(
  model: OpenRouterImageModel,
  settings: ImageGenerationSettings,
): { amount: number | null; label: string; basis: string } {
  const count = Math.max(1, settings.outputCount ?? 1);
  const image = priceNumber(model.pricing?.image);
  if (image !== null) {
    const amount = image * count;
    return {
      amount,
      label: `${formatDollars(amount)} est. request`,
      basis: `${formatDollars(image)} per image from OpenRouter pricing`,
    };
  }

  const prompt = priceNumber(model.pricing?.prompt);
  const completion = priceNumber(model.pricing?.completion);
  if (prompt === null && completion === null) {
    return {
      amount: null,
      label: "Estimate unavailable",
      basis: "OpenRouter did not publish image or token pricing for this model.",
    };
  }

  const factor = imageSizeFactor(settings);
  const amount =
    ((prompt ?? 0) * ESTIMATED_PROMPT_TOKENS +
      (completion ?? 0) * ESTIMATED_IMAGE_OUTPUT_TOKENS * factor) *
    count;

  return {
    amount,
    label: `${formatDollars(amount)} rough est.`,
    basis: `Rough token estimate using ${ESTIMATED_IMAGE_OUTPUT_TOKENS} output tokens at 1024px scale.`,
  };
}

export function filterAndSortOpenRouterImageModels(
  models: OpenRouterImageModel[],
  options: { query: string; provider: string; sort: "name" | "price" },
): OpenRouterImageModel[] {
  const query = options.query.trim().toLowerCase();
  return models
    .filter((model) => {
      if (options.provider !== "all" && model.providerName !== options.provider) return false;
      if (!query) return true;
      return `${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (options.sort === "price") {
        return estimateComparableModelPrice(a) - estimateComparableModelPrice(b);
      }
      return a.name.localeCompare(b.name);
    });
}

export async function fetchOpenRouterImageModels(apiKey: string): Promise<OpenRouterImageModel[]> {
  const response = await fetch(`${OPENROUTER_BASE}/models?output_modalities=image`, {
    headers: authHeaders(apiKey),
  });
  if (!response.ok) throw new Error(`OpenRouter models failed: ${response.status}`);
  const payload = (await response.json()) as { data?: OpenRouterModelPayload[] };
  return (payload.data ?? [])
    .map(normalizeOpenRouterImageModel)
    .filter((model): model is OpenRouterImageModel => model !== null);
}

export async function fetchOpenRouterCredits(apiKey: string): Promise<OpenRouterCredits> {
  const response = await fetch(`${OPENROUTER_BASE}/credits`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenRouter credits failed: ${response.status}`);
  const payload = (await response.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  const totalCredits = payload.data?.total_credits ?? 0;
  const totalUsage = payload.data?.total_usage ?? 0;
  return {
    totalCredits,
    totalUsage,
    remainingCredits: totalCredits - totalUsage,
  };
}

function dataUrlMime(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  return match?.[1] ?? "image/png";
}

export function parseOpenRouterImageResponse(payload: unknown): OpenRouterGenerateResult {
  const record = payload as {
    id?: string;
    usage?: { cost?: number; [key: string]: unknown };
    choices?: Array<{
      message?: {
        images?: Array<{
          image_url?: { url?: string };
          imageUrl?: { url?: string };
        }>;
        content?: unknown;
      };
    }>;
  };

  const images: Array<{ dataUrl: string; mime: string }> = [];
  for (const choice of record.choices ?? []) {
    for (const image of choice.message?.images ?? []) {
      const dataUrl = image.image_url?.url ?? image.imageUrl?.url;
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
        images.push({ dataUrl, mime: dataUrlMime(dataUrl) });
      }
    }
  }

  return {
    responseId: record.id,
    images,
    usage: record.usage,
    cost: typeof record.usage?.cost === "number" ? record.usage.cost : undefined,
  };
}

export async function generateOpenRouterImage(
  input: OpenRouterGenerateInput,
): Promise<OpenRouterGenerateResult> {
  const settings = normalizeImageGenerationSettings(input.model, input.settings);
  const content =
    input.references.length > 0
      ? [
          { type: "text", text: input.prompt },
          ...input.references.map((reference) => ({
            type: "image_url",
            image_url: { url: reference.dataUrl },
          })),
        ]
      : input.prompt;

  const modalities = input.model.outputModalities.includes("text") ? ["image", "text"] : ["image"];
  const imageConfig: Record<string, string | number> = {};
  if (settings.aspectRatio) imageConfig.aspect_ratio = settings.aspectRatio;
  if (settings.imageSize) imageConfig.image_size = settings.imageSize;
  if (settings.outputCount && settings.outputCount > 1) {
    imageConfig.num_images = settings.outputCount;
  }

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model.id,
      messages: [{ role: "user", content }],
      modalities,
      stream: false,
      ...(Object.keys(imageConfig).length > 0 ? { image_config: imageConfig } : {}),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter generation failed: ${response.status}${text ? ` ${text}` : ""}`);
  }
  return parseOpenRouterImageResponse(await response.json());
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function aggregateImageSpend(records: ImageUsageRecord[]) {
  const today = startOfToday();
  const month = startOfMonth();
  const sum = (items: ImageUsageRecord[]) =>
    items.reduce((total, item) => total + (item.cost ?? 0), 0);
  return {
    today: sum(records.filter((record) => record.createdAt >= today)),
    month: sum(records.filter((record) => record.createdAt >= month)),
    allTime: sum(records),
  };
}

export function makeImageResult(input: {
  dataUrl: string;
  mime: string;
  prompt: string;
  modelId: string;
  settings: ImageGenerationSettings;
  createdAt: number;
}): ImageResult {
  return {
    id: `img_result_${input.createdAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    source: "openrouter",
    dataUrl: input.dataUrl,
    mime: input.mime,
    prompt: input.prompt,
    openRouterModelId: input.modelId,
    settings: input.settings,
    createdAt: input.createdAt,
  };
}
