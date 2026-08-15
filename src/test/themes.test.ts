import { afterEach, describe, expect, it } from "vitest";

import { applyTheme, normalizeThemeId, THEME_IDS, THEMES } from "@/lib/themes";

function luminance(hex: string): number {
  const channels =
    hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("theme registry", () => {
  afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
  });

  it("contains fourteen unique themes with the expanded light/dark split", () => {
    expect(THEMES).toHaveLength(14);
    expect(new Set(THEME_IDS).size).toBe(14);
    expect(THEMES.filter((theme) => theme.mode === "light")).toHaveLength(5);
    expect(THEMES.filter((theme) => theme.mode === "dark")).toHaveLength(9);
    expect(THEME_IDS).toContain("mint-pop");
    expect(THEME_IDS).toContain("candy-arcade");
  });

  it("migrates legacy values and rejects unknown themes", () => {
    expect(normalizeThemeId("light")).toBe("paper");
    expect(normalizeThemeId("dark")).toBe("graphite");
    expect(normalizeThemeId("plum")).toBe("plum");
    expect(normalizeThemeId("unknown")).toBe("paper");
    expect(normalizeThemeId(null)).toBe("paper");
  });

  it("applies all theme tokens and dark mode state to the root", () => {
    applyTheme("midnight");
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#0d1220");

    applyTheme("sky");
    expect(document.documentElement.dataset.theme).toBe("sky");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.getPropertyValue("--info-surface")).toBe("#eff6ff");
  });

  for (const theme of THEMES) {
    it(`${theme.name} meets text and control contrast targets`, () => {
      const t = theme.tokens;
      const textPairs: [string, string, string][] = [
        ["page", t.foreground, t.background],
        ["card", t.cardForeground, t.card],
        ["popover", t.popoverForeground, t.popover],
        ["primary", t.primaryForeground, t.primary],
        ["secondary", t.secondaryForeground, t.secondary],
        ["muted", t.mutedForeground, t.muted],
        ["accent", t.accentForeground, t.accent],
        ["sidebar", t.sidebarForeground, t.sidebar],
        ["sidebar primary", t.sidebarPrimaryForeground, t.sidebarPrimary],
        ["sidebar accent", t.sidebarAccentForeground, t.sidebarAccent],
        ["success", t.successForeground, t.successSurface],
        ["warning", t.warningForeground, t.warningSurface],
        ["info", t.infoForeground, t.infoSurface],
        ["danger", t.dangerForeground, t.dangerSurface],
      ];
      for (const [name, foreground, background] of textPairs) {
        expect(contrast(foreground, background), `${theme.name} ${name}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }

      const controlPairs: [string, string, string][] = [
        ["border", t.border, t.background],
        ["focus ring", t.ring, t.background],
        ["success border", t.successBorder, t.successSurface],
        ["warning border", t.warningBorder, t.warningSurface],
        ["info border", t.infoBorder, t.infoSurface],
        ["danger border", t.dangerBorder, t.dangerSurface],
      ];
      for (const [name, foreground, background] of controlPairs) {
        expect(contrast(foreground, background), `${theme.name} ${name}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
