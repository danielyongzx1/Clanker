import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { ImagePart } from './providers';
import { uid } from './storage';

// Anthropic recommends a long edge of at most 1568px; other providers downscale anyway.
const MAX_EDGE = 1568;

const dir = new Directory(Paths.document, 'attachments');

function ensureDir() {
  if (!dir.exists) dir.create({ intermediates: true });
}

/** Only the file name is stored, because the document path can change between app updates on iOS. */
export function attachmentUri(file: string) {
  return new File(dir, file).uri;
}

export function readAttachmentBase64(file: string) {
  return new File(dir, file).base64();
}

export function deleteAttachment(file: string) {
  const f = new File(dir, file);
  if (f.exists) f.delete();
}

async function importAsset(asset: ImagePicker.ImagePickerAsset): Promise<ImagePart> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE, height: null } : { width: null, height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  ensureDir();
  const name = `${uid()}.jpg`;
  new File(saved.uri).moveSync(new File(dir, name));
  return { type: 'image', file: name, mimeType: 'image/jpeg', width: saved.width, height: saved.height };
}

export async function pickImages(source: 'library' | 'camera'): Promise<ImagePart[]> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(`Permission to access your ${source === 'camera' ? 'camera' : 'photos'} was denied.`);

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: 4 });
  if (result.canceled) return [];
  return Promise.all(result.assets.map(importAsset));
}
