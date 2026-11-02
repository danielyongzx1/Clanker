import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

const dataDir = new Directory(Paths.document, 'data');

function fileFor(name: string) {
  if (!dataDir.exists) dataDir.create({ intermediates: true });
  return new File(dataDir, `${name}.json`);
}

const WRITE_MS = 1000;

const pending = new Map<string, StorageValue<unknown>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [name, value] of pending) fileFor(name).write(JSON.stringify(value));
  pending.clear();
}

/** Persist a rate-limit reservation before its network request can start. */
export { flush as flushJsonStorage };

// The app may be killed once it leaves the foreground, so waiting writes go out then.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') flush();
});

/**
 * Zustand storage backed by JSON files in the document directory. Writes are throttled, and the
 * state is only serialized when it's written: serializing the whole history on every streamed
 * token was what slowed the app most while a reply streamed.
 */
export const jsonFileStorage: PersistStorage<any> = {
  getItem: (name) => {
    const value = pending.get(name);
    // A copy, since rehydrating may change the state it's given.
    if (value) return JSON.parse(JSON.stringify(value));
    const file = fileFor(name);
    return file.exists ? JSON.parse(file.textSync()) : null;
  },
  setItem: (name, value) => {
    pending.set(name, value);
    timer ??= setTimeout(flush, WRITE_MS);
  },
  removeItem: (name) => {
    pending.delete(name);
    const file = fileFor(name);
    if (file.exists) file.delete();
  },
};

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
