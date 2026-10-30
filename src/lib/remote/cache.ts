import { Directory, File, Paths } from 'expo-file-system';

export function remoteCache(id: string) {
  return new Directory(Paths.document, 'remote-files', id);
}

export function removeRemoteCache(id: string) {
  const dir = remoteCache(id);
  if (dir.exists) dir.delete();
}

export function cachedRemoteFile(chatId: string, version: string, name: string) {
  if (!/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid remote file version.');
  const dir = new Directory(remoteCache(chatId), version);
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'file');
}
