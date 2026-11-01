import { useBackends } from '@/store/backends';
import { messageText, useChats } from '@/store/chats';
import { useProjects } from '@/store/projects';
import { useUI } from '@/store/ui';
import type { AttachmentPart } from '@/lib/providers';
import { flushJsonStorage } from '@/lib/storage';
import { notifyReplyFinished } from '@/lib/notifications';
import { RemoteAdapter } from './client';
import { resolveRemoteEffort } from './effort';
import { remoteTerminal, type RemoteBackend } from './types';

const observing = new Set<string>();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isRemoteChat(id: string | null) {
  const backend = id ? useChats.getState().conversations[id]?.backendId : useBackends.getState().selected;
  return !!backend && backend !== 'local';
}

export function adapterForChat(id: string) {
  const chat = useChats.getState().conversations[id];
  const backend = useBackends.getState().remotes.find((b) => b.id === chat?.backendId);
  if (!backend) throw new Error('This backend was removed. Restore its connection in Settings → Backends.');
  return new RemoteAdapter({ ...backend, bridgeId: chat.remote?.bridgeId ?? backend.bridgeId });
}

export async function refreshRemoteBackend(backendId: string) {
  const backend = useBackends.getState().remotes.find((b) => b.id === backendId);
  if (!backend) return;
  const info = await new RemoteAdapter(backend).info();
  const current = useBackends.getState().remotes.find((b) => b.id === backendId);
  if (!current || current.bridgeId !== info.bridgeId) return;
  useBackends.getState().save({ ...current, models: info.models, modelOptions: info.modelOptions, modelSwitching: info.modelSwitching });
}

export function remoteEffortForChat(id: string) {
  const chat = useChats.getState().conversations[id];
  const backend = useBackends.getState().remotes.find((b) => b.id === chat?.backendId);
  return resolveRemoteEffort(backend, chat?.model, chat?.remote?.effort)?.level;
}

export function sendRemoteMessage(id: string | null, text: string, attachments: AttachmentPart[], options?: { effort?: string }) {
  const chats = useChats.getState();
  let backend: RemoteBackend | undefined;
  if (!id) {
    backend = useBackends.getState().remotes.find((b) => b.id === useBackends.getState().selected);
    if (!backend?.bridgeId || !backend.model) throw new Error('Test and save a backend connection in Settings → Backends first.');
    const projectId = useUI.getState().newChatProjectId;
    id = chats.create('', backend.model, {
      backendId: backend.id, remote: { bridgeId: backend.bridgeId, effort: resolveRemoteEffort(backend, backend.model)?.level, instructions: projectId ? useProjects.getState().projects[projectId]?.instructions ?? '' : '' }, memory: false,
      ...(useUI.getState().newChatProjectId ? { projectId: useUI.getState().newChatProjectId! } : {}),
    });
    chats.rename(id, text.trim().split('\n')[0].slice(0, 60) || 'Attachment', true);
  }
  const chat = chats.conversations[id] ?? useChats.getState().conversations[id];
  if (!chat) throw new Error('Chat no longer exists.');
  if (chat.remote?.submissionId) throw new Error('The previous remote turn must settle before another starts.');
  adapterForChat(id);
  const userMessageId = chats.addMessage(id, { role: 'user', status: 'done', content: [...attachments, ...(text ? [{ type: 'text' as const, text }] : [])] });
  const replyId = chats.addMessage(id, { role: 'assistant', status: 'streaming', content: [], model: chat.model });
  const effort = options ? options.effort : remoteEffortForChat(id);
  chats.setRemote(id, { ...(!options && chat.remote?.effort === undefined ? { effort } : {}), submissionEffort: effort, submissionModel: chat.model, submissionId: userMessageId, userMessageId, replyId, cursor: 0, runId: undefined });
  flushJsonStorage();
  void resumeRemoteChat(id);
  return id;
}

export async function resumeRemoteChat(id: string) {
  if (observing.has(id)) return;
  const initial = useChats.getState().conversations[id];
  if (!initial?.remote?.submissionId || !initial.remote.replyId) return;
  observing.add(id);
  let completed = false;
  let cancelled = false;
  try {
    const adapter = adapterForChat(id);
    await adapter.info();
    const instructions = initial.remote.instructions ?? (initial.projectId ? useProjects.getState().projects[initial.projectId]?.instructions ?? '' : '');
    let sessionId = initial.remote.sessionId;
    if (!sessionId) {
      sessionId = (await adapter.ensureSession(id, initial.remote.submissionModel ?? initial.model, instructions)).sessionId;
      useChats.getState().setRemote(id, { sessionId });
      flushJsonStorage();
    }
    let runId = initial.remote.runId;
    if (!runId) {
      const user = initial.messages.find((m) => m.id === initial.remote!.userMessageId);
      if (!user) throw new Error('The original message is unavailable.');
      const attachments = user.content.filter((p): p is AttachmentPart => p.type === 'file' || p.type === 'image');
      const files = [];
      for (let index = 0; index < attachments.length; index++) {
        if (useChats.getState().conversations[id]?.remote?.stopRequested) break;
        const file = await adapter.upload(sessionId, attachments[index], `${user.id}_${index}`);
        files.push(file.id);
      }
      runId = (useChats.getState().conversations[id]?.remote?.stopRequested
        ? await adapter.stopSubmission(sessionId, initial.remote.submissionId)
        : await adapter.start(sessionId, initial.remote.submissionId, messageText(user), files, initial.remote.submissionEffort, initial.remote.submissionModel)).id;
      useChats.getState().setRemote(id, { runId });
      flushJsonStorage();
    }
    let failures = 0;
    while (useChats.getState().conversations[id]?.remote?.submissionId === initial.remote.submissionId) {
      try {
        if (useChats.getState().conversations[id]?.remote?.stopRequested) {
          await adapter.stop(runId);
          useChats.getState().setRemote(id, { stopRequested: false });
          flushJsonStorage();
        }
        const snapshot = await adapter.snapshot(runId);
        const current = useChats.getState().conversations[id];
        if (!current || current.remote?.submissionId !== initial.remote.submissionId) break;
        if (snapshot.sessionId !== sessionId || snapshot.id !== runId) throw new Error('Bridge returned the wrong session.');
        if (snapshot.cursor >= (current.remote.cursor ?? 0)) {
          useChats.getState().updateMessage(id, initial.remote.replyId, {
            content: snapshot.content,
            remote: { state: snapshot.state, controls: snapshot.controls, files: snapshot.files },
            status: snapshot.state === 'failed' || snapshot.state === 'unknown' ? 'error' : remoteTerminal(snapshot.state) ? 'done' : 'streaming',
            error: snapshot.error,
            ...(snapshot.metrics ? { stats: { tokensPerSec: snapshot.metrics.tokensPerSec, cacheHit: snapshot.metrics.cacheHit } } : {}),
          });
          useChats.getState().setRemote(id, { cursor: snapshot.cursor, ...(snapshot.metrics?.context ? { context: snapshot.metrics.context } : {}) });
        }
        failures = 0;
        if (remoteTerminal(snapshot.state)) {
          completed = snapshot.state === 'completed';
          cancelled = snapshot.state === 'cancelled';
          useChats.getState().setRemote(id, { submissionId: undefined, submissionEffort: undefined, submissionModel: undefined, runId: undefined, replyId: undefined, userMessageId: undefined, stopRequested: false });
          flushJsonStorage();
          void notifyReplyFinished(id, initial.remote.replyId);
          break;
        }
        if (snapshot.state === 'unknown') break;
      } catch (error) {
        failures++;
        useChats.getState().updateMessage(id, initial.remote.replyId, {
          error: `Connection interrupted. Reconnecting without repeating the turn. ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      await wait(failures ? Math.min(1000 * 2 ** Math.min(failures, 4), 10000) : 750);
    }
  } catch (error) {
    useChats.getState().updateMessage(id, initial.remote.replyId, {
      status: 'error', error: `${error instanceof Error ? error.message : String(error)} Use Reconnect to reconcile this turn; it will not be repeated.`,
    });
  } finally {
    observing.delete(id);
    if (completed && !cancelled) sendRemoteQueue(id);
  }
}

export function stopRemoteChat(id: string) {
  const chat = useChats.getState().conversations[id];
  if (!chat?.remote?.submissionId) return;
  useChats.getState().setRemote(id, { stopRequested: true });
  flushJsonStorage();
  if (chat.remote.replyId) {
    const message = chat.messages.find((m) => m.id === chat.remote!.replyId);
    useChats.getState().updateMessage(id, chat.remote.replyId, {
      remote: { files: message?.remote?.files ?? [], controls: [], state: 'stopping' },
    });
  }
  void resumeRemoteChat(id);
}

export function sendRemoteQueue(id: string, queuedId?: string) {
  const chat = useChats.getState().conversations[id];
  if (!chat || chat.remote?.submissionId) return;
  const queued = queuedId ? chat.queue?.find((q) => q.id === queuedId) : chat.queue?.[0];
  if (!queued) return;
  try {
    sendRemoteMessage(id, queued.text, queued.attachments, { effort: queued.remoteEffort });
    useChats.getState().setQueue(id, (chat.queue ?? []).filter((q) => q.id !== queued.id));
  } catch { /* Keep the queued message until the connection is restored. */ }
}
