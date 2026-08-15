import { LazyStore } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_COMPANION_PREFERENCES } from "@/lib/companion";
import { loadConfig } from "@/lib/config";

describe("appearance config migration", () => {
  beforeEach(async () => {
    const store = new LazyStore("bloxbot-store.json");
    await store.delete("config");
  });

  it("migrates the legacy dark setting and fills companion defaults", async () => {
    const store = new LazyStore("bloxbot-store.json");
    await store.set("config", { theme: "dark" });
    const config = await loadConfig();
    expect(config.theme).toBe("graphite");
    expect(config.companion).toEqual(DEFAULT_COMPANION_PREFERENCES);
  });

  it("normalizes corrupt appearance values without losing other config", async () => {
    const store = new LazyStore("bloxbot-store.json");
    await store.set("config", {
      theme: "laser",
      companion: {
        enabled: false,
        accessory: "invalid",
        accessoryBrightness: 125,
        size: "large",
      },
      activeWorkspace: "obby",
    });
    const config = await loadConfig();
    expect(config.theme).toBe("paper");
    expect(config.companion).toEqual({
      ...DEFAULT_COMPANION_PREFERENCES,
      enabled: false,
      accessoryBrightness: 125,
      size: "large",
    });
    expect(config.activeWorkspace).toBe("obby");
  });
});
