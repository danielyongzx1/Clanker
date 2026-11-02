import { interruptContent, messageText, useChats, type QueuedMessage } from '@/store/chats';
import { resolveBudget, resolveEffort, useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { deleteAttachment, readAttachmentBase64, saveToWorkspace } from './attachments';
import { autoCompress, buildWire, historyOf, historyTokens, unitsOf } from './context';
import { ensureMemoryBase, extractMemories, memoryOn } from './memory';
import { askToNotify, notifyReplyFinished } from './notifications';
import { workspaceFor } from './projects';
import { parsePartialJson } from './partialJson';
import { firstLine } from './quotes';
import { getAdapter, ProviderError, type AttachmentPart, type Endpoint, type ToolCallDraft, type ToolPart } from './providers';
import { recordStep, stepStats } from './stats';
import { apiKeys, uid } from './storage';
import { availableTools, executeTool } from './tools';
import { answerInWords } from './tools/ask';
import { endPhoneRun, onPhoneStop } from './tools/phone';
import { markObserved } from './tools/observe';
import { isRemoteChat, remoteEffortForChat, sendRemoteMessage, sendRemoteQueue, stopRemoteChat } from './remote/chat';
import { systemPrompt, writeContextNote } from './tools/prompt';

const controllers = new Map<string, AbortController>();

// Batch tokens so the store (and the markdown re-render) updates at most ~25 times a second.
const FLUSH_MS = 40;

/** Whether a request failed because the prompt is longer than the model's context window. */
function isOverflow(e: unknown) {
  if (!(e instanceof Error)) return false;
  if (e instanceof ProviderError && e.status && ![400, 413, 422, 500].includes(e.status)) return false;
  return /context.{0,20}(length|window|limit|size)|too long|too many tokens|maximum.{0,30}(tokens|length)|token limit|exceeds?.{0,40}(context|tokens)|input length/i.test(
    e.message
  );
}

/** The arguments of a tool call the model is still writing, as far as they parse. */
function draftInput(args: string): Record<string, unknown> {
  const value = parsePartialJson(args);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function fallbackTitle(text: string) {
  const line = firstLine(text);
  return line ? (line.length > 40 ? line.slice(0, 40).trimEnd() + '…' : line) : 'Image';
}

/** Adds the user's message to the conversation. */
function postUserMessage(id: string, text: string, attachments: AttachmentPart[]) {
  const { tools } = useSettings.getState();
  // With tools on, attachments are also copied into the workspace so the agent can work on them.
  const ws = workspaceFor(id);
  const parts = tools
    ? attachments.map((a) => {
        try {
          return { ...a, path: saveToWorkspace(ws, a) };
        } catch {
          return a;
        }
      })
    : attachments;
  // A text file inlined whole is already read, as far as read-before-write goes.
  markObserved(
    id,
    parts.flatMap((p) => (p.type === 'file' && p.path && p.text != null && !p.file ? [p.path] : []))
  );

  useChats.getState().addMessage(id, {
    role: 'user',
    content: [...parts, ...(text ? [{ type: 'text' as const, text }] : [])],
    status: 'done',
  });
}

/** Starts a new conversation (when `conversationId` is null) or continues one, and streams the reply. */
export function sendMessage(conversationId: string | null, text: string, attachments: AttachmentPart[]) {
  if (isRemoteChat(conversationId)) return sendRemoteMessage(conversationId, text, attachments);
  const { active } = useSettings.getState();
  if (!active) throw new Error('Add an endpoint in Settings to start chatting.');
  const chats = useChats.getState();
  const ui = useUI.getState();
  const id =
    conversationId ??
    chats.create(active.endpointId, active.model, {
      ...(ui.newChatMemoryOff ? { memory: false as const } : {}),
      ...(ui.newChatProjectId ? { projectId: ui.newChatProjectId } : {}),
    });

  chats.setModel(id, active.endpointId, active.model);
  postUserMessage(id, text, attachments);
  if (!conversationId) chats.rename(id, fallbackTitle(text), false);

  void runCompletion(id);
  return id;
}

/** Drops `messageId` (an assistant reply) and everything after it, then asks the model again. */
export function regenerate(conversationId: string, messageId: string) {
  if (isRemoteChat(conversationId)) return;
  const { active } = useSettings.getState();
  const chats = useChats.getState();
  if (active) chats.setModel(conversationId, active.endpointId, active.model);
  chats.truncateFrom(conversationId, messageId);
  void runCompletion(conversationId);
}

export function stopStreaming(conversationId: string) {
  if (isRemoteChat(conversationId)) return stopRemoteChat(conversationId);
  controllers.get(conversationId)?.abort();
}

// The Stop button on the phone-control overlay stops the replies operating the phone.
onPhoneStop(stopStreaming);

const queueOf = (conversationId: string) => useChats.getState().conversations[conversationId]?.queue ?? [];

/**
 * Sends a message, or while a reply is running, queues it to go out once the reply is done or, as
 * Settings choose, to steer the reply at its next step.
 */
export function submitMessage(conversationId: string | null, text: string, attachments: AttachmentPart[]) {
  if (conversationId && isRemoteChat(conversationId)) {
    const chat = useChats.getState().conversations[conversationId];
    if (!chat?.remote?.submissionId) return sendRemoteMessage(conversationId, text, attachments);
    useChats.getState().setQueue(conversationId, [...(chat.queue ?? []), { id: uid(), text, attachments, remoteEffort: remoteEffortForChat(conversationId) }]);
    return conversationId;
  }
  if (!conversationId || !controllers.has(conversationId)) return sendMessage(conversationId, text, attachments);
  // While the model waits on a question, a message answers it. Attachments can't go in the answer,
  // so they follow it into the reply at the next step.
  if (answerInWords(conversationId, text || '(No text; files the user attached follow.)')) {
    if (attachments.length) {
      useChats.getState().setQueue(conversationId, [...queueOf(conversationId), { id: uid(), text: '', attachments, steer: true }]);
    }
    return conversationId;
  }
  const message: QueuedMessage = { id: uid(), text, attachments };
  if (useSettings.getState().followUp === 'steer') message.steer = true;
  useChats.getState().setQueue(conversationId, [...queueOf(conversationId), message]);
  return conversationId;
}

/** Sends the queued message (by default the oldest) as the next turn. It stays queued if sending fails. */
function sendFromQueue(conversationId: string, queuedId?: string) {
  const queue = queueOf(conversationId);
  const message = queuedId ? queue.find((m) => m.id === queuedId) : queue[0];
  if (!message) return;
  useChats.getState().setQueue(conversationId, queue.filter((m) => m !== message));
  try {
    sendMessage(conversationId, message.text, message.attachments);
  } catch (e) {
    useChats.getState().setQueue(conversationId, queue);
    throw e;
  }
}

/** Steers the running reply with a queued message, or sends it right away when nothing is running. */
export function sendQueuedNow(conversationId: string, queuedId: string) {
  if (isRemoteChat(conversationId)) return sendRemoteQueue(conversationId, queuedId);
  if (!controllers.has(conversationId)) return sendFromQueue(conversationId, queuedId);
  useChats
    .getState()
    .setQueue(conversationId, queueOf(conversationId).map((m) => (m.id === queuedId ? { ...m, steer: true } : m)));
}

/** Takes a message out of the queue to be edited, its attachments kept. */
export function takeQueued(conversationId: string, queuedId: string) {
  const queue = queueOf(conversationId);
  const message = queue.find((m) => m.id === queuedId);
  if (message) useChats.getState().setQueue(conversationId, queue.filter((m) => m !== message));
  return message;
}

export function deleteQueued(conversationId: string, queuedId: string) {
  const message = takeQueued(conversationId, queuedId);
  for (const a of message?.attachments ?? []) if (a.file) deleteAttachment(a.file);
}

async function runCompletion(id: string) {
  const chats = useChats.getState();
  const conversation = chats.conversations[id];
  if (!conversation) return;
  const settings = useSettings.getState();
  const endpoint = settings.endpoints.find((e) => e.id === conversation.endpointId);
  const effort = resolveEffort(settings, { endpointId: conversation.endpointId, model: conversation.model });

  const startReply = () =>
    useChats.getState().addMessage(id, {
      role: 'assistant',
      content: [],
      status: 'streaming',
      model: conversation.model,
    });
  // A steered reply goes on in a new message after the user's (see `steer`).
  let replyId = startReply();

  if (!endpoint) {
    chats.updateMessage(id, replyId, { status: 'error', error: 'This endpoint no longer exists. Pick another model.' });
    return;
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  void askToNotify();
  let buffer = '';
  let reasoningBuffer = '';
  // Tool calls the model is still writing in the current response, by stream index, with the id
  // their part has in the reply. Shown as they grow, then swapped for the finished calls.
  const drafts = new Map<number, { draft: ToolCallDraft; partId: string }>();
  const changedDrafts = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const chats = useChats.getState();
    if (reasoningBuffer) chats.appendReasoning(id, replyId, reasoningBuffer);
    if (buffer) chats.appendText(id, replyId, buffer);
    if (changedDrafts.size) {
      const parts = [...changedDrafts].map((index): ToolPart => {
        const { draft, partId } = drafts.get(index)!;
        return { type: 'tool', id: partId, name: draft.name, input: draftInput(draft.args), status: 'writing' };
      });
      chats.putDrafts(id, replyId, parts);
    }
    buffer = '';
    reasoningBuffer = '';
    changedDrafts.clear();
  };

  // Wall time of the current stretch of thinking, recorded on its part when answer text or the
  // end of the response follows it. Each response (and each stretch within one) is timed apart.
  let thinkingStartedAt = 0;
  const markThoughtDone = () => {
    if (!thinkingStartedAt) return;
    const ms = Date.now() - thinkingStartedAt;
    thinkingStartedAt = 0;
    // The part may still be in the buffer.
    flush();
    useChats.getState().finishThought(id, replyId, ms);
  };

  // With every tool turned off one by one, the chat runs as if tools were off altogether.
  const offered = settings.tools ? availableTools(id) : [];
  const tools = offered.length ? offered : undefined;
  // The memories this chat's system prompt shows are fixed on its first request.
  ensureMemoryBase(id);
  const system = systemPrompt(id, !!tools);
  const budget = resolveBudget(endpoint, conversation.model);
  const { compression } = useSettings.getState();
  const reply = () => useChats.getState().conversations[id]?.messages.find((m) => m.id === replyId);
  // Ids of the reply's finished tool calls. Some servers reuse ids like "call_0" across responses;
  // ids must be unique within the reply.
  const takenIds = () =>
    new Set(reply()?.content.flatMap((p) => (p.type === 'tool' && p.status !== 'writing' ? [p.id] : [])));
  const settleDrafts = (parts: ToolPart[]) => {
    drafts.clear();
    useChats.getState().settleDrafts(id, replyId, parts);
  };
  // Messages sent to steer the reply join it between steps, where the history is whole: the reply
  // so far is closed, they follow it as one user turn, and a new reply picks up from there.
  const steer = () => {
    const queue = queueOf(id);
    const steers = queue.filter((m) => m.steer);
    if (!steers.length) return false;
    const chats = useChats.getState();
    chats.setQueue(id, queue.filter((m) => !m.steer));
    chats.updateMessage(id, replyId, { status: 'done' });
    postUserMessage(
      id,
      steers.map((m) => m.text).filter(Boolean).join('\n\n'),
      steers.flatMap((m) => m.attachments)
    );
    replyId = startReply();
    return true;
  };

  // Attachments and tool images are re-sent every step; read each file once per reply.
  const base64Cache = new Map<string, string | null>();
  const readBase64 = async (file: string) => {
    if (!base64Cache.has(file)) base64Cache.set(file, await readAttachmentBase64(file).catch(() => null));
    return base64Cache.get(file)!;
  };
  // Rebuilt every step: tool results grow the history and compression reshapes it.
  const buildMessages = () => {
    const current = useChats.getState().conversations[id];
    if (!current) return Promise.resolve([]);
    return buildWire(unitsOf(historyOf(current, replyId)), current.compressions ?? [], {
      endpointType: endpoint.type,
      withTools: !!tools,
      tagged: !!tools,
      notes: tools ? current.notes : undefined,
      readBase64,
    });
  };

  let apiKey: string | undefined;
  try {
    apiKey = (await apiKeys.get(endpoint.id)) ?? undefined;
    for (let step = 1; ; step++) {
      // Past the trigger share of the budget, old history is compressed mechanically down to the
      // target. The model is asked to compress well before that, with summaries that keep more.
      autoCompress(id, replyId, (budget * compression.trigger) / 100, (budget * compression.target) / 100);
      // What changes between steps (time, workspace, jobs) goes after the newest history item and
      // stays there, so the system prompt and earlier history are a stable, cacheable prefix.
      if (tools) writeContextNote({ conversationId: id, replyId, budget });
      let streamed = false;
      // For timing the response's decode where the server doesn't: from its first chunk to its end.
      let firstChunkAt = 0;
      let streamedChars = 0;
      const chunk = (chars: number) => {
        streamed = true;
        firstChunkAt ||= Date.now();
        streamedChars += chars;
      };
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await getAdapter(endpoint.type).stream({
            endpoint,
            apiKey,
            model: conversation.model,
            effort: effort?.level,
            system,
            tools,
            messages: await buildMessages(),
            signal: controller.signal,
            onToken: (token) => {
              chunk(token.length);
              markThoughtDone();
              buffer += token;
              timer ??= setTimeout(flush, FLUSH_MS);
            },
            onReasoning: (token) => {
              chunk(token.length);
              thinkingStartedAt ||= Date.now();
              reasoningBuffer += token;
              timer ??= setTimeout(flush, FLUSH_MS);
            },
            onToolDraft: (draft) => {
              chunk(0);
              markThoughtDone();
              const partId =
                drafts.get(draft.index)?.partId ?? (takenIds().has(draft.id) ? `${draft.id}_${uid()}` : draft.id);
              drafts.set(draft.index, { draft, partId });
              changedDrafts.add(draft.index);
              timer ??= setTimeout(flush, FLUSH_MS);
            },
          });
          break;
        } catch (e) {
          // Over the model's real window (the budget is only an estimate): compress harder and retry.
          const retry =
            attempt < 3 &&
            !streamed &&
            !controller.signal.aborted &&
            isOverflow(e) &&
            autoCompress(id, replyId, 0, historyTokens(id, replyId) / 2);
          if (!retry) throw e;
        }
      }
      flush();
      markThoughtDone();
      const toolChars = result.toolCalls.reduce((n, c) => n + c.name.length + JSON.stringify(c.input).length, 0);
      const stats = stepStats(result.usage, streamedChars + toolChars, firstChunkAt ? Date.now() - firstChunkAt : 0);
      if (stats) recordStep(id, replyId, stats);
      if (!tools || !result.toolCalls.length) {
        settleDrafts([]);
        // Rounds count per reply, and a steered one starts over.
        if (steer()) {
          step = 0;
          continue;
        }
        break;
      }
      // Read every step, so setting a limit mid-reply can rein in a model that's spinning.
      const { maxSteps } = useSettings.getState();
      if (maxSteps && step >= maxSteps) {
        settleDrafts([]);
        useChats.getState().appendText(id, replyId, `\n\n_Stopped after ${maxSteps} rounds of tool calls._`);
        break;
      }

      const taken = takenIds();
      // A finished call keeps its draft's id, so its row stays as it was (opened or not).
      const drafted = new Map([...drafts.values()].map((d) => [d.draft.id, d.partId]));
      const stepId = uid();
      const calls = result.toolCalls.map((c, i): ToolPart => ({
        type: 'tool',
        id: drafted.get(c.id) ?? (taken.has(c.id) ? `${c.id}_${uid()}` : c.id),
        name: c.name,
        input: c.input,
        status: 'running',
        step: stepId,
        ...(c.signature ? { signature: c.signature } : {}),
        ...(i === 0 && result.thinking ? { thinking: result.thinking } : {}),
      }));
      settleDrafts(calls);
      // One at a time: calls in a batch often depend on each other's files.
      for (const call of calls) {
        if (controller.signal.aborted) break;
        const started = Date.now();
        const outcome = await executeTool(call, {
          signal: controller.signal,
          conversationId: id,
          messageId: replyId,
          step: stepId,
          budget,
        });
        useChats.getState().patchTool(id, replyId, call.id, {
          status: outcome.isError ? 'error' : 'done',
          output: outcome.output,
          durationMs: Date.now() - started,
          ...(outcome.images?.length ? { images: outcome.images } : {}),
          ...(outcome.files?.length ? { files: outcome.files } : {}),
          ...(outcome.sources?.length ? { sources: outcome.sources } : {}),
        });
      }
      if (controller.signal.aborted) throw new Error('Stopped');
      if (steer()) step = 0;
    }
    useChats.getState().updateMessage(id, replyId, { status: 'done' });
  } catch (e) {
    flush();
    markThoughtDone();
    const content = interruptContent(reply()?.content ?? []);
    if (controller.signal.aborted) {
      useChats.getState().updateMessage(id, replyId, { status: 'done', content });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      useChats.getState().updateMessage(id, replyId, { status: 'error', error, content });
      void notifyReplyFinished(id, replyId);
      return;
    }
  } finally {
    if (timer) clearTimeout(timer);
    controllers.delete(id);
    endPhoneRun(id, controller.signal.aborted);
    // Steers that never reached a step boundary wait in the queue like any other message.
    const queue = queueOf(id);
    if (queue.some((m) => m.steer)) useChats.getState().setQueue(id, queue.map(({ steer: _, ...m }) => m));
  }

  const latest = useChats.getState().conversations[id];
  if (latest && !latest.titled && useSettings.getState().titleGeneration) void generateTitle(id, endpoint, apiKey, conversation.model);
  // A reply where the model managed memory itself needs no second pass, nor does a stopped one.
  const managed = reply()?.content.some((p) => p.type === 'tool' && p.name.startsWith('memory_'));
  if (latest && !controller.signal.aborted && !managed && memoryOn(id) && useSettings.getState().memoryAuto) {
    void extractMemories(id, replyId, endpoint, apiKey, conversation.model);
  }
  // The next queued message goes out as the following turn. A stopped reply holds the queue until
  // the user sends from it.
  if (!controller.signal.aborted) {
    try {
      sendFromQueue(id);
    } catch {
      // No model to send with; the message stays queued.
    }
    // Unless a queued message went out as the next turn, the agent is done.
    if (!controllers.has(id)) void notifyReplyFinished(id, replyId);
  }
}

async function generateTitle(id: string, endpoint: Endpoint, apiKey: string | undefined, model: string) {
  const conversation = useChats.getState().conversations[id];
  const firstUser = conversation?.messages.find((m) => m.role === 'user');
  if (!firstUser) return;
  const userText = messageText(firstUser).slice(0, 1500) || '(the user sent an attachment)';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let title = '';
  try {
    await getAdapter(endpoint.type).stream({
      endpoint,
      apiKey,
      model,
      // Titles don't need deliberation; the lowest level keeps them quick.
      effort: endpoint.efforts?.[model]?.[0],
      signal: controller.signal,
      messages: [
        {
          role: 'user',
          images: [],
          text:
            'Write a short title (2-6 words) for a conversation that starts with the message below. ' +
            'Reply with the title only: no quotes, no punctuation at the end.\n\n' +
            `Message: ${userText}`,
        },
      ],
      onToken: (t) => (title += t),
    });
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }

  title = title
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .split('\n')[0]
    .replace(/^(title:\s*)/i, '')
    .replace(/^["'*#\s]+|["'*.\s]+$/g, '')
    .slice(0, 60);
  const current = useChats.getState().conversations[id];
  if (current && title && !current.titled) useChats.getState().rename(id, title);
}
