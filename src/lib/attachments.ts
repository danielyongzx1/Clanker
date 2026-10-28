import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { FilePart, ImagePart } from './providers';
import { uid } from './storage';
import { ensureWorkspace, fileAt, freePath } from './workspace';

// Anthropic recommends a long edge of at most 1568px; other providers downscale anyway.
const MAX_EDGE = 1568;
// Inline text cap for picked documents; beyond it the model gets the head plus a truncation note.
const MAX_TEXT_CHARS = 80_000;
// Binary files above this are rejected rather than ballooned to base64 into a request body.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

/** Copies an attachment into the agent workspace under its own name, returning the workspace path. */
export function saveToWorkspace(part: FilePart | ImagePart) {
  ensureWorkspace();
  const name = part.type === 'image' ? 'photo.jpg' : sanitize(part.name);
  const path = freePath(name);
  if (part.type === 'file' && part.text != null && !part.file) {
    fileAt(path).writeSync(part.text);
  } else if (part.file) {
    new File(dir, part.file).copySync(fileAt(path));
  }
  return path;
}

/**
 * Copies bytes into the attachments dir. NOT moveSync: content:// URIs from the document picker
 * cannot be moved or renamed, only read.
 */
async function storeFrom(sourceUri: string, name: string) {
  ensureDir();
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  try {
    await dest.write(await new File(sourceUri).bytes());
  } catch (e) {
    const scheme = sourceUri.split('://')[0];
    throw new Error(`Could not copy "${name}" (source: ${scheme}://): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Downscales an image into the attachments dir as JPEG; also used for images agent tools return. */
export async function importAsset(asset: { uri: string; width?: number; height?: number }): Promise<ImagePart> {
  let { width, height } = asset;
  if (!width || !height) {
    // The document picker and the workspace don't report dimensions; decode once to measure.
    const probe = await ImageManipulator.manipulate(asset.uri).renderAsync();
    ({ width, height } = probe);
    probe.release();
  }
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(width, height) > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE, height: null } : { width: null, height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const name = `${uid()}.jpg`;
  await storeFrom(saved.uri, name);
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

// Extensions whose contents are worth reading as plain text, whatever the system reports as MIME.
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ndjson|ya?ml|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|c|h|cc|cpp|hpp|java|kt|kts|swift|scala|sh|bash|zsh|fish|ps1|bat|sql|toml|ini|cfg|conf|env|log|tex|r|lua|pl|pm|php|dart|vue|svelte|graphql|prisma|proto|makefile|cmake|gitignore|editorconfig|dockerfile)$/i;
const TEXT_MIME = /^(application\/(json|xml|x-yaml|x-sh|x-httpd-php|x-empty-dir|x-toml|x-www-form-urlencoded)|text\/)/;

function isTextLike(name: string, mimeType?: string) {
  return TEXT_EXT.test(name) || (!!mimeType && TEXT_MIME.test(mimeType));
}

/** Keeps a name readable in the attachments dir without letting odd characters into paths. */
function sanitize(name: string) {
  const clean = name.replace(/[/\:*?"<>|]/g, '-').replace(/^\.+/, '').slice(-80);
  return clean || 'file';
}

function storedName(name: string) {
  const ext = (name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '').toLowerCase();
  return `${uid()}-${sanitize(name.replace(/\.[A-Za-z0-9]+$/, ''))}${ext}`;
}

/**
 * Picks documents (and any file type). Text-like files are read and inlined into the message;
 * images route through the same downscale pipeline as Photos; other binaries are copied into
 * the attachments dir and sent as base64 to providers that take them.
 */
export async function pickFiles(): Promise<(FilePart | ImagePart)[]> {
  // No cache copy: on Android expo-file-system rejected reads of the picker's cached file:// copy
  // with "Missing 'READ' permission", while the provider's content:// URI skips that path check and
  // is read through the content resolver. Everything below reads it immediately, so the temporary
  // grant the picker gives us is enough.
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map(async (asset): Promise<FilePart | ImagePart> => {
      const name = asset.name || 'file';
      const mimeType = asset.mimeType || 'application/octet-stream';

      if (mimeType.startsWith('image/')) {
        return importAsset({ uri: asset.uri });
      }

      if (isTextLike(name, mimeType)) {
        try {
          let text = await new File(asset.uri).text();
          // The inline copy can be truncated, so keep the original for the agent's workspace.
          let file: string | undefined;
          if (text.length > MAX_TEXT_CHARS) {
            text = text.slice(0, MAX_TEXT_CHARS) + '\n[…truncated]';
            if (!asset.size || asset.size <= MAX_FILE_BYTES) {
              file = storedName(name);
              await storeFrom(asset.uri, file);
            }
          }
          return { type: 'file', name, mimeType, text, size: asset.size, ...(file ? { file } : {}) };
        } catch {
          // Some pickers hand back a URI the text reader can't open; treat it as binary below.
        }
      }

      if (asset.size && asset.size > MAX_FILE_BYTES) {
        throw new Error(`"${name}" is larger than 20 MB.`);
      }
      const stored = storedName(name);
      await storeFrom(asset.uri, stored);
      return { type: 'file', file: stored, name, mimeType, size: asset.size };
    })
  );
}
