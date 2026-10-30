import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { attachmentUri } from '@/lib/attachments';
import { apiKeys, uid } from '@/lib/storage';
import { cachedRemoteFile } from './cache';
import { forgetBridgeAddress, resolveBridgeAddress } from './addresses';
import { MAX_REMOTE_FILE_BYTES, type BridgeInfo, type RemoteBackend, type RemoteFile, type RemoteSnapshot } from './types';

export class RemoteAdapter {
  constructor(readonly backend: RemoteBackend, private token?: string) {}

  private async request(path: string, init: RequestInit = {}, retrySafe = false) {
    const token = this.token ?? await apiKeys.get(`bridge_${this.backend.id}`);
    if (!token) throw new Error('Set the bridge token in Settings → Backends.');
    const selected = await resolveBridgeAddress(this.backend, token, fetch);
    const send = async (url: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), init.body instanceof File ? 120000 : 10000);
      try {
        return await fetch(`${url}/v1/${path}`, { ...init, signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'X-Clanker-Bridge': this.backend.bridgeId, ...init.headers } });
      } finally { clearTimeout(timeout); }
    };
    let response;
    try { response = await send(selected.url); }
    catch (error) {
      forgetBridgeAddress(this.backend);
      if (init.method && init.method !== 'GET' && !retrySafe) throw error;
      const next = await resolveBridgeAddress(this.backend, token, fetch, true);
      if (next.url === selected.url) throw error;
      response = await send(next.url);
    }
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try { message = JSON.parse(body).error ?? body; } catch {}
      throw new Error(`${response.status}: ${message.slice(0, 500)}`);
    }
    return response;
  }

  private async json<T>(path: string, body?: unknown, retrySafe = false): Promise<T> {
    const response = await this.request(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, retrySafe);
    return response.json() as Promise<T>;
  }

  async info(): Promise<BridgeInfo> {
    const token = this.token ?? await apiKeys.get(`bridge_${this.backend.id}`);
    if (!token) throw new Error('Set the bridge token in Settings → Backends.');
    return (await resolveBridgeAddress(this.backend, token, fetch, true)).info;
  }

  ensureSession(chatId: string, model: string, instructions: string) {
    return this.json<{ sessionId: string }>('sessions', { chatId, model, instructions }, true);
  }

  async upload(sessionId: string, attachment: { file?: string; name?: string; text?: string; mimeType: string }, uploadId: string) {
    if (!attachment.file) throw new Error('The original attachment is unavailable. Attach the file again.');
    const file = new File(attachmentUri(attachment.file));
    if (!file.exists || file.size > MAX_REMOTE_FILE_BYTES) throw new Error('Attachment missing or larger than 20 MB.');
    const response = await this.request(`sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(uploadId)}?name=${encodeURIComponent(attachment.name ?? 'photo.jpg')}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    }, true);
    return response.json() as Promise<RemoteFile>;
  }

  start(sessionId: string, submissionId: string, text: string, files: string[], effort?: string) {
    return this.json<{ id: string }>(`sessions/${encodeURIComponent(sessionId)}/runs`, { submissionId, text, files, ...(effort ? { effort } : {}) }, true);
  }
  snapshot(runId: string) { return this.json<RemoteSnapshot>(`runs/${encodeURIComponent(runId)}`); }
  stop(runId: string) { return this.json(`runs/${encodeURIComponent(runId)}/stop`, {}); }
  stopSubmission(sessionId: string, submissionId: string) {
    return this.json<{ id: string }>(`sessions/${encodeURIComponent(sessionId)}/submissions/${encodeURIComponent(submissionId)}/stop`, {});
  }
  acknowledge(runId: string) { return this.json(`runs/${encodeURIComponent(runId)}/acknowledge`, { confirmedStopped: true }); }
  respond(runId: string, controlId: string, answer: string) {
    return this.json(`runs/${encodeURIComponent(runId)}/controls`, { controlId, answer });
  }
  files(sessionId: string) { return this.json<RemoteFile[]>(`sessions/${encodeURIComponent(sessionId)}/files`); }

  async download(chatId: string, sessionId: string, artifact: RemoteFile) {
    const dest = cachedRemoteFile(chatId, artifact.version, artifact.name);
    if (dest.exists) return dest;
    if (artifact.size > MAX_REMOTE_FILE_BYTES) throw new Error('This file is larger than 20 MB. Retrieve it on the host device.');
    const response = await this.request(`sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(artifact.id)}?version=${artifact.version}`);
    if (!response.body) throw new Error('Download has no body.');
    const temp = new File(`${dest.uri}.${uid()}.part`);
    temp.create();
    const writer = temp.writableStream().getWriter();
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_REMOTE_FILE_BYTES) throw new Error('Download exceeds 20 MB.');
        await writer.write(value);
      }
      await writer.close();
      if (size !== artifact.size) throw new Error('Incomplete download. Please retry.');
      if (dest.exists) temp.delete();
      else temp.move(dest);
      return dest;
    } catch (error) {
      await writer.abort().catch(() => {});
      if (temp.exists) temp.delete();
      throw error;
    } finally { reader.releaseLock(); }
  }
}
