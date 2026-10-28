import { messageText, useChats, type CompressionBlock, type Conversation, type Message } from '@/store/chats';
import type { ProviderType, ToolPart, WireImage, WireMessage } from './providers';
import { describeCall } from './tools/describe';

/**
 * The history as the model sees it is a list of units: each user message, each step of an
 * assistant reply (its text plus one response's tool calls and their results), and each
 * assistant closing text. User messages and steps get refs (m1, m2, ...) shown to the model so it
 * can compress ranges of them; refs count every such unit since the start of the chat, compressed
 * or not, so they never shift. Closing texts carry no tag and go with the range around them.
 */
export type Unit = {
  key: string;
  ref: number | null;
  kind: 'user' | 'step' | 'text';
  message: Message;
  text: string;
  calls: ToolPart[];
  tokens: number;
};

// Rough token costs; good enough to steer compression, not to bill.
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1500;

// Providers that take binary non-image attachments inline (PDFs and the like).
const BINARY_FILE_PROVIDERS: ProviderType[] = ['anthropic', 'gemini'];

const tokensOf = (s: string) => Math.ceil(s.length / CHARS_PER_TOKEN);

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
}

/** Reads a token count like "32000", "32,000", "128K" or "1.5M"; null if it isn't one. */
export function parseTokens(text: string) {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(text.replace(/[\s,_]/g, ''));
  if (!match) return null;
  const scale = { '': 1, k: 1000, m: 1_000_000 }[match[2].toLowerCase() as '' | 'k' | 'm'];
  const n = Math.round(parseFloat(match[1]) * scale);
  return n > 0 ? n : null;
}

const refName = (ref: number) => `m${ref}`;

/** Messages that go to the model: finished ones, plus the reply being written. */
export function historyOf(conversation: Conversation, replyId?: string) {
  return conversation.messages.filter((m) => m.status === 'done' || m.id === replyId);
}

function userTokens(m: Message) {
  let n = tokensOf(messageText(m));
  for (const p of m.content) {
    if (p.type === 'image') n += IMAGE_TOKENS;
    else if (p.type === 'file') n += p.text != null ? tokensOf(p.text) : Math.max(1000, Math.round((p.size ?? 0) / 50));
  }
  return n;
}

function stepTokens(text: string, calls: ToolPart[]) {
  let n = tokensOf(text);
  for (const c of calls) {
    n += tokensOf(JSON.stringify(c.input)) + tokensOf(c.output ?? '') + (c.images?.length ?? 0) * IMAGE_TOKENS + 20;
  }
  return n;
}

export function unitsOf(messages: Message[]): Unit[] {
  const units: Unit[] = [];
  let ref = 0;
  for (const m of messages) {
    if (m.role === 'user') {
      units.push({ key: m.id, ref: ++ref, kind: 'user', message: m, text: messageText(m), calls: [], tokens: userTokens(m) });
      continue;
    }
    let text = '';
    let calls: ToolPart[] = [];
    let texts = 0;
    const end = () => {
      if (calls.length) {
        const key = `${m.id}:${calls[0].step ?? calls[0].id}`;
        units.push({ key, ref: ++ref, kind: 'step', message: m, text, calls, tokens: stepTokens(text, calls) });
      } else if (text) {
        units.push({ key: `${m.id}:t${texts++}`, ref: null, kind: 'text', message: m, text, calls: [], tokens: tokensOf(text) });
      }
      text = '';
      calls = [];
    };
    for (const part of m.content) {
      if (part.type === 'text') {
        if (calls.length) end();
        text += part.text;
      } else if (part.type === 'tool') {
        if (calls.length && (calls[0].step ?? calls[0].id) !== (part.step ?? part.id)) end();
        calls.push(part);
      }
    }
    end();
  }
  return units;
}

/** Blocks whose ends still exist, as unit index ranges, in order and without overlaps. */
function applied(units: Unit[], blocks: CompressionBlock[]) {
  const index = new Map(units.map((u, i) => [u.key, i]));
  const out: { block: CompressionBlock; start: number; end: number }[] = [];
  for (const block of blocks) {
    const start = index.get(block.start);
    const end = index.get(block.end);
    if (start == null || end == null || start > end) continue;
    out.push({ block, start, end });
  }
  out.sort((a, b) => a.start - b.start);
  return out.filter((r, i) => i === 0 || r.start > out[i - 1].end);
}

function rangeLabel(units: Unit[], start: number, end: number) {
  const refs = units.slice(start, end + 1).flatMap((u) => (u.ref ? [u.ref] : []));
  if (!refs.length) return '';
  const first = refName(refs[0]);
  const last = refName(refs[refs.length - 1]);
  return first === last ? first : `${first}–${last}`;
}

function summaryText(block: CompressionBlock, label: string) {
  return `<compressed id="${block.id}" refs="${label}">\n${block.summary}\n</compressed>`;
}

// ---- building the request --------------------------------------------------------------------

type WireOptions = {
  endpointType: ProviderType;
  /** Without tools, calls are folded into text: APIs reject tool turns when no tools are offered. */
  withTools: boolean;
  /** Tags units with their refs so the model can compress them. */
  tagged: boolean;
  readBase64: (file: string) => Promise<string | null>;
};

async function userToWire(unit: Unit, opts: WireOptions): Promise<WireMessage> {
  const message = unit.message;
  const images: WireMessage['images'] = [];
  const files: NonNullable<WireMessage['files']> = [];
  let text = unit.text;
  for (const part of message.content) {
    if (part.type === 'image') {
      const base64 = await opts.readBase64(part.file);
      // A missing attachment file sends the text alone rather than failing the request.
      if (base64) images.push({ base64, mimeType: part.mimeType });
      if (part.path) text += `\n\n[Attached image saved in the workspace as "${part.path}".]`;
    } else if (part.type === 'file') {
      const saved = part.path ? ` (saved in the workspace as "${part.path}")` : '';
      if (part.text != null) {
        // Text-like file: inline it so every provider can read it.
        text += `\n\nAttached file "${part.name}"${saved}:\n\n${part.text}`;
      } else if (part.file) {
        const base64 = await opts.readBase64(part.file);
        if (!base64) {
          text += `\n\n[Attached file "${part.name}" is no longer available.]`;
        } else if (BINARY_FILE_PROVIDERS.includes(opts.endpointType)) {
          files.push({ name: part.name, mimeType: part.mimeType, base64 });
          if (saved) text += `\n\n[Attached file "${part.name}"${saved}.]`;
        } else if (saved) {
          text += `\n\n[Attached ${part.mimeType} file "${part.name}"${saved}. Open it with read_file or a script.]`;
        } else {
          text += `\n\n[Attached ${part.mimeType} file "${part.name}" — this endpoint cannot receive binary files.]`;
        }
      }
    }
  }
  if (opts.tagged && unit.ref) text = `[${refName(unit.ref)} · ~${formatTokens(unit.tokens)} tokens]\n${text}`;
  return { role: 'user', text, images, ...(files.length ? { files } : {}) };
}

async function stepToWire(unit: Unit, opts: WireOptions): Promise<WireMessage[]> {
  const { text, calls } = unit;
  if (!opts.withTools) {
    const summary = calls.map((c) => `[${c.name} ${JSON.stringify(c.input).slice(0, 300)} → ${(c.output ?? '').slice(0, 1500)}]`);
    return [{ role: 'assistant', text: [text, ...summary].filter(Boolean).join('\n\n'), images: [] }];
  }
  const tag = opts.tagged && unit.ref ? `[${refName(unit.ref)} · ~${formatTokens(unit.tokens)} tokens]\n` : '';
  const results = await Promise.all(
    calls.map(async (c, i) => {
      const images: WireImage[] = [];
      for (const img of c.images ?? []) {
        const base64 = await opts.readBase64(img.file);
        if (base64) images.push({ base64, mimeType: img.mimeType });
      }
      return {
        callId: c.id,
        name: c.name,
        output: (i === 0 ? tag : '') + (c.output ?? ''),
        isError: c.status === 'error',
        images,
      };
    })
  );
  return [
    {
      role: 'assistant',
      text,
      images: [],
      toolCalls: calls.map((c) => ({ id: c.id, name: c.name, input: c.input, signature: c.signature })),
      thinking: calls[0].thinking,
    },
    { role: 'tool', text: '', images: [], results },
  ];
}

/** The request history: every unit, with compressed ranges swapped for their summaries. */
export async function buildWire(units: Unit[], blocks: CompressionBlock[], opts: WireOptions): Promise<WireMessage[]> {
  const ranges = applied(units, blocks);
  const out: WireMessage[] = [];
  let r = 0;
  for (let i = 0; i < units.length; i++) {
    const range = ranges[r];
    if (range && range.start === i) {
      out.push({ role: 'user', text: summaryText(range.block, rangeLabel(units, range.start, range.end)), images: [] });
      i = range.end;
      r++;
      continue;
    }
    const unit = units[i];
    if (unit.kind === 'user') out.push(await userToWire(unit, opts));
    else if (unit.kind === 'step') out.push(...(await stepToWire(unit, opts)));
    else out.push({ role: 'assistant', text: unit.text, images: [] });
  }
  return out;
}

/** Estimated tokens of the history as sent, after compression. */
export function visibleTokens(units: Unit[], blocks: CompressionBlock[]) {
  const ranges = applied(units, blocks);
  let total = units.reduce((n, u) => n + u.tokens, 0);
  for (const { block, start, end } of ranges) {
    for (let i = start; i <= end; i++) total -= units[i].tokens;
    total += tokensOf(block.summary) + 15;
  }
  return total;
}

// ---- compress / decompress ---------------------------------------------------------------------

class ContextError extends Error {}

function parseRef(units: Unit[], value: unknown) {
  const m = String(value ?? '').trim().match(/^m?(\d+)$/i);
  const index = m ? units.findIndex((u) => u.ref === parseInt(m[1], 10)) : -1;
  if (index < 0) throw new ContextError(`Unknown ref "${value}". Refs look like m12; check context_status.`);
  return index;
}

function nextBlockId(blocks: CompressionBlock[]) {
  let max = 0;
  const visit = (list: CompressionBlock[]) =>
    list.forEach((b) => {
      max = Math.max(max, parseInt(b.id.slice(1), 10) || 0);
      if (b.children) visit(b.children);
    });
  visit(blocks);
  return `b${max + 1}`;
}

/**
 * Adds a block over units [start, end], absorbing the blocks inside it as children. Fails on a
 * block that straddles either edge.
 */
function addBlock(units: Unit[], blocks: CompressionBlock[], start: number, end: number, summary: string, auto = false) {
  const ranges = applied(units, blocks);
  const inside: CompressionBlock[] = [];
  for (const r of ranges) {
    if (r.end < start || r.start > end) continue;
    if (r.start >= start && r.end <= end) inside.push(r.block);
    else if (r.start <= start && r.end >= end) {
      throw new ContextError(`${rangeLabel(units, start, end)} is already compressed in ${r.block.id}.`);
    } else {
      throw new ContextError(
        `The range overlaps ${r.block.id} (${rangeLabel(units, r.start, r.end)}); widen it to cover all of ${r.block.id}, or stop before it.`
      );
    }
  }
  // Blocks whose ends no longer exist (after a regenerate) are dropped here too.
  const live = new Set(ranges.map((r) => r.block));
  const block: CompressionBlock = {
    id: nextBlockId(blocks),
    start: units[start].key,
    end: units[end].key,
    summary: summary.trim(),
    createdAt: Date.now(),
    ...(auto ? { auto: true } : {}),
    ...(inside.length ? { children: inside } : {}),
  };
  const next = [...blocks.filter((b) => live.has(b) && !inside.includes(b)), block];
  const saved = Math.max(0, visibleTokens(units, blocks) - visibleTokens(units, next));
  return { block, blocks: next, saved };
}

export type ContextScope = {
  conversationId: string;
  replyId: string;
  /** Step of the call being run: it, and everything after it, can't be compressed yet. */
  step?: string;
};

function load(scope: ContextScope) {
  const conversation = useChats.getState().conversations[scope.conversationId];
  if (!conversation) throw new ContextError('This chat no longer exists.');
  const units = unitsOf(historyOf(conversation, scope.replyId));
  const current = units.findIndex((u) => u.message.id === scope.replyId && u.calls.some((c) => c.step === scope.step));
  return { units, blocks: conversation.compressions ?? [], protectedFrom: current < 0 ? units.length : current };
}

/** The compress tool: replaces each range with the model's summary. */
export function compress(scope: ContextScope, ranges: { from?: unknown; to?: unknown; summary?: unknown }[]) {
  if (!Array.isArray(ranges) || !ranges.length) throw new ContextError('Pass at least one range: {from, to, summary}.');
  const state = load(scope);
  let { blocks } = state;
  const report: string[] = [];
  for (const range of ranges) {
    const start = parseRef(state.units, range.from);
    const end = parseRef(state.units, range.to ?? range.from);
    const summary = typeof range.summary === 'string' ? range.summary : '';
    if (start > end) throw new ContextError(`"from" (${range.from}) comes after "to" (${range.to}).`);
    if (end >= state.protectedFrom) {
      throw new ContextError('A range can only cover history before this tool call; the current step is still in use.');
    }
    if (summary.trim().length < 20) throw new ContextError('Each range needs a real summary that can stand in for it.');
    const result = addBlock(state.units, blocks, start, end, summary);
    blocks = result.blocks;
    const absorbed = result.block.children?.length ? `, absorbing ${result.block.children.map((c) => c.id).join(', ')}` : '';
    report.push(`${rangeLabel(state.units, start, end)} → ${result.block.id} (saves ~${formatTokens(result.saved)} tokens${absorbed})`);
  }
  useChats.getState().setCompressions(scope.conversationId, blocks);
  return `Compressed ${report.join('; ')}. Context now ~${formatTokens(visibleTokens(state.units, blocks))} tokens of history.`;
}

/** The decompress tool: restores a block one tier (its children come back), or fully. */
export function decompress(scope: ContextScope, id: unknown, full: boolean) {
  const { units, blocks } = load(scope);
  const target = blocks.find((b) => b.id === id);
  if (!target) {
    const parent = blocks.find((b) => JSON.stringify(b.children ?? []).includes(`"id":"${id}"`));
    throw new ContextError(parent ? `${id} is inside ${parent.id}; decompress ${parent.id} first.` : `No block "${id}".`);
  }
  const next = blocks.flatMap((b) => (b === target ? (full ? [] : (b.children ?? [])) : [b]));
  useChats.getState().setCompressions(scope.conversationId, next);
  const added = visibleTokens(units, next) - visibleTokens(units, blocks);
  const restored = full || !target.children?.length ? 'original messages' : `blocks ${target.children.map((c) => c.id).join(', ')}`;
  return `Restored ${target.id} to its ${restored} (+~${formatTokens(added)} tokens). They appear in place from your next step.`;
}

function unitLabel(u: Unit) {
  if (u.kind === 'user') return `user: "${u.text.replace(/\s+/g, ' ').slice(0, 70)}"`;
  if (u.kind === 'step') return u.calls.map((c) => describeCall(c.name, c.input)).join(', ');
  return 'assistant text';
}

function searchable(u: Unit) {
  const parts = [u.text];
  for (const p of u.message.content) if (u.kind === 'user' && p.type === 'file') parts.push(p.name, p.text ?? '');
  for (const c of u.calls) parts.push(c.name, JSON.stringify(c.input), c.output ?? '');
  return parts.join('\n');
}

/** The search_context tool: finds units and summaries mentioning `query`. */
export function searchContext(scope: ContextScope, query: unknown) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) throw new ContextError('Pass a query.');
  const words = q.split(/\s+/);
  const { units, blocks } = load(scope);
  const ranges = applied(units, blocks);
  const blockOf = (i: number) => ranges.find((r) => i >= r.start && i <= r.end)?.block.id;
  const hits: string[] = [];
  const snippet = (text: string) => {
    const lower = text.toLowerCase();
    let at = lower.indexOf(q);
    if (at < 0) at = lower.indexOf(words[0]);
    return text.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, ' ').trim();
  };
  const matches = (text: string) => {
    const lower = text.toLowerCase();
    return lower.includes(q) || words.every((w) => lower.includes(w));
  };
  for (const r of ranges) {
    if (matches(r.block.summary)) hits.push(`${r.block.id} summary (${rangeLabel(units, r.start, r.end)}): …${snippet(r.block.summary)}…`);
  }
  units.forEach((u, i) => {
    const text = searchable(u);
    if (!matches(text)) return;
    const where = u.ref ? refName(u.ref) : `text after ${rangeLabel(units, 0, i) || 'start'}`;
    const block = blockOf(i);
    hits.push(`${where}${block ? ` (in ${block})` : ''} ${unitLabel(u)}: …${snippet(text)}…`);
  });
  if (!hits.length) return `Nothing in this chat matches "${query}".`;
  return hits.slice(0, 30).join('\n') + (hits.length > 30 ? `\n[${hits.length - 30} more matches]` : '');
}

/** The context_status tool: size of the history, blocks, and the largest uncompressed units. */
export function contextStatus(scope: ContextScope, budget: number) {
  const { units, blocks, protectedFrom } = load(scope);
  const ranges = applied(units, blocks);
  const covered = new Set(ranges.flatMap((r) => units.slice(r.start, r.end + 1).map((u) => u.key)));
  const lines = [`History: ~${formatTokens(visibleTokens(units, blocks))} tokens (budget ~${formatTokens(budget)}).`];
  if (ranges.length) {
    lines.push('', 'Compressed blocks:');
    for (const r of ranges) {
      const original = units.slice(r.start, r.end + 1).reduce((n, u) => n + u.tokens, 0);
      lines.push(
        `- ${r.block.id} ${rangeLabel(units, r.start, r.end)}${r.block.auto ? ' (auto)' : ''}: ${formatTokens(original)} → ${formatTokens(
          tokensOf(r.block.summary)
        )} tokens. ${r.block.summary.replace(/\s+/g, ' ').slice(0, 90)}…`
      );
    }
  }
  const open = units
    .map((u, i) => ({ u, i }))
    .filter(({ u, i }) => u.ref && !covered.has(u.key) && i < protectedFrom)
    .sort((a, b) => b.u.tokens - a.u.tokens)
    .slice(0, 15);
  if (open.length) {
    lines.push('', 'Largest uncompressed (compressible) units:');
    for (const { u } of open) lines.push(`- ${refName(u.ref!)} ~${formatTokens(u.tokens)} tokens: ${unitLabel(u)}`);
  }
  return lines.join('\n');
}

// ---- automatic compression -------------------------------------------------------------------

function mechanicalSummary(units: Unit[], blocks: CompressionBlock[], start: number, end: number) {
  const ranges = applied(units, blocks);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const r = ranges.find((x) => x.start === i);
    if (r) {
      lines.push(`- ${r.block.id}: ${r.block.summary.replace(/\s+/g, ' ').slice(0, 400)}`);
      i = r.end;
      continue;
    }
    const u = units[i];
    if (u.kind === 'user') lines.push(`- ${refName(u.ref!)} user: ${u.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    else if (u.kind === 'step') {
      const calls = u.calls.map((c) => `${describeCall(c.name, c.input)} → ${(c.output ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
      lines.push(`- ${refName(u.ref!)} ${u.text ? `${u.text.replace(/\s+/g, ' ').slice(0, 120)} ` : ''}[${calls.join('; ')}]`);
    } else lines.push(`- assistant: ${u.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  let body = lines.join('\n');
  if (body.length > 6000) body = `${body.slice(0, 2000)}\n…\n${body.slice(-3500)}`;
  return `[Compressed automatically because the chat outgrew the context budget. One line per item; use search_context and decompress for details.]\n${body}`;
}

/** Estimated tokens of a chat's history as it would be sent now. */
export function historyTokens(conversationId: string, replyId: string) {
  const conversation = useChats.getState().conversations[conversationId];
  if (!conversation) return 0;
  return visibleTokens(unitsOf(historyOf(conversation, replyId)), conversation.compressions ?? []);
}

/**
 * Once the history estimate passes `trigger` tokens, compresses old history into mechanical
 * summaries until it drops to `target`: first everything before the latest user message, then
 * earlier steps of the reply in progress. The latest user message and the latest step stay as
 * they are. Returns whether anything changed.
 */
export function autoCompress(conversationId: string, replyId: string, trigger: number, target: number) {
  const conversation = useChats.getState().conversations[conversationId];
  if (!conversation) return false;
  const units = unitsOf(historyOf(conversation, replyId));
  let blocks = conversation.compressions ?? [];
  if (visibleTokens(units, blocks) <= trigger) return false;

  const lastUser = units.map((u) => u.kind).lastIndexOf('user');
  const lastStep = units.map((u) => u.kind).lastIndexOf('step');
  const spans: [number, number][] = [[0, lastUser - 1]];
  if (lastStep > lastUser) spans.push([lastUser + 1, lastStep - 1]);

  let changed = false;
  for (const [lo, hi] of spans) {
    let total = visibleTokens(units, blocks);
    if (total <= target) break;
    const ranges = applied(units, blocks);
    // Start on a tagged unit; a block that reaches into the span from before it can't be split.
    let start = lo;
    while (start <= hi && !units[start].ref) start++;
    if (ranges.some((r) => r.start < start && r.end >= start)) continue;
    let end = -1;
    let lastNew = -1;
    for (let i = start; i <= hi && total > target; i++) {
      const r = ranges.find((x) => x.start <= i && x.end >= i);
      if (r) {
        // An existing block gets absorbed: what it costs now is its summary.
        if (r.end > hi) break;
        total -= tokensOf(r.block.summary) + 15;
        i = r.end;
      } else {
        total -= units[i].tokens;
        if (units[i].ref) lastNew = i;
      }
      end = i;
    }
    // Ranges end on a tagged unit, so step back over closing texts.
    while (end >= start && !units[end].ref) end--;
    // Re-wrapping blocks without any new history in them would only nest deeper.
    if (end < start || lastNew < 0) continue;
    try {
      ({ blocks } = addBlock(units, blocks, start, end, mechanicalSummary(units, blocks, start, end), true));
      changed = true;
    } catch {
      // A block straddles the span's end; leave this span alone.
    }
  }
  if (changed) useChats.getState().setCompressions(conversationId, blocks);
  return changed;
}

export { ContextError };
