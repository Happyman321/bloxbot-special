import type { ThemeDefinition } from "@/lib/themes";

export const COMPANION_ACCESSORY_IDS = [
  "none",
  "antenna",
  "propeller",
  "cap",
  "beanie",
  "crown",
  "wizard",
] as const;
export const COMPANION_EYE_IDS = ["classic", "round", "pixel", "happy", "visor"] as const;
export const COMPANION_SHELL_IDS = [
  "theme",
  "graphite",
  "cloud",
  "cobalt",
  "mint",
  "coral",
  "violet",
  "gold",
] as const;
export const COMPANION_SIZES = ["compact", "standard", "large"] as const;

export type CompanionAccessoryId = (typeof COMPANION_ACCESSORY_IDS)[number];
export type CompanionEyeId = (typeof COMPANION_EYE_IDS)[number];
export type CompanionShellId = (typeof COMPANION_SHELL_IDS)[number];
export type CompanionSize = (typeof COMPANION_SIZES)[number];
export type CompanionMood = "idle" | "thinking" | "success" | "error" | "attention" | "wave";

export interface CompanionPreferences {
  enabled: boolean;
  animations: boolean;
  accessory: CompanionAccessoryId;
  accessoryBrightness: number;
  eyes: CompanionEyeId;
  shell: CompanionShellId;
  size: CompanionSize;
}

export interface CompanionOption<T extends string> {
  id: T;
  label: string;
}

export const COMPANION_ACCESSORIES: readonly CompanionOption<CompanionAccessoryId>[] = [
  { id: "none", label: "None" },
  { id: "antenna", label: "Antenna" },
  { id: "propeller", label: "Propeller" },
  { id: "cap", label: "Cap" },
  { id: "beanie", label: "Beanie" },
  { id: "crown", label: "Crown" },
  { id: "wizard", label: "Wizard" },
];

export const COMPANION_EYES: readonly CompanionOption<CompanionEyeId>[] = [
  { id: "classic", label: "Classic" },
  { id: "round", label: "Round" },
  { id: "pixel", label: "Pixel" },
  { id: "happy", label: "Happy" },
  { id: "visor", label: "Visor" },
];

export const COMPANION_SHELLS: readonly CompanionOption<CompanionShellId>[] = [
  { id: "theme", label: "Theme" },
  { id: "graphite", label: "Graphite" },
  { id: "cloud", label: "Cloud" },
  { id: "cobalt", label: "Cobalt" },
  { id: "mint", label: "Mint" },
  { id: "coral", label: "Coral" },
  { id: "violet", label: "Violet" },
  { id: "gold", label: "Gold" },
];

export const COMPANION_SIZE_PIXELS: Record<CompanionSize, number> = {
  compact: 48,
  standard: 64,
  large: 80,
};

export const COMPANION_ACCESSORY_BRIGHTNESS = {
  min: 50,
  max: 150,
  step: 5,
  default: 100,
} as const;

export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = {
  enabled: true,
  animations: true,
  accessory: "antenna",
  accessoryBrightness: COMPANION_ACCESSORY_BRIGHTNESS.default,
  eyes: "classic",
  shell: "theme",
  size: "standard",
};

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function normalizeCompanionPreferences(value: unknown): CompanionPreferences {
  const raw = value && typeof value === "object" ? (value as Partial<CompanionPreferences>) : {};
  const accessoryBrightness =
    typeof raw.accessoryBrightness === "number" && Number.isFinite(raw.accessoryBrightness)
      ? Math.min(
          COMPANION_ACCESSORY_BRIGHTNESS.max,
          Math.max(COMPANION_ACCESSORY_BRIGHTNESS.min, Math.round(raw.accessoryBrightness)),
        )
      : DEFAULT_COMPANION_PREFERENCES.accessoryBrightness;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_COMPANION_PREFERENCES.enabled,
    animations:
      typeof raw.animations === "boolean"
        ? raw.animations
        : DEFAULT_COMPANION_PREFERENCES.animations,
    accessory: includes(COMPANION_ACCESSORY_IDS, raw.accessory)
      ? raw.accessory
      : DEFAULT_COMPANION_PREFERENCES.accessory,
    accessoryBrightness,
    eyes: includes(COMPANION_EYE_IDS, raw.eyes) ? raw.eyes : DEFAULT_COMPANION_PREFERENCES.eyes,
    shell: includes(COMPANION_SHELL_IDS, raw.shell)
      ? raw.shell
      : DEFAULT_COMPANION_PREFERENCES.shell,
    size: includes(COMPANION_SIZES, raw.size) ? raw.size : DEFAULT_COMPANION_PREFERENCES.size,
  };
}

interface ShellColors {
  shell: string;
  features: string;
  detail: string;
}

const SHELL_COLORS: Record<Exclude<CompanionShellId, "theme">, ShellColors> = {
  graphite: { shell: "#34343a", features: "#ffffff", detail: "#a1a1aa" },
  cloud: { shell: "#f4f4f5", features: "#27272a", detail: "#71717a" },
  cobalt: { shell: "#2457d6", features: "#ffffff", detail: "#9fc0ff" },
  mint: { shell: "#42c997", features: "#082a20", detail: "#d1fae5" },
  coral: { shell: "#f06f5f", features: "#32110d", detail: "#ffe0dc" },
  violet: { shell: "#805ad5", features: "#ffffff", detail: "#d8c8ff" },
  gold: { shell: "#e8b83f", features: "#302307", detail: "#fff3bf" },
};

export function resolveCompanionShell(
  shellId: CompanionShellId,
  theme: ThemeDefinition,
): ShellColors {
  if (shellId === "theme") {
    return {
      shell: theme.tokens.primary,
      features: theme.tokens.primaryForeground,
      detail: theme.tokens.ring,
    };
  }
  return SHELL_COLORS[shellId];
}
