import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { attachmentUri, deleteAttachment, pickImages } from '@/lib/attachments';
import { EffortMeter } from '@/components/EffortMeter';
import type { ImagePart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';

// The composer is a one-line pill while the keyboard is down and a two-row box (text above,
// toolbar below) while the keyboard is up. One progress value drives every dimension between
// the two. Expansion follows the keyboard, not input focus, so blurring the TextInput (tapping
// a toolbar button, switching focus) never shrinks the box while the keyboard is still showing.
const ROW = 52;
const BUTTON = 36;
const TOOLBAR_PAD = 8;
const COLLAPSED = { margin: 36, padLeft: TOOLBAR_PAD + BUTTON + 2, padRight: TOOLBAR_PAD + BUTTON + 8, padBottom: 0 };
const EXPANDED = { margin: 12, padLeft: 16, padRight: 16, padBottom: ROW - 6 };
const TWEEN = { duration: 280, easing: Easing.bezier(0.2, 0, 0, 1) };
const TOOLBAR_GAP = 4;

type Props = {
  text: string;
  onChangeText: (text: string) => void;
  streaming: boolean;
  onSend: (text: string, images: ImagePart[]) => void;
  onStop: () => void;
  /** Keeps the box expanded for exactly as long as the keyboard is on screen. */
  keyboardVisible: boolean;
  /** Shown when the selected model takes an effort level. */
  effort?: { levels: string[]; level: string; onPress: () => void };
};

export function Composer({ text, onChangeText, streaming, onSend, onStop, keyboardVisible, effort }: Props) {
  const { colors } = useTheme();
  const [images, setImages] = useState<ImagePart[]>([]);
  const [importing, setImporting] = useState(false);
  const canSend = !streaming && !importing && (text.trim().length > 0 || images.length > 0);
  const input = useRef<TextInputInstance>(null);
  const progress = useSharedValue(0);
  // Collapsed, the text runs up to the right-hand buttons, so leave room for the effort one too.
  const collapsedPadRight = COLLAPSED.padRight + (effort ? BUTTON + TOOLBAR_GAP : 0);

  // Expand for exactly as long as the keyboard is on screen. Driving this from the keyboard
  // rather than focus means tapping a toolbar button (which blurs the TextInput) keeps the box
  // big until the keyboard itself goes away.
  useEffect(() => {
    progress.value = withTiming(keyboardVisible ? 1 : 0, TWEEN);
  }, [keyboardVisible, progress]);

  // Dismissing the keyboard (back gesture, swipe) can leave the input focused on Android, so
  // blur it to make the next tap fire again. Collapse no longer depends on this — the keyboard
  // state drives it.
  useEffect(() => {
    const blur = () => input.current?.blur();
    const subs = [Keyboard.addListener('keyboardWillHide', blur), Keyboard.addListener('keyboardDidHide', blur)];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const boxStyle = useAnimatedStyle(() => ({
    marginHorizontal: interpolate(progress.value, [0, 1], [COLLAPSED.margin, EXPANDED.margin]),
    paddingBottom: interpolate(progress.value, [0, 1], [COLLAPSED.padBottom, EXPANDED.padBottom]),
  }));
  const inputStyle = useAnimatedStyle(() => ({
    paddingLeft: interpolate(progress.value, [0, 1], [COLLAPSED.padLeft, EXPANDED.padLeft]),
    paddingRight: interpolate(progress.value, [0, 1], [collapsedPadRight, EXPANDED.padRight]),
  }));

  const attach = async (source: 'library' | 'camera') => {
    setImporting(true);
    try {
      const picked = await pickImages(source);
      setImages((prev) => [...prev, ...picked]);
    } catch (e) {
      Alert.alert('Could not attach image', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const openAttachMenu = () =>
    Alert.alert('Attach', undefined, [
      { text: 'Camera', onPress: () => attach('camera') },
      { text: 'Photos', onPress: () => attach('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const removeImage = (file: string) => {
    deleteAttachment(file);
    setImages((prev) => prev.filter((img) => img.file !== file));
  };

  const send = () => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(text.trim(), images);
    setImages([]);
  };

  return (
    <Animated.View style={[styles.box, { backgroundColor: colors.composer }, boxStyle]}>
      {(images.length > 0 || importing) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {images.map((img) => (
            <View key={img.file}>
              <Image source={{ uri: attachmentUri(img.file) }} style={styles.thumb} contentFit="cover" />
              <Pressable
                onPress={() => removeImage(img.file)}
                hitSlop={8}
                style={[styles.remove, { backgroundColor: colors.text }]}
              >
                <Feather name="x" size={12} color={colors.background} />
              </Pressable>
            </View>
          ))}
          {importing && (
            <View style={[styles.thumb, styles.loading, { backgroundColor: colors.surface }]}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          )}
        </ScrollView>
      )}

      <Animated.View style={inputStyle}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={onChangeText}
          placeholder="Ask anything"
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[styles.input, { color: colors.text }]}
        />
      </Animated.View>

      {/* Pinned to the bottom row: beside the text when collapsed, below it when expanded. */}
      <View style={styles.toolbar} pointerEvents="box-none">
        <Pressable
          onPress={openAttachMenu}
          hitSlop={6}
          style={({ pressed }) => [styles.circle, pressed && { opacity: 0.5 }]}
          accessibilityLabel="Attach"
        >
          <Feather name="plus" size={24} color={colors.text} />
        </Pressable>

        <View style={styles.trailing}>
          {effort && (
            <Pressable
              onPress={effort.onPress}
              hitSlop={6}
              style={({ pressed }) => [styles.circle, pressed && { opacity: 0.5 }]}
              accessibilityLabel={`Effort: ${effort.level}`}
            >
              <EffortMeter levels={effort.levels} level={effort.level} />
            </Pressable>
          )}
          {streaming ? (
            <Pressable
              onPress={onStop}
              hitSlop={6}
              style={[styles.circle, { backgroundColor: colors.accent }]}
              accessibilityLabel="Stop"
            >
              <View style={[styles.stop, { backgroundColor: colors.accentFg }]} />
            </Pressable>
          ) : (
            <Pressable
              onPress={send}
              disabled={!canSend}
              hitSlop={6}
              style={[styles.circle, { backgroundColor: colors.accent }, !canSend && { opacity: 0.45 }]}
              accessibilityLabel="Send"
            >
              <Feather name="arrow-up" size={20} color={colors.accentFg} />
            </Pressable>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: ROW / 2, overflow: 'hidden' },
  thumbs: { gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 2 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: 17,
    lineHeight: 22,
    minHeight: ROW,
    maxHeight: 160,
    paddingHorizontal: 0,
    paddingVertical: (ROW - 22) / 2,
    textAlignVertical: 'top',
  },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: ROW,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: TOOLBAR_PAD,
  },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: TOOLBAR_GAP },
  circle: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
  stop: { width: 12, height: 12, borderRadius: 2 },
});
