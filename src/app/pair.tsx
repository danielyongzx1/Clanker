import { Redirect, useLocalSearchParams } from 'expo-router';
import { pairingFromParams } from '@/lib/remote/pairing';
import { useBackends } from '@/store/backends';

/**
 * Where a clanker://pair link lands when the phone's camera opens a bridge's QR code. The backend
 * editor checks and tests it; a bridge that's already saved opens as that backend, keeping its chats.
 */
export default function PairScreen() {
  const params = useLocalSearchParams();
  const bridgeId = pairingFromParams(params)?.bridgeId;
  const saved = useBackends((s) => (bridgeId ? s.remotes.find((b) => b.bridgeId === bridgeId) : undefined));
  return (
    <Redirect
      href={{ pathname: '/settings/backend', params: { ...(saved ? { id: saved.id } : {}), pair: JSON.stringify(params) } }}
    />
  );
}
