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
  /** Providers whose models are all kept out of the model picker, as `modelGroup` gives them. */
  hiddenProviders?: string[];
  /**
   * Whether a started chat can change model: to any of the bridge's models ('any'), or, on bridges
   * from before that, only to one from the provider it started with (true).
   */
  modelSwitching?: boolean | 'any';
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
  modelSwitching?: RemoteBackend['modelSwitching'];
  maxFileBytes: number;
};

export const MAX_REMOTE_FILE_BYTES = 20 * 1024 * 1024;
/** Models are provider/model routes; older bridges only switch a chat within its provider. */
export const modelProvider = (model: string) => model.split('/')[0];
/** The provider a model is listed under: its route's prefix, or '' for an id without one. */
export const modelGroup = (model: string) => (model.includes('/') ? modelProvider(model) : '');
/** The model's id within its provider, for rows that sit under the provider's heading. */
export const modelInGroup = (model: string) => {
  const group = modelGroup(model);
  return group ? model.slice(group.length + 1) : model;
};
export const groupLabel = (group: string) => group || 'Other';

/** Models by provider, in the order the bridge lists them; models without a provider come last. */
export function groupByProvider(models: string[]): { provider: string; models: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const g = modelGroup(m);
    const list = groups.get(g);
    if (list) list.push(m);
    else groups.set(g, [m]);
  }
  const ordered = [...groups].map(([provider, list]) => ({ provider, models: list }));
  return [...ordered.filter((g) => g.provider), ...ordered.filter((g) => !g.provider)];
}

/** Whether the model picker leaves a model out, on its own or with its whole provider. */
export const isModelHidden = (model: string, hiddenModels: string[] = [], hiddenProviders: string[] = []) =>
  hiddenModels.includes(model) || hiddenProviders.includes(modelGroup(model));
export const remoteTerminal = (state: RunState) => ['completed', 'cancelled', 'failed'].includes(state);
