import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StartupCompanionScreen from "@/components/StartupCompanionScreen";
import { DEFAULT_COMPANION_PREFERENCES } from "@/lib/companion";
import { THEME_BY_ID } from "@/lib/themes";

describe("startup companion handoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the configured companion, celebrates, and completes the slide handoff", () => {
    const onComplete = vi.fn();
    const companion = {
      ...DEFAULT_COMPANION_PREFERENCES,
      accessory: "wizard" as const,
      accessoryBrightness: 130,
      eyes: "visor" as const,
      shell: "violet" as const,
      size: "large" as const,
    };
    const { container, rerender } = render(
      <StartupCompanionScreen
        ready={false}
        companion={companion}
        theme={THEME_BY_ID["candy-arcade"]}
        onComplete={onComplete}
      />,
    );

    const startupScreen = screen.getByText("Starting up...").closest("[data-phase]");
    expect(startupScreen).toHaveAttribute("data-phase", "loading");
    expect(startupScreen).toHaveAttribute("data-accessory", "wizard");
    expect(startupScreen).toHaveAttribute("data-accessory-brightness", "130");

    rerender(
      <StartupCompanionScreen
        ready
        companion={companion}
        theme={THEME_BY_ID["candy-arcade"]}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Ready!").closest("[data-phase]")).toHaveAttribute(
      "data-phase",
      "handoff",
    );
    expect(screen.getByRole("img", { name: "BloxBot is ready" })).toHaveClass(
      "bloxbot-mood-success",
    );
    expect(container.querySelector('rect[x="117"][width="278"]')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_050));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
