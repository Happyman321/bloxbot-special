import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppearanceSettings from "@/components/AppearanceSettings";
import { DEFAULT_COMPANION_PREFERENCES } from "@/lib/companion";
import { THEME_BY_ID } from "@/lib/themes";
import { PreferencesContext } from "@/providers/PreferencesProvider";

function renderAppearance() {
  const setTheme = vi.fn();
  const updateCompanion = vi.fn();
  const resetCompanion = vi.fn();
  render(
    <PreferencesContext.Provider
      value={
        {
          theme: "paper",
          themeDefinition: THEME_BY_ID.paper,
          companion: DEFAULT_COMPANION_PREFERENCES,
          setTheme,
          updateCompanion,
          resetCompanion,
        } as never
      }
    >
      <AppearanceSettings />
    </PreferencesContext.Provider>,
  );
  return { setTheme, updateCompanion, resetCompanion };
}

describe("Appearance settings", () => {
  it("previews carousel choices without applying until the Apply button is pressed", () => {
    const { setTheme } = renderAppearance();
    expect(screen.getByText("Paper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next theme" }));
    expect(screen.getByText("Cream")).toBeInTheDocument();
    expect(setTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Cream" }));
    expect(setTheme).toHaveBeenCalledWith("cream");
  });

  it("filters to dark themes and supports keyboard carousel navigation", () => {
    renderAppearance();
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(screen.getByText("Graphite")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("dark theme carousel"), { key: "ArrowRight" });
    expect(screen.getByText("Midnight")).toBeInTheDocument();
  });

  it("sends focused companion updates and can reset them", () => {
    const { updateCompanion, resetCompanion } = renderAppearance();
    fireEvent.click(screen.getByRole("button", { name: "Crown hat" }));
    expect(updateCompanion).toHaveBeenCalledWith({ accessory: "crown" });
    fireEvent.change(screen.getByRole("slider", { name: "Hat brightness" }), {
      target: { value: "125" },
    });
    expect(updateCompanion).toHaveBeenCalledWith({ accessoryBrightness: 125 });
    fireEvent.click(screen.getByRole("button", { name: "large" }));
    expect(updateCompanion).toHaveBeenCalledWith({ size: "large" });
    fireEvent.click(screen.getByRole("button", { name: "Reset companion" }));
    expect(resetCompanion).toHaveBeenCalledOnce();
  });
});
