import type { ContentPart } from '@/lib/providers';

export type RemoteBackend = {
  id: string;
  name: string;
  kind: 'hermes' | 'harness';
  baseUrl: string;
  /** Alternative routes to the same bridge, such as a VPN or HTTPS address. */
  altBaseUrls?: string[];
  bridgeId: string;
  models: string[];
  model: string;
  modelOptions?: Record<string, { efforts: string[]; defaultEffort?: string }>;
  /** Defaults for new chats; existing chats keep their own effort selection. */
  efforts?: Record<string, string>;
};

export type RemoteMetrics = {
  context?: { used: number; budget: number; estimated: boolean };
  tokensPerSec?: number;
  cacheHit?: number;
};
export type RemoteFile = { id: string; name: string; path: string; size: number; version: string };
export type RemoteControl = {
  id: string;
  kind: 'approval' | 'clarification';
  prompt: string;
  choices?: string[];
};
export type RunState = 'running' | 'stopping' | 'waiting' | 'completed' | 'cancelled' | 'failed' | 'unknown';
export type RemoteSnapshot = {
  id: string;
  sessionId: string;
  cursor: number;
  state: RunState;
  content: ContentPart[];
  files: RemoteFile[];
  controls: RemoteControl[];
  error?: string;
  metrics?: RemoteMetrics;
};
export type RemoteSession = {
  bridgeId: string;
  sessionId?: string;
  runId?: string;
  submissionId?: string;
  userMessageId?: string;
  replyId?: string;
  cursor?: number;
  stopRequested?: boolean;
  instructions?: string;
  effort?: string;
  /** Frozen before submission, including across reconnection. */
  submissionEffort?: string;
  context?: RemoteMetrics['context'];
};
export type RemoteReply = Pick<RemoteSnapshot, 'state' | 'files' | 'controls'>;
export type BridgeInfo = {
  protocol: 1;
  bridgeId: string;
  kind: RemoteBackend['kind'];
  models: string[];
  modelOptions?: RemoteBackend['modelOptions'];
  maxFileBytes: number;
};

export const MAX_REMOTE_FILE_BYTES = 20 * 1024 * 1024;
export const remoteTerminal = (state: RunState) => ['completed', 'cancelled', 'failed'].includes(state);
