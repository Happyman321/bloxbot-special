import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetStores } from "@tauri-apps/plugin-store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImageMode from "@/components/ImageMode";

const imageDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function mockOpenRouterFetch({ generationFails = false } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-image-2",
              name: "GPT Image 2",
              description: "Image generation model",
              pricing: { image: "0.02" },
              architecture: {
                input_modalities: ["text", "image"],
                output_modalities: ["image"],
              },
              top_provider: { name: "OpenAI" },
            },
          ],
        }),
      );
    }
    if (url.includes("/credits")) {
      return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 2.5 } }));
    }
    if (url.includes("/chat/completions")) {
      if (generationFails) {
        return new Response(JSON.stringify({ error: { message: "blocked" } }), { status: 400 });
      }
      return new Response(
        JSON.stringify({
          id: "gen_1",
          usage: { cost: 0.02 },
          choices: [
            {
              message: {
                images: [{ image_url: { url: imageDataUrl } }],
              },
            },
          ],
        }),
      );
    }
    return new Response("not found", { status: 404 });
  });
}

describe("ImageMode", () => {
  beforeEach(() => {
    __resetStores();
    vi.restoreAllMocks();
  });

  it("shows the no-key connect state", async () => {
    render(<ImageMode />, { wrapper: wrapper() });

    expect(await screen.findByPlaceholderText("sk-or-...")).toBeInTheDocument();
    expect(screen.getByText("Image generations spend OpenRouter credits.")).toBeInTheDocument();
    expect(screen.getByText("What should the image look like?")).toBeInTheDocument();
  });

  it("connects, lists models, generates an image, and shows spend", async () => {
    vi.stubGlobal("fetch", mockOpenRouterFetch());
    render(<ImageMode />, { wrapper: wrapper() });

    fireEvent.change(await screen.findByPlaceholderText("sk-or-..."), {
      target: { value: "sk-or-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(screen.getAllByText("openai/gpt-image-2").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("$0.0200 / image").length).toBeGreaterThan(0);
    expect(screen.getByText("$7.5000")).toBeInTheDocument();

    fireEvent.click(screen.getByText("New image project"));
    fireEvent.change(
      await screen.findByPlaceholderText("Describe the image, or paste reference images here..."),
      {
        target: { value: "A sci-fi Roblox shop interior" },
      },
    );
    fireEvent.click(screen.getByTitle("Generate with OpenRouter"));

    expect(await screen.findByText("Generated 1 image through OpenRouter.")).toBeInTheDocument();
    expect(screen.getByAltText("A sci-fi Roblox shop interior")).toHaveAttribute(
      "src",
      imageDataUrl,
    );
    expect(screen.getAllByText("$0.0200").length).toBeGreaterThan(0);
  });

  it("accepts pasted reference images in the prompt", async () => {
    vi.stubGlobal("fetch", mockOpenRouterFetch());
    render(<ImageMode />, { wrapper: wrapper() });

    fireEvent.change(await screen.findByPlaceholderText("sk-or-..."), {
      target: { value: "sk-or-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(screen.getAllByText("openai/gpt-image-2").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("New image project"));
    const prompt = await screen.findByPlaceholderText(
      "Describe the image, or paste reference images here...",
    );
    const file = new File(["image"], "reference.png", { type: "image/png" });

    fireEvent.paste(prompt, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(await screen.findByAltText("reference.png")).toBeInTheDocument();
  });

  it("records generation errors in the project history", async () => {
    vi.stubGlobal("fetch", mockOpenRouterFetch({ generationFails: true }));
    render(<ImageMode />, { wrapper: wrapper() });

    fireEvent.change(await screen.findByPlaceholderText("sk-or-..."), {
      target: { value: "sk-or-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(screen.getAllByText("openai/gpt-image-2").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("New image project"));
    fireEvent.change(
      await screen.findByPlaceholderText("Describe the image, or paste reference images here..."),
      {
        target: { value: "Broken request" },
      },
    );
    fireEvent.click(screen.getByTitle("Generate with OpenRouter"));

    await waitFor(() => {
      expect(screen.getByText(/OpenRouter generation failed: 400/)).toBeInTheDocument();
    });
  });
});
