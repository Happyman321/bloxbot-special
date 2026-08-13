import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { usePostHog } from "@posthog/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { chatErrorMessage } from "@/lib/chatErrors";
import { recordPromptFailure, recordPromptStart, recordPromptSuccess } from "@/lib/diagnostics";
import { qk } from "@/lib/queryKeys";
import type { SkillSummary } from "@/lib/skills";
import { splitModelKey } from "@/lib/splitModelKey";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface SendMessageInput {
  text: string;
  images?: Array<{ mime: string; url: string; filename?: string }>;
  skill?: SkillSummary;
}

interface StudioInstance {
  id: string;
  name: string;
  active: boolean;
}

export function useSendMessage() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();
  const {
    selectedModel,
    selectedAgent,
    selectedVariant,
    preferredStudioId,
    sessionFolderById,
    folderInstructionsByName,
    workspaceSettingsByName,
  } = usePreferences();
  const posthog = usePostHog();

  return useMutation({
    mutationFn: async ({ text, images, skill }: SendMessageInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const messagePrefixes: string[] = [];

      if (skill) {
        messagePrefixes.push(
          `[BloxBot Skill Selected: ${skill.id}] Load this exact BloxBot skill with the native skill tool before doing any work on this request. Do not substitute a similarly named Studio MCP skill.`,
        );
      }

      const activeFolder = sessionFolderById[activeSessionId];
      const activeWorkspaceSettings = activeFolder
        ? workspaceSettingsByName[activeFolder]
        : undefined;
      const cachedMessages = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
      const isFirstChatMessage = (cachedMessages?.messageIds.length ?? 0) === 0;

      if (preferredStudioId) {
        messagePrefixes.push(
          `[Studio Target Already Active: ${preferredStudioId}] BloxBot has already activated this exact Studio for the request. Do not list Studios or call set_active_studio; use the active Studio directly.`,
        );
      } else if (isFirstChatMessage && activeWorkspaceSettings?.type !== "vscode") {
        let detectedStudios: StudioInstance[] = [];

        // Studio discovery can briefly return an empty list even while the app's
        // connection indicator is already green. Retry once before handing the
        // request to a brand-new chat so the model does not mistake that race for
        // a disconnected Studio session.
        for (let attempt = 0; attempt < 2 && detectedStudios.length === 0; attempt += 1) {
          try {
            detectedStudios = await invoke<StudioInstance[]>("list_roblox_studios");
          } catch (error) {
            if (attempt === 1) {
              console.warn("Unable to preflight Roblox Studio for the new chat:", error);
            }
          }
        }

        const detectedTarget =
          detectedStudios.find((studio) => studio.active) ??
          (detectedStudios.length === 1 ? detectedStudios[0] : undefined);
        const detectedStudioId = detectedTarget?.id.trim();

        if (detectedStudioId) {
          try {
            await invoke("set_active_roblox_studio", { studioId: detectedStudioId });
            messagePrefixes.push(
              `[Studio Target Already Active: ${detectedStudioId}] BloxBot verified and activated this Studio before starting the new chat. Do not list Studios or call set_active_studio; use the active Studio directly.`,
            );
          } catch (error) {
            console.warn("Unable to activate the auto-detected Roblox Studio:", error);
          }
        }
      }

      if (activeFolder && isFirstChatMessage) {
        const folderInstructions =
          activeWorkspaceSettings?.instructions.trim() ??
          folderInstructionsByName[activeFolder]?.trim();
        if (folderInstructions) {
          messagePrefixes.push(
            `[Workspace Instructions: ${activeFolder}] Follow these project-specific instructions for this request:\n${folderInstructions}`,
          );
        }
        if (activeWorkspaceSettings?.type === "vscode") {
          const companionStatus = activeWorkspaceSettings.vscodeCompanionEnabled
            ? "enabled"
            : "disabled";
          messagePrefixes.push(
            [
              `[VS Code Workspace: ${activeFolder}]`,
              `Project folder: ${activeWorkspaceSettings.vscodePath || "(not configured)"}`,
              `Companion mode: ${companionStatus}.`,
              "Default to a plan/review workflow before editing project files.",
              "Use Roblox Studio MCP tools for context when useful, but avoid Studio mutations unless the user clearly asks.",
              "For project file work, prefer the BloxBot VS Code MCP tools. Propose changes for VS Code review and wait for approval before claiming files were changed.",
            ].join("\n"),
          );
        }
      }

      const messageText =
        messagePrefixes.length > 0 ? [...messagePrefixes, text].join("\n\n") : text;

      const parts: Array<{ type: string; [k: string]: unknown }> = [
        { type: "text", text: messageText },
      ];
      if (images) {
        for (const img of images) {
          parts.push({ type: "file", mime: img.mime, url: img.url, filename: img.filename });
        }
      }
      const opts: Record<string, unknown> = {
        sessionID: activeSessionId,
        parts,
      };

      let providerID: string | undefined;
      let modelID: string | undefined;

      if (selectedModel) {
        [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) {
          opts.model = { providerID, modelID };
        }
      }

      if (activeWorkspaceSettings?.type === "vscode") {
        opts.agent = activeWorkspaceSettings.defaultAgent ?? "vscode-workspace";
      } else if (selectedAgent) {
        opts.agent = selectedAgent;
      }
      if (selectedVariant) opts.variant = selectedVariant;

      recordPromptStart({
        sessionID: activeSessionId,
        providerID: providerID ?? null,
        modelID: modelID ?? null,
      });
      queryClient.setQueryData(qk.chatError(activeSessionId), null);
      try {
        if (preferredStudioId) {
          try {
            await invoke("set_active_roblox_studio", { studioId: preferredStudioId });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Could not activate the selected Roblox Studio, so the message was not sent. Retry the selection or switch to Auto detect. ${detail}`,
            );
          }
        }
        await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0]);
        recordPromptSuccess();
        posthog.capture("message_sent", {
          model: selectedModel ?? undefined,
          agent: selectedAgent ?? undefined,
          skill_invocation: skill ? "explicit" : "implicit_or_none",
          skill_source: skill?.source,
        });
      } catch (error) {
        recordPromptFailure(error);
        queryClient.setQueryData(qk.chatError(activeSessionId), chatErrorMessage(error));
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => ({
          ...prev,
          [activeSessionId]: { type: "idle" } as SessionStatus,
        }));
        throw error;
      }
    },
  });
}
