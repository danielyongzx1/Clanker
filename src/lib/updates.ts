import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * Updates come from the newest stable GitHub release that has an APK attached, tagged with the
 * app version it carries (`v1.2.0` or `1.2.0`). Android only: iOS apps can't install themselves.
 */

const REPO = 'DANIE4588E/Clanker';
const CHECK_TIMEOUT = 15_000;
const APK_TYPE = 'application/vnd.android.package-archive';
// Intent.FLAG_GRANT_READ_URI_PERMISSION, so the installer can read the APK through the content URI.
const GRANT_READ = 1;

export const updatesSupported = Platform.OS === 'android';

export const currentVersion = Constants.expoConfig?.version ?? '0.0.0';

export type Release = {
  version: string;
  /** Release notes, as written on GitHub (Markdown). */
  notes: string;
  apkUrl: string;
  /** In bytes, for progress when the download doesn't report its length. */
  apkSize: number;
};

/** Numeric parts of a version, ignoring a leading `v` and anything after a `-` or `+`. */
const parts = (version: string) =>
  version
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

export function isNewer(version: string, than: string) {
  const a = parts(version);
  const b = parts(than);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** The latest release when it is newer than this build, else null. */
export async function fetchNewerRelease(): Promise<Release | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    // No stable release published yet.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const json = await res.json();
    const apk = (json.assets as { name: string; browser_download_url: string; size: number }[]).find((a) =>
      a.name.toLowerCase().endsWith('.apk')
    );
    const version = String(json.tag_name).replace(/^v/i, '');
    if (!apk || !isNewer(version, currentVersion)) return null;
    return { version, notes: json.body ?? '', apkUrl: apk.browser_download_url, apkSize: apk.size };
  } catch (e) {
    if (controller.signal.aborted) throw new Error("GitHub didn't answer in time.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads the release's APK to the cache, replacing any earlier download. */
export async function downloadRelease(release: Release, onProgress: (fraction: number) => void, signal: AbortSignal) {
  const dir = new Directory(Paths.cache, 'updates');
  if (dir.exists) dir.delete();
  dir.create();
  return File.downloadFileAsync(release.apkUrl, new File(dir, `clanker-${release.version}.apk`), {
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : release.apkSize;
      if (total > 0) onProgress(Math.min(1, bytesWritten / total));
    },
  });
}

/**
 * Hands the APK to the system installer, which asks the user to allow installs from Clanker the
 * first time. Resolves when they come back, unless the update replaced the running app.
 */
export async function installApk(file: File) {
  if (!file.exists) throw new Error('The download is gone. Download the update again.');
  await startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: APK_TYPE, flags: GRANT_READ });
}
