import { useCallback, useEffect, useRef, useState } from "react";

import BotFace from "@/components/BotFace";
import { useChatError } from "@/hooks/useChatError";
import { useActivePermission } from "@/hooks/usePermissions";
import { useActiveQuestion } from "@/hooks/useQuestions";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import type { CompanionMood } from "@/lib/companion";
import { COMPANION_SIZE_PIXELS } from "@/lib/companion";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface BotCompanionProps {
  mode: "chat" | "image" | "dictator";
  suppressed?: boolean;
}

interface TimedReaction {
  mood: Extract<CompanionMood, "success" | "error" | "wave">;
  until: number;
  label?: string;
}

const STARTUP_GREETINGS = [
  "Hello! Ready to build?",
  "Hi there! Let's make something.",
  "Hey! Good to see you.",
] as const;

function BotCompanion({ mode, suppressed = false }: BotCompanionProps) {
  const { activeSessionId } = useActiveSession();
  const { companion, themeDefinition } = usePreferences();
  const busy = useIsBusy(mode === "chat" ? activeSessionId : null);
  const chatError = useChatError(mode === "chat" ? activeSessionId : null);
  const question = useActiveQuestion(mode === "chat" ? activeSessionId : null);
  const permission = useActivePermission(mode === "chat" ? activeSessionId : null);
  const reducedMotion = useReducedMotion();
  const canAnimate = companion.animations && !reducedMotion;
  const previousBusy = useRef(false);
  const previousError = useRef<string | null>(null);
  const greeted = useRef(false);
  const startupGreeting = useRef(
    STARTUP_GREETINGS[Math.floor(Math.random() * STARTUP_GREETINGS.length)],
  );
  const [reaction, setReaction] = useState<TimedReaction | null>(null);
  const [clock, setClock] = useState(Date.now());
  const attention = mode === "chat" && Boolean(question || permission);

  const react = useCallback((mood: TimedReaction["mood"], duration: number, label?: string) => {
    const now = Date.now();
    setClock(now);
    setReaction({ mood, until: now + duration, label });
  }, []);

  useEffect(() => {
    if (greeted.current || suppressed || !companion.enabled || chatError || attention || busy) {
      return;
    }
    const timer = window.setTimeout(() => {
      greeted.current = true;
      react("wave", 3_500, startupGreeting.current);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [attention, busy, chatError, companion.enabled, react, suppressed]);

  useEffect(() => {
    if (mode !== "chat") {
      previousBusy.current = false;
      previousError.current = null;
      return;
    }
    if (chatError && chatError !== previousError.current) react("error", 4_000);
    else if (previousBusy.current && !busy && !chatError) react("success", 2_500);
    previousBusy.current = busy;
    previousError.current = chatError;
  }, [busy, chatError, mode, react]);

  useEffect(() => {
    if (!reaction) return;
    const remaining = Math.max(0, reaction.until - Date.now());
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      setReaction(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  const activeReaction = reaction && reaction.until > clock ? reaction.mood : null;
  const mood: CompanionMood =
    activeReaction === "error"
      ? "error"
      : attention
        ? "attention"
        : busy
          ? "thinking"
          : (activeReaction ?? "idle");

  useEffect(() => {
    if (!canAnimate || mood !== "idle" || suppressed || !companion.enabled) return;
    const delay = 25_000 + Math.floor(Math.random() * 20_001);
    const timer = window.setTimeout(() => react("wave", 1_200), delay);
    return () => window.clearTimeout(timer);
  }, [canAnimate, companion.enabled, mood, react, suppressed]);

  if (!companion.enabled || suppressed) return null;

  const bubble =
    mood === "error"
      ? "Something went wrong"
      : mood === "attention"
        ? "Needs you"
        : mood === "thinking"
          ? "Thinking…"
          : mood === "success"
            ? "Done!"
            : mood === "wave"
              ? (reaction?.label ?? null)
              : null;
  const size = COMPANION_SIZE_PIXELS[companion.size];

  return (
    <div
      className={`bloxbot-companion bloxbot-companion-${mode} pointer-events-none absolute right-3 z-30 flex items-end gap-2`}
      data-mood={mood}
      data-size={companion.size}
    >
      {bubble && (
        <output
          aria-live="polite"
          className="bloxbot-status-bubble mb-1 max-w-36 rounded-lg border bg-popover px-2.5 py-1.5 text-[11px] font-medium text-popover-foreground shadow-lg"
        >
          {bubble}
        </output>
      )}
      <button
        type="button"
        className="bloxbot-companion-button pointer-events-auto rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => react("wave", 1_200)}
        aria-label="Make BloxBot wave"
      >
        <BotFace
          mood={mood}
          accessory={companion.accessory}
          accessoryBrightness={companion.accessoryBrightness}
          eyes={companion.eyes}
          shell={companion.shell}
          theme={themeDefinition}
          size={size}
          animated={canAnimate}
          title={`BloxBot is ${mood}`}
          className="bloxbot-companion-face drop-shadow-lg"
        />
      </button>
    </div>
  );
}

export default BotCompanion;
