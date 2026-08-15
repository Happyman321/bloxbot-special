import { describe, expect, it } from "vitest";

import {
  COMPANION_SHELL_IDS,
  DEFAULT_COMPANION_PREFERENCES,
  normalizeCompanionPreferences,
  resolveCompanionShell,
} from "@/lib/companion";
import { THEMES } from "@/lib/themes";

function luminance(hex: string): number {
  const values =
    hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
  const linear = values.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("companion preferences", () => {
  it("uses the friendly enabled defaults", () => {
    expect(normalizeCompanionPreferences(undefined)).toEqual(DEFAULT_COMPANION_PREFERENCES);
  });

  it("preserves valid choices and repairs invalid stored values", () => {
    expect(
      normalizeCompanionPreferences({
        enabled: false,
        animations: false,
        accessory: "crown",
        accessoryBrightness: 135,
        eyes: "visor",
        shell: "coral",
        size: "large",
      }),
    ).toEqual({
      enabled: false,
      animations: false,
      accessory: "crown",
      accessoryBrightness: 135,
      eyes: "visor",
      shell: "coral",
      size: "large",
    });
    expect(
      normalizeCompanionPreferences({ accessory: "bad", eyes: 42, shell: null, size: "huge" }),
    ).toEqual(DEFAULT_COMPANION_PREFERENCES);
    expect(normalizeCompanionPreferences({ accessoryBrightness: 500 }).accessoryBrightness).toBe(
      150,
    );
    expect(normalizeCompanionPreferences({ accessoryBrightness: 10 }).accessoryBrightness).toBe(50);
  });

  it("keeps every fixed shell readable", () => {
    for (const shellId of COMPANION_SHELL_IDS.filter((id) => id !== "theme")) {
      const shell = resolveCompanionShell(shellId, THEMES[0]);
      expect(contrast(shell.shell, shell.features), shellId).toBeGreaterThanOrEqual(4.5);
    }
  });
});
