import { useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import { Keyboard } from 'react-native';
import { ChatScreen } from '@/components/ChatScreen';

/** The main chat screen, in the drawer with the chat history. */
export default function MainChatScreen() {
  const navigation = useNavigation<DrawerNavigationProp<Record<string, undefined>>>();
  return (
    <ChatScreen
      onMenu={() => {
        Keyboard.dismiss();
        navigation.openDrawer();
      }}
    />
  );
}
