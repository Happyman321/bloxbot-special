import { usePostHog } from "@posthog/react";
import { useMutation } from "@tanstack/react-query";

import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface SendMessageInput {
  text: string;
  images?: Array<{ mime: string; url: string; filename?: string }>;
  preferFastVariant?: boolean;
}

export function useSendMessage() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const {
    selectedModel,
    selectedAgent,
    selectedVariant,
    preferredStudioId,
    sessionFolderById,
    folderInstructionsByName,
  } = usePreferences();
  const posthog = usePostHog();

  return useMutation({
    mutationFn: async ({ text, images, preferFastVariant }: SendMessageInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const messagePrefixes: string[] = [];

      if (preferredStudioId) {
        messagePrefixes.push(
          `[Studio Target: ${preferredStudioId}] Before running Roblox Studio tools, call set_active_studio with this exact ID and keep it active for this request.`,
        );
      }

      const activeFolder = sessionFolderById[activeSessionId];
      if (activeFolder) {
        const folderInstructions = folderInstructionsByName[activeFolder]?.trim();
        if (folderInstructions) {
          messagePrefixes.push(
            `[Workspace Instructions: ${activeFolder}] Follow these project-specific instructions for this request:\n${folderInstructions}`,
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

      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) {
          opts.model = { providerID, modelID };
        }
      }

      if (selectedAgent) opts.agent = selectedAgent;
      if (selectedVariant) opts.variant = selectedVariant;
      else if (preferFastVariant) opts.variant = "fast";

      await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0]);
      posthog.capture("message_sent", {
        model: selectedModel ?? undefined,
        agent: selectedAgent ?? undefined,
      });
    },
  });
}
