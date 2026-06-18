import { usePostHog } from "@posthog/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordPromptFailure, recordPromptStart, recordPromptSuccess } from "@/lib/diagnostics";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface SendMessageInput {
  text: string;
  images?: Array<{ mime: string; url: string; filename?: string }>;
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
    mutationFn: async ({ text, images }: SendMessageInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const messagePrefixes: string[] = [];

      if (preferredStudioId) {
        messagePrefixes.push(
          `[Studio Target: ${preferredStudioId}] Before running Roblox Studio tools, call set_active_studio with this exact ID and keep it active for this request.`,
        );
      }

      const activeFolder = sessionFolderById[activeSessionId];
      const activeWorkspaceSettings = activeFolder
        ? workspaceSettingsByName[activeFolder]
        : undefined;
      const cachedMessages = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
      const isFirstChatMessage = (cachedMessages?.messageIds.length ?? 0) === 0;

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
      try {
        await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0]);
        recordPromptSuccess();
        posthog.capture("message_sent", {
          model: selectedModel ?? undefined,
          agent: selectedAgent ?? undefined,
        });
      } catch (error) {
        recordPromptFailure(error);
        throw error;
      }
    },
  });
}
