import type { RemoteBackend } from './types';

export function resolveRemoteEffort(backend: RemoteBackend | undefined, model: string | undefined, chosen?: string) {
  const levels = model ? backend?.modelOptions?.[model]?.efforts : undefined;
  if (!model || !levels?.length) return null;
  const saved = chosen ?? backend?.efforts?.[model];
  const defaultLevel = backend?.modelOptions?.[model]?.defaultEffort;
  const level = saved && levels.includes(saved) ? saved : defaultLevel && levels.includes(defaultLevel) ? defaultLevel : levels.includes('medium') ? 'medium' : levels.at(-1)!;
  return { levels, level };
}
