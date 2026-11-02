import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { AskSelection } from '../../modules/clanker-selection';

type Props = {
  text: string;
  visible: boolean;
  onClose: () => void;
  /** Takes text picked with "Ask Clanker"; the view closes after. */
  onAsk?: (text: string) => void;
};

/**
 * A message's whole text in one selectable block. In the chat each paragraph, list and code block
 * is its own text view, and Android can't carry a selection from one to the next.
 */
export function SelectText({ text, visible, onClose, onAsk }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const body = (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
      // Held text takes focus, and the scroll view would jump to bring all of it into view.
      scrollsChildToFocus={false}
    >
      <Text selectable style={[styles.text, { color: colors.text }]}>
        {text}
      </Text>
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && { opacity: 0.5 }]}
            accessibilityLabel="Close"
          >
            <Feather name="x" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Select text</Text>
        </View>
        {AskSelection && onAsk ? (
          <AskSelection
            style={styles.fill}
            onAsk={(e) => {
              onAsk(e.nativeEvent.text);
              onClose();
            }}
          >
            {body}
          </AskSelection>
        ) : (
          body
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingHorizontal: 12 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingTop: 8 },
  text: { fontSize: 16, lineHeight: 24 },
});
