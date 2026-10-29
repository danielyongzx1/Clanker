import { useEffect } from 'react';
import { currentVersion, updatesSupported, type Release } from '@/lib/updates';
import { useUpdates } from '@/store/updates';
import { confirm, notify } from './Dialogs';
import { Row } from './Form';

const DAY = 24 * 60 * 60 * 1000;
// Leaves startup to the chat screen before asking GitHub.
const LAUNCH_DELAY = 3000;
const NOTES_MAX = 400;

function notesPreview(notes: string) {
  const text = notes.trim();
  return text.length <= NOTES_MAX ? text : `${text.slice(0, NOTES_MAX).trimEnd()} …`;
}

export function offerUpdate(release: Release) {
  const size = release.apkSize ? `The download is ${(release.apkSize / 1e6).toFixed(0)} MB.` : '';
  confirm({
    title: `Clanker ${release.version} is available`,
    message: [notesPreview(release.notes), size].filter(Boolean).join('\n\n'),
    confirmLabel: 'Download',
    onConfirm: () => useUpdates.getState().download(release),
  });
}

/** Asks GitHub now, offering the update if there is one. */
export async function checkForUpdates() {
  try {
    const release = await useUpdates.getState().check();
    if (release) offerUpdate(release);
  } catch (e) {
    notify("Couldn't check for updates", e instanceof Error ? e.message : String(e));
  }
}

/** The Settings row: checks, then shows the update through download and install. */
export function UpdateRow() {
  const status = useUpdates((s) => s.status);
  const { download, install, cancelDownload } = useUpdates.getState();

  switch (status.phase) {
    case 'checking':
      return <Row icon="refresh-cw" title="Checking for updates" value="…" />;
    case 'available':
      return (
        <Row icon="download" title={`Download Clanker ${status.release.version}`} tint="link" onPress={() => offerUpdate(status.release)} />
      );
    case 'downloading':
      return (
        <Row
          icon="download"
          title={`Downloading Clanker ${status.release.version}`}
          detail="Tap to stop"
          value={`${Math.round(status.progress * 100)}%`}
          onPress={() =>
            confirm({ title: 'Stop downloading?', confirmLabel: 'Stop', destructive: true, onConfirm: cancelDownload })
          }
        />
      );
    case 'ready':
      return <Row icon="package" title={`Install Clanker ${status.release.version}`} tint="link" onPress={install} />;
    case 'failed': {
      const { release } = status;
      return (
        <Row
          icon="alert-circle"
          title={release ? `Couldn't update to ${release.version}` : "Couldn't check for updates"}
          detail={`${status.error.replace(/\.?$/, '.')} Tap to try again.`}
          onPress={() => (release ? download(release) : checkForUpdates())}
        />
      );
    }
    default:
      return (
        <Row
          icon="refresh-cw"
          title="Check for updates"
          detail={status.phase === 'current' ? `Clanker ${currentVersion} is the latest version` : undefined}
          onPress={checkForUpdates}
        />
      );
  }
}

/** Mount once, at the root: checks on launch, at most once a day, and only speaks up when there's an update. */
export function UpdateCheck() {
  useEffect(() => {
    // Development builds carry whatever version app.json has, so every release would look newer.
    if (!updatesSupported || __DEV__) return;
    if (Date.now() - useUpdates.getState().lastCheck < DAY) return;
    const timer = setTimeout(() => {
      useUpdates
        .getState()
        .check()
        .then(
          (release) => release && offerUpdate(release),
          // Offline at launch, say; the Settings row shouldn't show an error nobody asked about.
          () => useUpdates.setState({ status: { phase: 'idle' } })
        );
    }, LAUNCH_DELAY);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
