import { describe, expect, it } from "vitest";
import {
  aggregateImageSpend,
  estimateOpenRouterImageCost,
  filterAndSortOpenRouterImageModels,
  formatOpenRouterPrice,
  normalizeOpenRouterImageModel,
  parseOpenRouterImageResponse,
} from "@/lib/openRouterImages";
import type { ImageUsageRecord, OpenRouterImageModel } from "@/types/image";

function model(overrides: Partial<OpenRouterImageModel> = {}): OpenRouterImageModel {
  return {
    id: "google/gemini-3.1-flash-image-preview",
    name: "Gemini 3.1 Flash Image",
    providerName: "Google",
    inputModalities: ["text", "image"],
    outputModalities: ["image", "text"],
    supportedAspectRatios: ["1:1"],
    supportedImageSizes: ["1024x1024"],
    supportsReferenceImages: true,
    pricing: { image: "0.05" },
    ...overrides,
  };
}

describe("OpenRouter image helpers", () => {
  it("normalizes image-capable OpenRouter models", () => {
    const normalized = normalizeOpenRouterImageModel({
      id: "black-forest-labs/flux-schnell",
      name: "FLUX Schnell",
      pricing: { image: "0.003" },
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["image"],
      },
    });

    expect(normalized?.id).toBe("black-forest-labs/flux-schnell");
    expect(normalized?.providerName).toBe("black-forest-labs");
    expect(normalized?.supportsReferenceImages).toBe(false);
  });

  it("drops non-image models", () => {
    expect(
      normalizeOpenRouterImageModel({
        id: "openai/gpt-5.2",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      }),
    ).toBeNull();
  });

  it("filters and sorts models by provider, search, and price", () => {
    const models = [
      model({
        id: "expensive/model",
        name: "Expensive",
        providerName: "A",
        pricing: { image: "1" },
      }),
      model({
        id: "cheap/model",
        name: "Cheap Flux",
        providerName: "B",
        pricing: { image: "0.01" },
      }),
      model({ id: "mid/model", name: "Mid", providerName: "B", pricing: { image: "0.2" } }),
    ];

    const visible = filterAndSortOpenRouterImageModels(models, {
      query: "flux",
      provider: "B",
      sort: "price",
    });

    expect(visible.map((item) => item.id)).toEqual(["cheap/model"]);
    expect(formatOpenRouterPrice(visible[0])).toBe("$0.0100 / image");
  });

  it("formats token prices as per-million values and estimates request cost", () => {
    const tokenPriced = model({
      pricing: { prompt: "0.0000001", completion: "0.000002" },
    });

    expect(formatOpenRouterPrice(tokenPriced)).toBe("$2.0000 / 1M output");
    expect(
      estimateOpenRouterImageCost(tokenPriced, {
        imageSize: "1024x1024",
        outputCount: 2,
      }),
    ).toMatchObject({
      amount: 0.01606,
      label: "$0.0161 rough est.",
    });
  });

  it("parses OpenRouter image response data URLs and usage cost", () => {
    const parsed = parseOpenRouterImageResponse({
      id: "gen_123",
      usage: { cost: 0.05 },
      choices: [
        {
          message: {
            images: [
              {
                image_url: {
                  url: "data:image/png;base64,AAAA",
                },
              },
            ],
          },
        },
      ],
    });

    expect(parsed.responseId).toBe("gen_123");
    expect(parsed.cost).toBe(0.05);
    expect(parsed.images).toEqual([{ dataUrl: "data:image/png;base64,AAAA", mime: "image/png" }]);
  });

  it("aggregates local spend by time window", () => {
    const now = Date.now();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const records: ImageUsageRecord[] = [
      {
        id: "today",
        source: "openrouter",
        modelId: "a",
        prompt: "a",
        imageCount: 1,
        cost: 0.1,
        createdAt: now,
      },
      {
        id: "old",
        source: "openrouter",
        modelId: "b",
        prompt: "b",
        imageCount: 1,
        cost: 0.2,
        createdAt: lastMonth.getTime(),
      },
    ];

    expect(aggregateImageSpend(records)).toMatchObject({
      today: 0.1,
      allTime: 0.30000000000000004,
    });
  });
});
