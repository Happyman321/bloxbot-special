import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSkillDocument,
  SkillsSettings,
  serializeSkillDocument,
  validateSkillDraft,
} from "@/components/SkillsSettings";

const skills = [
  {
    id: "bloxbot-playtest-debugging",
    description: "Debug Roblox playtests",
    source: "builtin",
    enabled: true,
    editable: false,
  },
  {
    id: "my-workflow",
    description: "Use my project workflow",
    source: "user",
    enabled: true,
    editable: true,
  },
];

function renderSkills() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SkillsSettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "list_bloxbot_skills") return skills;
    if (command === "set_bloxbot_skill_enabled") {
      return { skill: { ...skills[0], enabled: false }, restartRequired: true };
    }
    if (command === "save_bloxbot_skill") {
      return { skill: skills[1], restartRequired: true };
    }
    if (command === "get_bloxbot_skill") {
      return { ...skills[1], instructions: "# Existing workflow\n\nFollow it." };
    }
    if (command === "duplicate_bloxbot_skill") {
      return { skill: { ...skills[1], id: "playtest-copy" }, restartRequired: true };
    }
    if (command === "delete_bloxbot_skill") {
      return { skill: skills[1], restartRequired: true };
    }
    return undefined;
  });
});

describe("SkillsSettings", () => {
  it("lists and searches skills while enforcing built-in restrictions", async () => {
    renderSkills();
    expect(await screen.findByText("bloxbot-playtest-debugging")).toBeInTheDocument();
    const builtinCard = screen.getByText("bloxbot-playtest-debugging").closest(".rounded-lg");
    expect(builtinCard).not.toBeNull();
    expect(within(builtinCard as HTMLElement).queryByText("Edit")).not.toBeInTheDocument();
    expect(within(builtinCard as HTMLElement).queryByText("Delete")).not.toBeInTheDocument();
    expect(within(builtinCard as HTMLElement).getByText("Duplicate")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "custom" } });
    expect(screen.getByText("my-workflow")).toBeInTheDocument();
    expect(screen.queryByText("bloxbot-playtest-debugging")).not.toBeInTheDocument();
  });

  it("toggles a skill and shows the persistent restart banner", async () => {
    renderSkills();
    const toggle = await screen.findByLabelText("Disable bloxbot-playtest-debugging");
    const thumb = toggle.querySelector("span");
    expect(thumb).toHaveClass("left-0.5", "translate-x-4");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_bloxbot_skill_enabled", {
        id: "bloxbot-playtest-debugging",
        enabled: false,
      });
      expect(screen.getByText(/Restart BloxBot to apply skill changes/)).toBeInTheDocument();
    });
  });

  it("creates a structured skill draft and leaves YAML generation to the backend", async () => {
    renderSkills();
    fireEvent.click(await screen.findByText("Create skill"));
    const dialog = screen.getByRole("dialog", { name: "Create skill" });
    const fields = within(dialog).getAllByRole("textbox");
    fireEvent.change(fields[0], { target: { value: "review-workflow" } });
    fireEvent.change(fields[1], { target: { value: "Review important Roblox changes" } });
    fireEvent.change(fields[2], { target: { value: "# Review\n\nInspect before editing." } });
    fireEvent.click(within(dialog).getByText("Save skill"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_bloxbot_skill", {
        draft: {
          id: "review-workflow",
          description: "Review important Roblox changes",
          instructions: "# Review\n\nInspect before editing.",
        },
      });
    });
  });

  it("loads an editable skill document and saves without changing its ID", async () => {
    renderSkills();
    const customCard = (await screen.findByText("my-workflow")).closest(".rounded-lg");
    fireEvent.click(within(customCard as HTMLElement).getByText("Edit"));
    const dialog = await screen.findByRole("dialog", { name: "Edit skill" });
    const fields = within(dialog).getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(fields[0]).toBeDisabled();
    fireEvent.change(fields[1], { target: { value: "Updated project workflow" } });
    fireEvent.click(within(dialog).getByText("Save skill"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_bloxbot_skill", { id: "my-workflow" });
      expect(invoke).toHaveBeenCalledWith("save_bloxbot_skill", {
        draft: {
          id: "my-workflow",
          description: "Updated project workflow",
          instructions: "# Existing workflow\n\nFollow it.",
        },
      });
    });
  });

  it("duplicates built-ins and soft-deletes custom skills", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("playtest-copy");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSkills();

    const builtinCard = (await screen.findByText("bloxbot-playtest-debugging")).closest(
      ".rounded-lg",
    );
    fireEvent.click(within(builtinCard as HTMLElement).getByText("Duplicate"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("duplicate_bloxbot_skill", {
        sourceId: "bloxbot-playtest-debugging",
        newId: "playtest-copy",
      });
    });

    const customCard = screen.getByText("my-workflow").closest(".rounded-lg");
    fireEvent.click(within(customCard as HTMLElement).getByText("Delete"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_bloxbot_skill", { id: "my-workflow" });
      expect(window.confirm).toHaveBeenCalled();
    });
  });

  it("reads a local SKILL.md for full review before importing it", async () => {
    const contents =
      '---\nname: team-review\ndescription: "Review changes from the team"\n---\n\n# Review\n\nInspect every change.\n';
    const file = new File([contents], "SKILL.md", { type: "text/markdown" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(contents) });
    renderSkills();
    const input = await screen.findByLabelText("Import SKILL.md file");
    fireEvent.change(input, { target: { files: [file] } });

    const reviewDialog = await screen.findByRole("dialog", { name: "Import skill" });
    const fields = within(reviewDialog).getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(fields[0]).toHaveValue("team-review");
    expect(fields[1]).toHaveValue("Review changes from the team");
    expect(fields[2]).toHaveValue("# Review\n\nInspect every change.");
    expect(within(reviewDialog).getByText(/Review every instruction/i)).toBeInTheDocument();
    fireEvent.click(within(reviewDialog).getByText("Import skill"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_bloxbot_skill", {
        draft: {
          id: "team-review",
          description: "Review changes from the team",
          instructions: "# Review\n\nInspect every change.",
        },
      });
    });
  });

  it("exports a standards-compliant SKILL.md download", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:skill-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderSkills();

    const customCard = (await screen.findByText("my-workflow")).closest(".rounded-lg");
    fireEvent.click(within(customCard as HTMLElement).getByText("Export"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_bloxbot_skill", { id: "my-workflow" });
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:skill-export");
    });
  });
});

describe("validateSkillDraft", () => {
  it("validates reserved IDs and size limits", () => {
    expect(
      validateSkillDraft({ id: "bloxbot-custom", description: "Valid", instructions: "Do it" }),
    ).toContain("reserved");
    expect(
      validateSkillDraft({ id: "valid-skill", description: "Valid", instructions: "Do it" }),
    ).toBeNull();
    expect(
      validateSkillDraft({
        id: "valid-skill",
        description: "Valid",
        instructions: "x".repeat(128 * 1024),
      }),
    ).toContain("128 KiB");
  });
});

describe("serializeSkillDocument", () => {
  it("writes portable YAML frontmatter and Markdown instructions", () => {
    expect(
      serializeSkillDocument({
        id: "team-review",
        description: "Review: safely",
        instructions: "# Review\n\nDo it.",
      }),
    ).toBe('---\nname: team-review\ndescription: "Review: safely"\n---\n\n# Review\n\nDo it.\n');
  });
});

describe("parseSkillDocument", () => {
  it("reads quoted frontmatter and normalizes CRLF", () => {
    expect(
      parseSkillDocument(
        '---\r\nname: team-review\r\ndescription: "Review: safely"\r\n---\r\n\r\n# Review\r\n\r\nDo it.\r\n',
      ),
    ).toEqual({
      id: "team-review",
      description: "Review: safely",
      instructions: "# Review\n\nDo it.",
    });
  });

  it("reads common multiline YAML descriptions", () => {
    expect(
      parseSkillDocument(
        "---\nname: team-review\ndescription: >-\n  Review changes from the team\n  before merging.\nlicense: MIT\n---\n\nFollow the workflow.\n",
      ).description,
    ).toBe("Review changes from the team before merging.");
  });

  it("rejects malformed or instruction-less files", () => {
    expect(() => parseSkillDocument("# Not a skill")).toThrow(/frontmatter/i);
    expect(() => parseSkillDocument("---\nname: empty\ndescription: Empty\n---\n")).toThrow(
      /instructions/i,
    );
  });
});
