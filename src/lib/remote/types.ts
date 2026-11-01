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
  /** Kept out of the model picker. */
  hiddenModels?: string[];
  /** Whether the bridge lets a chat switch to another model from its provider. */
  modelSwitching?: boolean;
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
  submissionModel?: string;
  context?: RemoteMetrics['context'];
};
export type RemoteReply = Pick<RemoteSnapshot, 'state' | 'files' | 'controls'>;
export type BridgeInfo = {
  protocol: 1;
  bridgeId: string;
  kind: RemoteBackend['kind'];
  models: string[];
  modelOptions?: RemoteBackend['modelOptions'];
  modelSwitching?: boolean;
  maxFileBytes: number;
};

export const MAX_REMOTE_FILE_BYTES = 20 * 1024 * 1024;
/** Models are provider/model routes; a chat can only switch within its provider. */
export const modelProvider = (model: string) => model.split('/')[0];
export const remoteTerminal = (state: RunState) => ['completed', 'cancelled', 'failed'].includes(state);
