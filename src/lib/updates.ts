import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * Updates come from the newest GitHub release that has an APK attached, tagged with the app
 * version it carries (`v1.2.0`, `1.2.0` or `v1.2.0-beta.1`), across all the repos below.
 * Pre-releases count only when asked for. Android only: iOS apps can't install themselves.
 */

// Both accounts publish releases; the old one is suspended for now, and answers 404 until it's back.
const REPOS = ['danielyongzx1/Clanker', 'DANIE4588E/Clanker'];
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

/**
 * A version's numeric parts and its pre-release tag (`beta.1` in `1.2.0-beta.1`), ignoring a
 * leading `v` and build metadata after a `+`.
 */
function parse(version: string) {
  const [core, pre = ''] = version.replace(/^v/i, '').split('+')[0].split(/-(.*)/);
  return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
}

/** Semver order: `1.2.0-beta.1` < `1.2.0-beta.2` < `1.2.0-rc.1` < `1.2.0`. */
export function isNewer(version: string, than: string) {
  const a = parse(version);
  const b = parse(than);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d > 0;
  }
  // Same numbers: the release itself beats any of its pre-releases.
  if (!a.pre.length || !b.pre.length) return !a.pre.length && !!b.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    // More identifiers sort later when the shared ones match.
    if (x === undefined || y === undefined) return y === undefined;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y);
    // Numbers sort before words.
    if (nx !== ny) return ny;
    return x > y;
  }
  return false;
}

type GitHubRelease = {
  tag_name: string;
  body: string | null;
  draft: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
};

function toRelease(json: GitHubRelease): Release | null {
  const apk = json.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
  if (!apk) return null;
  const version = json.tag_name.replace(/^v/i, '');
  return { version, notes: json.body ?? '', apkUrl: apk.browser_download_url, apkSize: apk.size };
}

/** A repo's candidate releases: the recent ones with prereleases, else only the latest stable one. */
async function fetchReleases(repo: string, prereleases: boolean, signal: AbortSignal): Promise<Release[]> {
  const url = `https://api.github.com/repos/${repo}/releases${prereleases ? '?per_page=30' : '/latest'}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal });
  // No stable release published yet, or the repo isn't there.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const json = await res.json();
  return (prereleases ? (json as GitHubRelease[]) : [json as GitHubRelease])
    .filter((r) => !r.draft)
    .map(toRelease)
    .filter((r): r is Release => !!r);
}

/**
 * The newest release across the repos when it is newer than this build, else null. A repo that
 * fails is skipped; the check only fails when every repo does.
 */
export async function fetchNewerRelease(prereleases = false): Promise<Release | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
  try {
    const results = await Promise.allSettled(REPOS.map((repo) => fetchReleases(repo, prereleases, controller.signal)));
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Release[]> => r.status === 'fulfilled');
    if (!fulfilled.length) {
      if (controller.signal.aborted) throw new Error("GitHub didn't answer in time.");
      throw (results[0] as PromiseRejectedResult).reason;
    }
    const newest = fulfilled
      .flatMap((r) => r.value)
      .reduce<Release | null>((best, r) => (!best || isNewer(r.version, best.version) ? r : best), null);
    return newest && isNewer(newest.version, currentVersion) ? newest : null;
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
