import { interruptTool, messageText, useChats } from '@/store/chats';
import { resolveBudget, resolveEffort, useSettings } from '@/store/settings';
import { readAttachmentBase64, saveToWorkspace } from './attachments';
import { autoCompress, buildWire, historyOf, historyTokens, unitsOf } from './context';
import { getAdapter, ProviderError, type AttachmentPart, type Endpoint, type ToolPart } from './providers';
import { apiKeys, uid } from './storage';
import { availableTools, executeTool } from './tools';
import { markObserved } from './tools/observe';
import { agentSystemPrompt, writeContextNote } from './tools/prompt';

const controllers = new Map<string, AbortController>();

// Batch tokens so the store (and the markdown re-render) updates at most ~25 times a second.
const FLUSH_MS = 40;

// Model responses per reply before the agent loop gives up, so a confused model can't spin forever.
const MAX_STEPS = 50;

/** Whether a request failed because the prompt is longer than the model's context window. */
function isOverflow(e: unknown) {
  if (!(e instanceof Error)) return false;
  if (e instanceof ProviderError && e.status && ![400, 413, 422, 500].includes(e.status)) return false;
  return /context.{0,20}(length|window|limit|size)|too long|too many tokens|maximum.{0,30}(tokens|length)|token limit|exceeds?.{0,40}(context|tokens)|input length/i.test(
    e.message
  );
}

function fallbackTitle(text: string) {
  const line = text.trim().split('\n')[0];
  return line ? (line.length > 40 ? line.slice(0, 40).trimEnd() + '…' : line) : 'Image';
}

/** Starts a new conversation (when `conversationId` is null) or continues one, and streams the reply. */
export function sendMessage(conversationId: string | null, text: string, attachments: AttachmentPart[]) {
  const { active, tools } = useSettings.getState();
  if (!active) throw new Error('Add an endpoint in Settings to start chatting.');
  const chats = useChats.getState();
  const id = conversationId ?? chats.create(active.endpointId, active.model);

  // With tools on, attachments are also copied into the workspace so the agent can work on them.
  const parts = tools
    ? attachments.map((a) => {
        try {
          return { ...a, path: saveToWorkspace(a) };
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

  chats.setModel(id, active.endpointId, active.model);
  chats.addMessage(id, {
    role: 'user',
    content: [...parts, ...(text ? [{ type: 'text' as const, text }] : [])],
    status: 'done',
  });
  if (!conversationId) chats.rename(id, fallbackTitle(text), false);

  void runCompletion(id);
  return id;
}

/** Drops `messageId` (an assistant reply) and everything after it, then asks the model again. */
export function regenerate(conversationId: string, messageId: string) {
  const { active } = useSettings.getState();
  const chats = useChats.getState();
  if (active) chats.setModel(conversationId, active.endpointId, active.model);
  chats.truncateFrom(conversationId, messageId);
  void runCompletion(conversationId);
}

export function stopStreaming(conversationId: string) {
  controllers.get(conversationId)?.abort();
}

async function runCompletion(id: string) {
  const chats = useChats.getState();
  const conversation = chats.conversations[id];
  if (!conversation) return;
  const settings = useSettings.getState();
  const endpoint = settings.endpoints.find((e) => e.id === conversation.endpointId);
  const effort = resolveEffort(settings, { endpointId: conversation.endpointId, model: conversation.model });

  const replyId = chats.addMessage(id, {
    role: 'assistant',
    content: [],
    status: 'streaming',
    model: conversation.model,
  });

  if (!endpoint) {
    chats.updateMessage(id, replyId, { status: 'error', error: 'This endpoint no longer exists. Pick another model.' });
    return;
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  let buffer = '';
  let reasoningBuffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const chats = useChats.getState();
    if (reasoningBuffer) chats.appendReasoning(id, replyId, reasoningBuffer);
    if (buffer) chats.appendText(id, replyId, buffer);
    buffer = '';
    reasoningBuffer = '';
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
  const offered = settings.tools ? availableTools() : [];
  const tools = offered.length ? offered : undefined;
  const budget = resolveBudget(endpoint, conversation.model);
  const { compression } = useSettings.getState();
  const reply = () => useChats.getState().conversations[id]?.messages.find((m) => m.id === replyId);

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
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await getAdapter(endpoint.type).stream({
            endpoint,
            apiKey,
            model: conversation.model,
            effort: effort?.level,
            system: tools ? agentSystemPrompt() : undefined,
            tools,
            messages: await buildMessages(),
            signal: controller.signal,
            onToken: (token) => {
              streamed = true;
              markThoughtDone();
              buffer += token;
              timer ??= setTimeout(flush, FLUSH_MS);
            },
            onReasoning: (token) => {
              streamed = true;
              thinkingStartedAt ||= Date.now();
              reasoningBuffer += token;
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
      if (!tools || !result.toolCalls.length) break;
      if (step >= MAX_STEPS) {
        useChats.getState().appendText(id, replyId, `\n\n_Stopped after ${MAX_STEPS} rounds of tool calls._`);
        break;
      }

      // Some servers reuse ids like "call_0" across responses; ids must be unique within the reply.
      const taken = new Set(reply()?.content.flatMap((p) => (p.type === 'tool' ? [p.id] : [])));
      const stepId = uid();
      const calls = result.toolCalls.map((c, i): ToolPart => ({
        type: 'tool',
        id: taken.has(c.id) ? `${c.id}_${uid()}` : c.id,
        name: c.name,
        input: c.input,
        status: 'running',
        step: stepId,
        ...(c.signature ? { signature: c.signature } : {}),
        ...(i === 0 && result.thinking ? { thinking: result.thinking } : {}),
      }));
      useChats.getState().appendParts(id, replyId, calls);
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
    }
    useChats.getState().updateMessage(id, replyId, { status: 'done' });
  } catch (e) {
    flush();
    markThoughtDone();
    const content = (reply()?.content ?? []).map(interruptTool);
    if (controller.signal.aborted) {
      useChats.getState().updateMessage(id, replyId, { status: 'done', content });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      useChats.getState().updateMessage(id, replyId, { status: 'error', error, content });
      return;
    }
  } finally {
    if (timer) clearTimeout(timer);
    controllers.delete(id);
  }

  const latest = useChats.getState().conversations[id];
  if (latest && !latest.titled) void generateTitle(id, endpoint, apiKey, conversation.model);
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
