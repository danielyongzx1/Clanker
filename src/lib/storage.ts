import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const dataDir = new Directory(Paths.document, 'data');

function fileFor(name: string) {
  if (!dataDir.exists) dataDir.create({ intermediates: true });
  return new File(dataDir, `${name}.json`);
}

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  for (const [name, value] of pending) fileFor(name).write(value);
  pending.clear();
}

/**
 * Zustand storage backed by JSON files in the document directory. Writes are
 * debounced so streaming tokens don't rewrite the whole history on every delta.
 */
const fileStorage: StateStorage = {
  getItem: (name) => {
    if (pending.has(name)) return pending.get(name)!;
    const file = fileFor(name);
    return file.exists ? file.textSync() : null;
  },
  setItem: (name, value) => {
    pending.set(name, value);
    timer ??= setTimeout(flush, 400);
  },
  removeItem: (name) => {
    pending.delete(name);
    const file = fileFor(name);
    if (file.exists) file.delete();
  },
};

export const jsonFileStorage = createJSONStorage(() => fileStorage);

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const keyName = (endpointId: string) => `apikey_${endpointId}`;

export const apiKeys = {
  get: (endpointId: string) => SecureStore.getItemAsync(keyName(endpointId)),
  set: (endpointId: string, key: string) =>
    key ? SecureStore.setItemAsync(keyName(endpointId), key) : SecureStore.deleteItemAsync(keyName(endpointId)),
  remove: (endpointId: string) => SecureStore.deleteItemAsync(keyName(endpointId)),
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
