import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { Input, Row } from './Form';
import { adapterForChat, resumeRemoteChat } from '@/lib/remote/chat';
import { type RemoteControl, type RemoteFile, type RemoteReply as Reply } from '@/lib/remote/types';
import { useChats } from '@/store/chats';
import { useTheme } from '@/lib/theme';

function Control({ chatId, control }: { chatId: string; control: RemoteControl }) {
  const { colors } = useTheme();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const respond = async (value: string) => {
    const runId = useChats.getState().conversations[chatId]?.remote?.runId;
    if (!runId) return;
    setBusy(true);
    try { await adapterForChat(chatId).respond(runId, control.id, value); void resumeRemoteChat(chatId); }
    catch (error) { Alert.alert('Could not answer', error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14 }}>
      <Text selectable style={{ color: colors.text }}>{control.prompt}</Text>
      {control.kind === 'clarification' && <Input multiline placeholder="Your answer" value={answer} onChangeText={setAnswer} />}
      <View style={{ flexDirection: 'row', gap: 24 }}>
        {[...(control.choices ?? []), ...(control.kind === 'clarification' ? ['Send answer'] : [])].map((choice) => <Pressable key={choice} disabled={busy || (choice === 'Send answer' && !answer.trim())} onPress={() => void respond(choice === 'Send answer' ? answer : choice)} accessibilityRole="button"><Text style={{ color: colors.link }}>{busy ? 'Sending…' : choice === 'once' ? 'Allow once' : choice === 'deny' ? 'Deny' : choice}</Text></Pressable>)}
      </View>
    </View>
  );
}

export function RemoteFileRows({ chatId, files }: { chatId: string; files: RemoteFile[] }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (artifact: RemoteFile) => {
    const sessionId = useChats.getState().conversations[chatId]?.remote?.sessionId;
    if (!sessionId || busy) return;
    setBusy(artifact.id);
    try {
      const file = await adapterForChat(chatId).download(chatId, sessionId, artifact);
      try { if (await file.canPreview()) { await file.preview({ title: artifact.name }); return; } } catch {}
      await Sharing.shareAsync(file.uri, { dialogTitle: artifact.name });
    } catch (error) { Alert.alert('Could not open remote file', error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };
  return <View>{files.map((file) => <Row key={`${file.id}_${file.version}`} icon="file" title={file.name} detail={busy === file.id ? 'Downloading…' : `${file.path} · ${(file.size / 1024).toFixed(1)} KB`} disabled={!!busy} onPress={() => void download(file)} />)}{!files.length && <Text style={{ color: colors.textSecondary, padding: 12 }}>No files yet.</Text>}</View>;
}

export function RemoteReply({ chatId, reply, reconnect }: { chatId: string; reply?: Reply; reconnect?: boolean }) {
  const { colors } = useTheme();
  const acknowledge = () => Alert.alert('Confirm the task has stopped', 'Check the host device and stop any task from this turn first. This marks the uncertain turn as interrupted; it does not run it again.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'I checked; it has stopped', onPress: () => {
      const runId = useChats.getState().conversations[chatId]?.remote?.runId;
      if (runId) void adapterForChat(chatId).acknowledge(runId).then(() => resumeRemoteChat(chatId)).catch((error) => Alert.alert('Could not acknowledge', String(error)));
    } },
  ]);
  return <View style={{ gap: 12 }}>
    {reply?.state === 'stopping' && <Text style={{ color: colors.textSecondary }}>Stopping on the remote device…</Text>}
    {reply?.state === 'unknown' && <Text style={{ color: colors.textSecondary }}>Execution outcome is unknown. Check the host before continuing.</Text>}
    {reply?.state === 'unknown' && <Pressable onPress={acknowledge} accessibilityRole="button"><Text style={{ color: colors.link }}>I stopped this task on the host</Text></Pressable>}
    {reply?.controls.map((control) => <Control key={control.id} chatId={chatId} control={control} />)}
    {!!reply?.files.length && <RemoteFileRows chatId={chatId} files={reply.files} />}
    {reconnect && <Pressable onPress={() => void resumeRemoteChat(chatId)} accessibilityRole="button"><Text style={{ color: colors.link }}>Reconnect to this turn</Text></Pressable>}
  </View>;
}

export function RemoteFilesButton({ chatId }: { chatId: string }) {
  const { colors } = useTheme();
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const show = async () => {
    const sessionId = useChats.getState().conversations[chatId]?.remote?.sessionId;
    if (!sessionId) { setFiles([]); return; }
    try { setFiles(await adapterForChat(chatId).files(sessionId)); }
    catch (error) { Alert.alert('Could not list remote files', error instanceof Error ? error.message : String(error)); }
  };
  return <>
    <Pressable onPress={() => void show()} accessibilityRole="button" style={{ padding: 8 }}><Text style={{ color: colors.link }}>Remote files</Text></Pressable>
    <Modal visible={files !== null} onRequestClose={() => setFiles(null)} animationType="slide">
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 64, paddingHorizontal: 20 }}>
        <Row title="Remote files" value="Done" onPress={() => setFiles(null)} />
        <RemoteFileRows chatId={chatId} files={files ?? []} />
      </ScrollView>
    </Modal>
  </>;
}
