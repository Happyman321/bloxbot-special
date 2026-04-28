export type ImageTurnStatus = "completed" | "failed" | "pending";

export interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
  image?: string;
  request?: string;
}

export interface OpenRouterImageModel {
  id: string;
  name: string;
  providerName: string;
  description?: string;
  pricing?: OpenRouterPricing;
  inputModalities: string[];
  outputModalities: string[];
  supportedAspectRatios: string[];
  supportedImageSizes: string[];
  supportsReferenceImages: boolean;
}

export interface ImageGenerationSettings {
  aspectRatio?: string;
  imageSize?: string;
  outputCount?: number;
}

export interface ImageReference {
  id: string;
  dataUrl: string;
  mime: string;
  filename: string;
  createdAt: number;
}

export interface ImageUsageRecord {
  id: string;
  source: "openrouter";
  modelId: string;
  prompt: string;
  imageCount: number;
  cost?: number;
  usage?: unknown;
  responseId?: string;
  createdAt: number;
}

export interface ImageResult {
  id: string;
  source: "openrouter";
  dataUrl: string;
  mime: string;
  prompt: string;
  openRouterModelId: string;
  settings: ImageGenerationSettings;
  createdAt: number;
}

export interface ImageTurn {
  id: string;
  source: "openrouter";
  prompt: string;
  openRouterModelId: string;
  modelName: string;
  settings: ImageGenerationSettings;
  references: ImageReference[];
  resultIds: string[];
  status: ImageTurnStatus;
  statusMessage: string;
  cost?: number;
  usage?: unknown;
  responseId?: string;
  createdAt: number;
}

export interface ImageProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ImageTurn[];
  results: ImageResult[];
  usageRecords: ImageUsageRecord[];
}

export interface OpenRouterCredits {
  totalCredits: number;
  totalUsage: number;
  remainingCredits: number;
}
