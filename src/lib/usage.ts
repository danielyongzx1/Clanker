import { useEffect, useMemo, useState } from 'react';
import { useChats, type Conversation } from '@/store/chats';
import { useMemory } from '@/store/memory';
import { resolveBudget, useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { historyOf, tokensOf, unitsOf, visibleTokens } from './context';
import { availableTools } from './tools';
import { systemPrompt } from './tools/prompt';

/** Estimated tokens the next request would send, by part, against the model's budget. */
export type ContextUsage = { system: number; tools: number; messages: number; budget: number };

const STREAM_REFRESH_MS = 1000;

/**
 * The conversation, kept current when a message is added or a reply ends but refreshed at most
 * once a second while a reply streams in: counting the whole history's tokens on every streamed
 * token (and re-rendering the screen with it) took frames from everything else.
 */
function useThrottledConversation(id: string | null) {
  const read = () => (id ? useChats.getState().conversations[id] : undefined);
  const [conversation, setConversation] = useState<Conversation | undefined>(read);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      setConversation(read());
    };
    refresh();
    const shape = (c?: Conversation) => `${c?.messages.length}:${c?.messages.at(-1)?.status}`;
    const unsubscribe = useChats.subscribe((s, prev) => {
      const c = id ? s.conversations[id] : undefined;
      const before = id ? prev.conversations[id] : undefined;
      if (c === before) return;
      if (shape(c) !== shape(before)) refresh();
      else timer ??= setTimeout(refresh, STREAM_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return conversation;
}

/**
 * Context usage of a chat (or the new-chat state) with the selected model, or null when `enabled`
 * is off or no model is selected. Same rough estimates the agent loop compresses by.
 */
export function useContextUsage(conversationId: string | null, enabled: boolean): ContextUsage | null {
  const endpoint = useSettings((s) => s.endpoints.find((e) => e.id === s.active?.endpointId));
  const model = useSettings((s) => s.active?.model);
  const withTools = useSettings((s) => s.tools);
  const disabledTools = useSettings((s) => s.disabledTools);
  const memory = useSettings((s) => s.memory);
  const memories = useMemory((s) => s.memories);
  const newChatMemoryOff = useUI((s) => s.newChatMemoryOff);
  const conversation = useThrottledConversation(conversationId);
  const budget = endpoint && model ? resolveBudget(endpoint, model) : null;

  const replyId = conversation?.messages.find((m) => m.status === 'streaming')?.id;
  const count = conversation?.messages.length ?? 0;
  // Refreshed when a message starts or a reply ends (the web and shell tools can come and go),
  // not on every streamed token.
  const overhead = useMemo(() => {
    if (!enabled || !budget) return { system: 0, tools: 0 };
    const tools = withTools ? availableTools(conversationId) : [];
    return {
      system: tokensOf(systemPrompt(conversationId, tools.length > 0) ?? ''),
      tools: tools.length ? tokensOf(JSON.stringify(tools)) : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, budget, withTools, disabledTools, memory, memories, newChatMemoryOff, conversationId, replyId, count]);

  const messages = useMemo(() => {
    if (!enabled || !conversation) return 0;
    return visibleTokens(unitsOf(historyOf(conversation, replyId)), conversation.compressions ?? []);
  }, [enabled, conversation, replyId]);

  return enabled && budget ? { ...overhead, messages, budget } : null;
}
