import { useChats, type ReplyStats, type StepStats } from '@/store/chats';
import { CHARS_PER_TOKEN } from './context';
import type { StreamUsage } from './providers';

/** How many of the chat's latest model responses the shown numbers average over. */
const WINDOW = 10;

// Responses that streamed in quicker than this (a tool call sent whole) can't be timed.
const MIN_MS = 100;

/**
 * A response's numbers: the server's own decode count and time where it reports them, otherwise
 * the time from its first streamed chunk to its end, over the tokens it reported or, failing
 * that, an estimate from the characters that streamed.
 */
export function stepStats(usage: StreamUsage | undefined, chars: number, streamedMs: number): StepStats | null {
  const tokens = usage?.output ?? Math.ceil(chars / CHARS_PER_TOKEN);
  const ms = usage?.output != null && usage.decodeMs ? usage.decodeMs : streamedMs;
  if (!tokens && usage?.input == null) return null;
  return {
    tokens,
    ms: ms >= MIN_MS ? Math.round(ms) : 0,
    ...(usage?.input != null ? { input: usage.input } : {}),
    ...(usage?.input != null && usage.cached != null ? { cached: usage.cached } : {}),
  };
}

/**
 * Tokens per second over the steps' combined time, so a long response counts for more than a short
 * one, and the share of their prompt tokens the server had cached; each left out when no step
 * reported what it needs.
 */
function summarize(steps: StepStats[]): ReplyStats {
  const timed = steps.filter((s) => s.ms > 0);
  const ms = timed.reduce((n, s) => n + s.ms, 0);
  const known = steps.filter((s) => s.input && s.cached != null);
  const input = known.reduce((n, s) => n + s.input!, 0);
  return {
    ...(ms ? { tokensPerSec: (timed.reduce((n, s) => n + s.tokens, 0) / ms) * 1000 } : {}),
    ...(input ? { cacheHit: known.reduce((n, s) => n + s.cached!, 0) / input } : {}),
  };
}

/** Adds a response's numbers to the reply, with the stats over the chat's latest responses from the same model. */
export function recordStep(conversationId: string, replyId: string, step: StepStats) {
  const messages = useChats.getState().conversations[conversationId]?.messages ?? [];
  const end = messages.findIndex((m) => m.id === replyId);
  if (end < 0) return;
  const reply = messages[end];
  const steps = [...(reply.steps ?? []), step];
  const recent = messages
    .slice(0, end)
    .filter((m) => m.role === 'assistant' && m.model === reply.model)
    .flatMap((m) => m.steps ?? [])
    .concat(steps)
    .slice(-WINDOW);
  useChats.getState().updateMessage(conversationId, replyId, { steps, stats: summarize(recent) });
}

export function formatStats(stats: ReplyStats | undefined, opts: { speed: boolean; cache: boolean }) {
  const parts: string[] = [];
  if (opts.speed && stats?.tokensPerSec != null) parts.push(`${stats.tokensPerSec.toFixed(stats.tokensPerSec < 10 ? 1 : 0)} tok/s`);
  if (opts.cache && stats?.cacheHit != null) parts.push(`${Math.round(stats.cacheHit * 100)}% cached`);
  return parts.join(' · ');
}
