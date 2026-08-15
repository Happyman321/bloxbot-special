export const THEME_IDS = [
  "paper",
  "cream",
  "sky",
  "blossom",
  "mint-pop",
  "graphite",
  "midnight",
  "oled",
  "navy",
  "forest",
  "plum",
  "ember",
  "neon-circuit",
  "candy-arcade",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  successSurface: string;
  successForeground: string;
  successBorder: string;
  warningSurface: string;
  warningForeground: string;
  warningBorder: string;
  infoSurface: string;
  infoForeground: string;
  infoBorder: string;
  dangerSurface: string;
  dangerForeground: string;
  dangerBorder: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  mode: ThemeMode;
  description: string;
  tokens: ThemeTokens;
}

type Palette = Pick<
  ThemeTokens,
  | "background"
  | "foreground"
  | "card"
  | "cardForeground"
  | "primary"
  | "primaryForeground"
  | "secondary"
  | "secondaryForeground"
  | "muted"
  | "mutedForeground"
  | "accent"
  | "accentForeground"
  | "border"
  | "ring"
>;

const lightStatus = {
  destructive: "#be123c",
  successSurface: "#ecfdf5",
  successForeground: "#065f46",
  successBorder: "#059669",
  warningSurface: "#fffbeb",
  warningForeground: "#92400e",
  warningBorder: "#d97706",
  infoSurface: "#eff6ff",
  infoForeground: "#1e40af",
  infoBorder: "#2563eb",
  dangerSurface: "#fff1f2",
  dangerForeground: "#9f1239",
  dangerBorder: "#e11d48",
} as const;

const darkStatus = {
  destructive: "#fb7185",
  successSurface: "#0b3327",
  successForeground: "#a7f3d0",
  successBorder: "#34d399",
  warningSurface: "#3b2908",
  warningForeground: "#fde68a",
  warningBorder: "#fbbf24",
  infoSurface: "#12274d",
  infoForeground: "#bfdbfe",
  infoBorder: "#60a5fa",
  dangerSurface: "#3b1018",
  dangerForeground: "#fecdd3",
  dangerBorder: "#fb7185",
} as const;

function makeTokens(mode: ThemeMode, palette: Palette): ThemeTokens {
  return {
    ...palette,
    popover: palette.card,
    popoverForeground: palette.cardForeground,
    input: palette.border,
    sidebar: palette.background,
    sidebarForeground: palette.foreground,
    sidebarPrimary: palette.primary,
    sidebarPrimaryForeground: palette.primaryForeground,
    sidebarAccent: palette.accent,
    sidebarAccentForeground: palette.accentForeground,
    sidebarBorder: palette.border,
    sidebarRing: palette.ring,
    ...(mode === "dark" ? darkStatus : lightStatus),
  };
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "paper",
    name: "Paper",
    mode: "light",
    description: "Clean warm neutrals with crisp ink-like contrast.",
    tokens: makeTokens("light", {
      background: "#faf9f7",
      foreground: "#1c1917",
      card: "#ffffff",
      cardForeground: "#1c1917",
      primary: "#292524",
      primaryForeground: "#fafaf9",
      secondary: "#f1f0ed",
      secondaryForeground: "#292524",
      muted: "#eeece8",
      mutedForeground: "#57534e",
      accent: "#e9e7e2",
      accentForeground: "#1c1917",
      border: "#8f8985",
      ring: "#57534e",
    }),
  },
  {
    id: "cream",
    name: "Cream",
    mode: "light",
    description: "A cozy parchment palette with coffee-brown accents.",
    tokens: makeTokens("light", {
      background: "#fffaf0",
      foreground: "#292017",
      card: "#fffdf7",
      cardForeground: "#292017",
      primary: "#70451f",
      primaryForeground: "#ffffff",
      secondary: "#f6ead7",
      secondaryForeground: "#3c2a1c",
      muted: "#f2e6d3",
      mutedForeground: "#68584a",
      accent: "#ead8bc",
      accentForeground: "#332318",
      border: "#9f8061",
      ring: "#70451f",
    }),
  },
  {
    id: "sky",
    name: "Sky",
    mode: "light",
    description: "Cool airy blues with grounded navy text.",
    tokens: makeTokens("light", {
      background: "#f3f8ff",
      foreground: "#17233a",
      card: "#ffffff",
      cardForeground: "#17233a",
      primary: "#1e4f8a",
      primaryForeground: "#ffffff",
      secondary: "#e4effc",
      secondaryForeground: "#1b365d",
      muted: "#e6eef8",
      mutedForeground: "#53627a",
      accent: "#d8e9fb",
      accentForeground: "#172d4d",
      border: "#7489a5",
      ring: "#1e4f8a",
    }),
  },
  {
    id: "blossom",
    name: "Blossom",
    mode: "light",
    description: "Soft rose and lilac surfaces with deep plum text.",
    tokens: makeTokens("light", {
      background: "#fff7fb",
      foreground: "#321b2a",
      card: "#ffffff",
      cardForeground: "#321b2a",
      primary: "#873e6d",
      primaryForeground: "#ffffff",
      secondary: "#f7e6f0",
      secondaryForeground: "#4b2940",
      muted: "#f2e5ed",
      mutedForeground: "#6d5364",
      accent: "#efd9e8",
      accentForeground: "#442038",
      border: "#a9849d",
      ring: "#873e6d",
    }),
  },
  {
    id: "mint-pop",
    name: "Mint Pop",
    mode: "light",
    description: "Fresh mint surfaces with a punchy teal candy accent.",
    tokens: makeTokens("light", {
      background: "#f2fff9",
      foreground: "#16382d",
      card: "#ffffff",
      cardForeground: "#16382d",
      primary: "#0f6b52",
      primaryForeground: "#ffffff",
      secondary: "#dcf7ea",
      secondaryForeground: "#20493b",
      muted: "#e4f5ed",
      mutedForeground: "#4b665c",
      accent: "#c9f0df",
      accentForeground: "#173d31",
      border: "#66887b",
      ring: "#0f6b52",
    }),
  },
  {
    id: "graphite",
    name: "Graphite",
    mode: "dark",
    description: "Balanced charcoal surfaces for comfortable everyday use.",
    tokens: makeTokens("dark", {
      background: "#18181b",
      foreground: "#fafafa",
      card: "#242427",
      cardForeground: "#fafafa",
      primary: "#f4f4f5",
      primaryForeground: "#18181b",
      secondary: "#303035",
      secondaryForeground: "#f4f4f5",
      muted: "#303035",
      mutedForeground: "#b4b4bd",
      accent: "#3a3a40",
      accentForeground: "#ffffff",
      border: "#696971",
      ring: "#d4d4d8",
    }),
  },
  {
    id: "midnight",
    name: "Midnight",
    mode: "dark",
    description: "Cool near-black blues with a calm periwinkle accent.",
    tokens: makeTokens("dark", {
      background: "#0d1220",
      foreground: "#f1f5ff",
      card: "#151c2f",
      cardForeground: "#f1f5ff",
      primary: "#a9b9ff",
      primaryForeground: "#10172a",
      secondary: "#202a43",
      secondaryForeground: "#eef2ff",
      muted: "#202a43",
      mutedForeground: "#aebbd4",
      accent: "#293755",
      accentForeground: "#ffffff",
      border: "#5e6d8d",
      ring: "#a9b9ff",
    }),
  },
  {
    id: "oled",
    name: "OLED",
    mode: "dark",
    description: "True black foundations with bright monochrome controls.",
    tokens: makeTokens("dark", {
      background: "#000000",
      foreground: "#ffffff",
      card: "#0b0b0b",
      cardForeground: "#ffffff",
      primary: "#ffffff",
      primaryForeground: "#000000",
      secondary: "#171717",
      secondaryForeground: "#fafafa",
      muted: "#1c1c1c",
      mutedForeground: "#bdbdbd",
      accent: "#262626",
      accentForeground: "#ffffff",
      border: "#666666",
      ring: "#ffffff",
    }),
  },
  {
    id: "navy",
    name: "Navy",
    mode: "dark",
    description: "Deep ocean blues illuminated by a clear cyan accent.",
    tokens: makeTokens("dark", {
      background: "#071a2c",
      foreground: "#eef8ff",
      card: "#0d263e",
      cardForeground: "#eef8ff",
      primary: "#79ccff",
      primaryForeground: "#052136",
      secondary: "#153752",
      secondaryForeground: "#edf8ff",
      muted: "#153752",
      mutedForeground: "#a5bed1",
      accent: "#1c4667",
      accentForeground: "#ffffff",
      border: "#547895",
      ring: "#79ccff",
    }),
  },
  {
    id: "forest",
    name: "Forest",
    mode: "dark",
    description: "Deep evergreen surfaces with a fresh mint highlight.",
    tokens: makeTokens("dark", {
      background: "#0d1b16",
      foreground: "#effbf4",
      card: "#15271f",
      cardForeground: "#effbf4",
      primary: "#7de0aa",
      primaryForeground: "#0a2a1a",
      secondary: "#20382d",
      secondaryForeground: "#eefaf3",
      muted: "#20382d",
      mutedForeground: "#a3c2b1",
      accent: "#29493a",
      accentForeground: "#ffffff",
      border: "#597b69",
      ring: "#7de0aa",
    }),
  },
  {
    id: "plum",
    name: "Plum",
    mode: "dark",
    description: "Rich purple layers with a soft lavender glow.",
    tokens: makeTokens("dark", {
      background: "#1b1024",
      foreground: "#fbf2ff",
      card: "#291735",
      cardForeground: "#fbf2ff",
      primary: "#dda6f7",
      primaryForeground: "#29102f",
      secondary: "#3a2248",
      secondaryForeground: "#fbf3ff",
      muted: "#3a2248",
      mutedForeground: "#c6a9d1",
      accent: "#4b2b5d",
      accentForeground: "#ffffff",
      border: "#80618e",
      ring: "#dda6f7",
    }),
  },
  {
    id: "ember",
    name: "Ember",
    mode: "dark",
    description: "Warm cocoa shadows with an energetic coral flame.",
    tokens: makeTokens("dark", {
      background: "#211310",
      foreground: "#fff4ed",
      card: "#321c17",
      cardForeground: "#fff4ed",
      primary: "#ffad82",
      primaryForeground: "#33150a",
      secondary: "#46271f",
      secondaryForeground: "#fff4ed",
      muted: "#46271f",
      mutedForeground: "#d0afa2",
      accent: "#5a3025",
      accentForeground: "#ffffff",
      border: "#8a6658",
      ring: "#ffad82",
    }),
  },
  {
    id: "neon-circuit",
    name: "Neon Circuit",
    mode: "dark",
    description: "Dark teal circuitry with bright aqua signal colors.",
    tokens: makeTokens("dark", {
      background: "#061514",
      foreground: "#edfffb",
      card: "#0c2421",
      cardForeground: "#edfffb",
      primary: "#5dffda",
      primaryForeground: "#002c24",
      secondary: "#123530",
      secondaryForeground: "#effffb",
      muted: "#123530",
      mutedForeground: "#9bc7bd",
      accent: "#174841",
      accentForeground: "#ffffff",
      border: "#4e7e75",
      ring: "#5dffda",
    }),
  },
  {
    id: "candy-arcade",
    name: "Candy Arcade",
    mode: "dark",
    description: "Deep berry shadows lit by a playful bubblegum glow.",
    tokens: makeTokens("dark", {
      background: "#160d26",
      foreground: "#fff5ff",
      card: "#25133b",
      cardForeground: "#fff5ff",
      primary: "#ff8bd2",
      primaryForeground: "#3a102c",
      secondary: "#3a2055",
      secondaryForeground: "#fff5ff",
      muted: "#3a2055",
      mutedForeground: "#cdb6dc",
      accent: "#4e276a",
      accentForeground: "#ffffff",
      border: "#84609b",
      ring: "#ff8bd2",
    }),
  },
] as const;

export const DEFAULT_THEME_ID: ThemeId = "paper";

export const THEME_BY_ID = Object.fromEntries(THEMES.map((theme) => [theme.id, theme])) as Record<
  ThemeId,
  ThemeDefinition
>;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.includes(value as ThemeId);
}

export function normalizeThemeId(value: unknown): ThemeId {
  if (value === "light") return "paper";
  if (value === "dark") return "graphite";
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

const CSS_TOKEN_NAMES: Record<keyof ThemeTokens, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  successSurface: "--success-surface",
  successForeground: "--success-foreground",
  successBorder: "--success-border",
  warningSurface: "--warning-surface",
  warningForeground: "--warning-foreground",
  warningBorder: "--warning-border",
  infoSurface: "--info-surface",
  infoForeground: "--info-foreground",
  infoBorder: "--info-border",
  dangerSurface: "--danger-surface",
  dangerForeground: "--danger-foreground",
  dangerBorder: "--danger-border",
};

export function applyTheme(themeId: ThemeId, root: HTMLElement = document.documentElement): void {
  const theme = THEME_BY_ID[themeId];
  root.dataset.theme = theme.id;
  root.classList.toggle("dark", theme.mode === "dark");
  for (const [token, cssName] of Object.entries(CSS_TOKEN_NAMES) as [keyof ThemeTokens, string][]) {
    root.style.setProperty(cssName, theme.tokens[token]);
  }
}
