import { router, useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '@/components/ChatScreen';
import { useChatLayer } from '@/lib/useChatLayer';

/** A chat in a project (`chat` unset: a new one), over the project page; back returns to it. */
export default function ProjectChatScreen() {
  const { project, chat } = useLocalSearchParams<{ project: string; chat?: string }>();
  useChatLayer({ currentId: chat || null, newChatProjectId: chat ? null : project });
  return <ChatScreen onBack={() => router.back()} />;
}
