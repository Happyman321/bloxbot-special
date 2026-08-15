import { type CSSProperties, useEffect, useMemo, useState } from "react";

import BotFace from "@/components/BotFace";
import {
  COMPANION_ACCESSORIES,
  COMPANION_ACCESSORY_BRIGHTNESS,
  COMPANION_EYES,
  COMPANION_SHELLS,
  COMPANION_SIZE_PIXELS,
  COMPANION_SIZES,
  resolveCompanionShell,
} from "@/lib/companion";
import { THEMES, type ThemeId, type ThemeMode } from "@/lib/themes";
import { usePreferences } from "@/providers/PreferencesProvider";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition-colors ${checked ? "border-primary bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${checked ? "left-5 bg-primary-foreground" : "left-1 bg-muted-foreground"}`}
      />
    </button>
  );
}

function ThemePreview({ themeId }: { themeId: ThemeId }) {
  const theme = THEMES.find((candidate) => candidate.id === themeId) ?? THEMES[0];
  const t = theme.tokens;
  const style = {
    background: t.background,
    color: t.foreground,
    borderColor: t.border,
  } satisfies CSSProperties;

  return (
    <div className="overflow-hidden rounded-xl border shadow-sm" style={style}>
      <div className="flex h-48">
        <div
          className="w-[30%] border-r p-3"
          style={{
            background: t.sidebar,
            color: t.sidebarForeground,
            borderColor: t.sidebarBorder,
          }}
        >
          <div className="mb-4 h-2 w-12 rounded-full" style={{ background: t.mutedForeground }} />
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="mb-2 rounded-md px-2 py-2"
              style={{
                background: item === 0 ? t.sidebarAccent : "transparent",
                color: item === 0 ? t.sidebarAccentForeground : t.mutedForeground,
              }}
            >
              <div className="h-1.5 rounded-full bg-current opacity-70" />
            </div>
          ))}
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">BloxBot</div>
            <div
              className="rounded-md px-2 py-1 text-[10px] font-semibold"
              style={{ background: t.primary, color: t.primaryForeground }}
            >
              Build
            </div>
          </div>
          <div
            className="rounded-lg border p-3 text-[11px]"
            style={{ background: t.card, color: t.cardForeground, borderColor: t.border }}
          >
            <div className="font-semibold">Readable surfaces</div>
            <div className="mt-1" style={{ color: t.mutedForeground }}>
              Cards, controls, and secondary text stay clear.
            </div>
          </div>
          <div
            className="mt-3 rounded-md border px-2.5 py-2 text-[10px]"
            style={{
              background: t.successSurface,
              color: t.successForeground,
              borderColor: t.successBorder,
            }}
          >
            Ready to build
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeCarousel() {
  const { theme, setTheme } = usePreferences();
  const current = THEMES.find((candidate) => candidate.id === theme) ?? THEMES[0];
  const [mode, setMode] = useState<ThemeMode>(current.mode);
  const candidates = useMemo(() => THEMES.filter((candidate) => candidate.mode === mode), [mode]);
  const [previewId, setPreviewId] = useState<ThemeId>(theme);
  const previewIndex = Math.max(
    0,
    candidates.findIndex((candidate) => candidate.id === previewId),
  );
  const preview = candidates[previewIndex] ?? candidates[0];

  useEffect(() => {
    if (!candidates.some((candidate) => candidate.id === previewId)) {
      setPreviewId(candidates[0].id);
    }
  }, [candidates, previewId]);

  function move(direction: -1 | 1) {
    const next = (previewIndex + direction + candidates.length) % candidates.length;
    setPreviewId(candidates[next].id);
  }

  return (
    <section aria-labelledby="theme-heading" className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 id="theme-heading" className="text-xs font-semibold">
            Theme
          </h5>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Browse safely, then apply the palette you want.
          </p>
        </div>
        <div className="flex rounded-md border bg-background p-0.5">
          {(["light", "dark"] as const).map((candidateMode) => (
            <button
              key={candidateMode}
              type="button"
              onClick={() => setMode(candidateMode)}
              className={`rounded px-3 py-1 text-[11px] font-medium capitalize ${mode === candidateMode ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {candidateMode}
            </button>
          ))}
        </div>
      </div>

      <fieldset
        className="mt-4 border-0 p-0"
        aria-label={`${mode} theme carousel`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
        }}
      >
        <ThemePreview themeId={preview.id} />
      </fieldset>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Previous theme"
          className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-sm font-semibold">{preview.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{preview.description}</div>
          <fieldset
            className="mt-2 flex justify-center gap-1.5 border-0 p-0"
            aria-label={`${previewIndex + 1} of ${candidates.length}`}
          >
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-label={`Preview ${candidate.name}`}
                onClick={() => setPreviewId(candidate.id)}
                className={`h-1.5 rounded-full transition-all ${candidate.id === preview.id ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/35 hover:bg-muted-foreground"}`}
              />
            ))}
          </fieldset>
        </div>
        <button
          type="button"
          onClick={() => move(1)}
          aria-label="Next theme"
          className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent"
        >
          ›
        </button>
      </div>

      <button
        type="button"
        disabled={preview.id === theme}
        onClick={() => setTheme(preview.id)}
        className="mt-4 h-9 w-full rounded-md bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-55"
      >
        {preview.id === theme ? "Current theme" : `Apply ${preview.name}`}
      </button>
    </section>
  );
}

function CompanionCustomizer() {
  const { companion, themeDefinition, updateCompanion, resetCompanion } = usePreferences();
  const previewSize = Math.min(112, COMPANION_SIZE_PIXELS[companion.size] + 32);

  return (
    <section aria-labelledby="companion-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h5 id="companion-heading" className="text-xs font-semibold">
            BloxBot companion
          </h5>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A friendly ambient helper that reacts to your active chat.
          </p>
        </div>
        <Toggle
          checked={companion.enabled}
          onChange={(enabled) => updateCompanion({ enabled })}
          label="Show BloxBot companion"
        />
      </div>

      <div className="mt-4 flex min-h-40 items-center justify-center overflow-hidden rounded-xl border bg-background/60">
        <BotFace
          mood="idle"
          accessory={companion.accessory}
          accessoryBrightness={companion.accessoryBrightness}
          eyes={companion.eyes}
          shell={companion.shell}
          theme={themeDefinition}
          size={previewSize}
          animated={companion.animations}
          title="BloxBot companion preview"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="text-xs font-medium">Animations</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Also respects reduced-motion settings.
          </div>
        </div>
        <Toggle
          checked={companion.animations}
          onChange={(animations) => updateCompanion({ animations })}
          label="Animate BloxBot companion"
        />
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Size
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {COMPANION_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => updateCompanion({ size })}
              className={`h-8 rounded-md border text-[11px] font-medium capitalize ${companion.size === size ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Hat
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {COMPANION_ACCESSORIES.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={`${option.label} hat`}
              onClick={() => updateCompanion({ accessory: option.id })}
              className={`flex h-12 items-center justify-center rounded-md border ${companion.accessory === option.id ? "border-primary bg-accent ring-1 ring-primary" : "hover:bg-accent"}`}
            >
              <BotFace
                accessory={option.id}
                accessoryBrightness={companion.accessoryBrightness}
                eyes={companion.eyes}
                shell={companion.shell}
                theme={themeDefinition}
                size={35}
                animated={false}
              />
            </button>
          ))}
        </div>
        <div
          className={`mt-3 rounded-lg border bg-background/60 px-3 py-2.5 ${companion.accessory === "none" ? "opacity-55" : ""}`}
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="companion-hat-brightness" className="text-[11px] font-medium">
              Hat brightness
            </label>
            <output
              htmlFor="companion-hat-brightness"
              className="text-[10px] tabular-nums text-muted-foreground"
            >
              {companion.accessoryBrightness}%
            </output>
          </div>
          <input
            id="companion-hat-brightness"
            type="range"
            min={COMPANION_ACCESSORY_BRIGHTNESS.min}
            max={COMPANION_ACCESSORY_BRIGHTNESS.max}
            step={COMPANION_ACCESSORY_BRIGHTNESS.step}
            value={companion.accessoryBrightness}
            disabled={companion.accessory === "none"}
            onChange={(event) =>
              updateCompanion({ accessoryBrightness: Number(event.target.value) })
            }
            className="mt-2 h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
            aria-label="Hat brightness"
          />
          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
            <span>Darker</span>
            <span>Brighter</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Eyes
        </div>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {COMPANION_EYES.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={`${option.label} eyes`}
              onClick={() => updateCompanion({ eyes: option.id })}
              className={`flex h-12 items-center justify-center rounded-md border ${companion.eyes === option.id ? "border-primary bg-accent ring-1 ring-primary" : "hover:bg-accent"}`}
            >
              <BotFace
                accessory="none"
                eyes={option.id}
                shell={companion.shell}
                theme={themeDefinition}
                size={36}
                animated={false}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Shell
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {COMPANION_SHELLS.map((option) => {
            const colors = resolveCompanionShell(option.id, themeDefinition);
            return (
              <button
                key={option.id}
                type="button"
                title={option.label}
                aria-label={`${option.label} shell`}
                onClick={() => updateCompanion({ shell: option.id })}
                className={`flex h-10 items-center justify-center rounded-md border ${companion.shell === option.id ? "border-primary ring-1 ring-primary" : "hover:bg-accent"}`}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-lg border"
                  style={{ background: colors.shell, borderColor: colors.detail }}
                >
                  <span
                    className="h-1.5 w-2.5 rounded-full"
                    style={{ background: colors.features }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={resetCompanion}
        className="mt-5 h-8 rounded-md border px-3 text-[11px] font-medium hover:bg-accent"
      >
        Reset companion
      </button>
    </section>
  );
}

function AppearanceSettings() {
  return (
    <div className="mx-auto w-full max-w-3xl p-5">
      <h4 className="text-sm font-semibold">Appearance</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Make BloxBot feel like yours. Preferences are saved on this device.
      </p>
      <div className="mt-4 space-y-4">
        <ThemeCarousel />
        <CompanionCustomizer />
      </div>
    </div>
  );
}

export default AppearanceSettings;
