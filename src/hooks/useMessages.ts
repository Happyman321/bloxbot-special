import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { MessageWithParts } from "@/types";

const NOOP_KEY = ["__noop__"] as const;
const EMPTY_IDS: string[] = [];
const EMPTY_CACHE: MessagesCache = { messageIds: [], messagesById: {} };
const MESSAGE_PAGE_SIZE = 200;

interface MessagesPageResponse {
  data?: MessageWithParts[];
  next?: string | null;
  cursor?: string | null;
}

function toMessagesCache(messages: MessageWithParts[]): MessagesCache {
  const messageIds: string[] = [];
  const messagesById: Record<string, MessageWithParts> = {};
  for (const msg of messages) {
    messageIds.push(msg.info.id);
    messagesById[msg.info.id] = { info: msg.info, parts: msg.parts };
  }
  return { messageIds, messagesById };
}

export async function fetchMessages(
  client: OpencodeClient,
  sessionID: string,
): Promise<MessagesCache> {
  const allMessages: MessageWithParts[] = [];
  let cursor: string | null = null;

  while (true) {
    const params = {
      sessionID,
      limit: MESSAGE_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    } as unknown as Parameters<typeof client.session.messages>[0];
    const res = (await client.session.messages(params)) as MessagesPageResponse;
    const pageMessages = Array.isArray(res?.data) ? res.data : [];

    if (pageMessages.length > 0) {
      allMessages.push(...pageMessages);
    }

    const nextCursor = (res.next ?? res.cursor ?? null) as string | null;
    if (!nextCursor || pageMessages.length === 0) break;
    cursor = nextCursor;
  }

  if (allMessages.length === 0) return EMPTY_CACHE;
  return toMessagesCache(allMessages);
}

export function useMessagesCache(): MessagesCache {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<MessagesCache>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () => {
      if (!client || !activeSessionId) return EMPTY_CACHE;
      return fetchMessages(client, activeSessionId);
    },
    enabled: ready && !!client && !!activeSessionId,
  });

  return data ?? EMPTY_CACHE;
}

export function useMessageIds(): string[] {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<MessagesCache, Error, string[]>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () => {
      if (!client || !activeSessionId) return EMPTY_CACHE;
      return fetchMessages(client, activeSessionId);
    },
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messageIds, []),
  });
  return data ?? EMPTY_IDS;
}

export function useMessage(messageId: string): MessageWithParts | undefined {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  return useQuery<MessagesCache, Error, MessageWithParts | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () => {
      if (!client || !activeSessionId) return EMPTY_CACHE;
      return fetchMessages(client, activeSessionId);
    },
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messagesById[messageId], [messageId]),
  }).data;
}
