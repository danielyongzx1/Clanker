import Feather from '@expo/vector-icons/Feather';
import * as Haptics from '@/lib/haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { ActivityIndicator, Alert, Dimensions, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type HostInstance, type TextInputInstance } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, withTiming, type SharedValue } from 'react-native-reanimated';
import { AttachmentMenu, type AttachAction } from '@/components/AttachmentMenu';
import { attachmentUri, deleteAttachment, pickFiles, pickImages } from '@/lib/attachments';
import { ContextMeter, ContextPopover } from '@/components/ContextUsage';
import { EffortMeter } from '@/components/EffortMeter';
import { FileIcon } from '@/components/FileIcon';
import type { AttachmentPart, FilePart, ImagePart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import type { ContextUsage } from '@/lib/usage';

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
// Tap target around the context meter; it only takes room in the toolbar while expanded.
const METER = 16;

/** How much taller the box stands at a given progress than it does collapsed. */
export function composerGrowth(progress: number) {
  'worklet';
  return interpolate(progress, [0, 1], [0, EXPANDED.padBottom - COLLAPSED.padBottom]);
}

/** The box's distance from either side of the screen at a given progress. */
export function composerMargin(progress: number) {
  'worklet';
  return interpolate(progress, [0, 1], [COLLAPSED.margin, EXPANDED.margin]);
}

type Props = {
  text: string;
  onChangeText: (text: string) => void;
  /** Text picked from the chat to ask about, shown as pills above the text. */
  quotes: string[];
  onRemoveQuote: (index: number) => void;
  /** Held by the dock, so a queued message can be brought back here to edit. */
  attachments: AttachmentPart[];
  onChangeAttachments: Dispatch<SetStateAction<AttachmentPart[]>>;
  placeholder: string;
  inputRef: RefObject<TextInputInstance | null>;
  /** While a reply streams, Stop shows beside Send, or alone when there's nothing to send. */
  streaming: boolean;
  onSend: (text: string, attachments: AttachmentPart[]) => void;
  onStop: () => void;
  /** Keeps the box expanded for exactly as long as the keyboard is on screen. */
  keyboardVisible: boolean;
  /** Shown when the selected model takes an effort level. */
  effort?: { levels: string[]; level: string; onPress: () => void };
  /** Shown beside the effort gauge while expanded, when context usage is turned on. */
  context?: ContextUsage | null;
  /** Expansion, 0 collapsed to 1 expanded. The composer drives it; the screen reads it so the
   *  conversation's inset can follow the box's growth on the UI thread. */
  progress: SharedValue<number>;
};

export function Composer({
  text,
  onChangeText,
  quotes,
  onRemoveQuote,
  attachments,
  onChangeAttachments: setAttachments,
  placeholder,
  inputRef: input,
  streaming,
  onSend,
  onStop,
  keyboardVisible,
  effort,
  context,
  progress,
}: Props) {
  const { colors } = useTheme();
  const [importing, setImporting] = useState(false);
  const images = attachments.filter((a): a is ImagePart => a.type === 'image');
  const files = attachments.filter((a): a is FilePart => a.type === 'file');
  const canSend = !importing && (text.trim().length > 0 || attachments.length > 0 || quotes.length > 0);
  // While a reply streams, sending queues or steers, and Stop stays beside Send.
  const bothButtons = streaming && canSend;
  // A zero-impact overlay inside the box that we can measure (Animated.View refs are awkwardly
  // typed); its window position is the box's content top-left.
  const box = useRef<HostInstance>(null);

  // Popovers: the attach menu hangs off the box's top-left corner and the context breakdown off
  // its top-right, measured at open time so they track the box wherever the keyboard pushed it.
  const [popover, setPopover] = useState<'attach' | 'context' | null>(null);
  const [anchor, setAnchor] = useState({ x: TOOLBAR_PAD + 8, right: COLLAPSED.margin, bottom: 96 });
  // Collapsed, the text runs up to the right-hand buttons, so leave room for the effort one too.
  const collapsedPadRight =
    COLLAPSED.padRight + (effort ? BUTTON + TOOLBAR_GAP : 0) + (bothButtons ? BUTTON + TOOLBAR_GAP : 0);

  // Expand for exactly as long as the keyboard is on screen. Driving this from the keyboard
  // rather than focus means tapping a toolbar button (which blurs the TextInput) keeps the box
  // big until the keyboard itself goes away.
  useEffect(() => {
    progress.set(withTiming(keyboardVisible ? 1 : 0, TWEEN));
  }, [keyboardVisible, progress]);

  // Dismissing the keyboard (back gesture, swipe) can leave the input focused on Android, so
  // blur it to make the next tap fire again. Collapse no longer depends on this — the keyboard
  // state drives it.
  useEffect(() => {
    const blur = () => input.current?.blur();
    const subs = [Keyboard.addListener('keyboardWillHide', blur), Keyboard.addListener('keyboardDidHide', blur)];
    return () => subs.forEach((s) => s.remove());
  }, [input]);

  const boxStyle = useAnimatedStyle(() => ({
    marginHorizontal: composerMargin(progress.value),
    paddingBottom: COLLAPSED.padBottom + composerGrowth(progress.value),
  }));
  const inputStyle = useAnimatedStyle(() => ({
    paddingLeft: interpolate(progress.value, [0, 1], [COLLAPSED.padLeft, EXPANDED.padLeft]),
    paddingRight: interpolate(progress.value, [0, 1], [collapsedPadRight, EXPANDED.padRight]),
  }));
  // The meter grows in with the expanded toolbar; collapsed, it takes no room (its gap included).
  const meterStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [0, METER]),
    marginRight: interpolate(progress.value, [0, 1], [-TOOLBAR_GAP, 0]),
    opacity: progress.value,
  }));

  const attach = async (source: AttachAction) => {
    setPopover(null);
    setImporting(true);
    try {
      const picked =
        source === 'files' ? await pickFiles() : await pickImages(source === 'camera' ? 'camera' : 'library');
      setAttachments((prev) => [...prev, ...picked]);
    } catch (e) {
      Alert.alert('Could not attach', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  // Popovers float above the box, anchored where it measures to sit. They live in an
  // over-keyboard layer, so opening one with the keyboard up leaves the keyboard right where
  // it is (a plain Modal would take focus and close it, and dismissing made the box collapse
  // out from under the menu).
  const openPopover = (which: 'attach' | 'context') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    box.current?.measureInWindow((x, y, width) => {
      const window = Dimensions.get('window');
      setAnchor({ x: x + TOOLBAR_PAD, right: window.width - x - width, bottom: window.height - y + 8 });
      setPopover(which);
    });
  };

  const removeAttachment = (a: AttachmentPart) => {
    if (a.type === 'image' && a.file) deleteAttachment(a.file);
    if (a.type === 'file' && a.file) deleteAttachment(a.file);
    setAttachments((prev) => prev.filter((x) => x !== a));
  };

  const send = () => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(text.trim(), attachments);
    setAttachments([]);
  };

  return (
    <>
      <AttachmentMenu
        visible={popover === 'attach'}
        x={anchor.x}
        bottom={anchor.bottom}
        onPick={attach}
        onClose={() => setPopover(null)}
      />
      {context && (
        <ContextPopover
          visible={popover === 'context'}
          usage={context}
          right={anchor.right}
          bottom={anchor.bottom}
          onClose={() => setPopover(null)}
        />
      )}
      <Animated.View ref={box} style={[styles.box, { backgroundColor: colors.composer }, boxStyle]}>
        {(attachments.length > 0 || quotes.length > 0 || importing) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
            {quotes.map((q, i) => (
              <View key={`${i}-${q}`} style={[styles.quote, { backgroundColor: colors.surface }]}>
                <Feather name="corner-down-right" size={14} color={colors.textSecondary} />
                <Text numberOfLines={1} style={[styles.quoteText, { color: colors.text }]}>
                  {q.replace(/\s+/g, ' ')}
                </Text>
                <Pressable
                  onPress={() => onRemoveQuote(i)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && { opacity: 0.5 }}
                  accessibilityLabel="Remove quote"
                >
                  <Feather name="x" size={15} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))}
            {images.map((img) => (
              <View key={img.file}>
                <Image source={{ uri: attachmentUri(img.file) }} style={styles.thumb} contentFit="cover" />
                <Pressable
                  onPress={() => removeAttachment(img)}
                  hitSlop={8}
                  style={[styles.remove, { backgroundColor: colors.text }]}
                >
                  <Feather name="x" size={12} color={colors.background} />
                </Pressable>
              </View>
            ))}
            {files.map((f, i) => (
              <View key={`${f.file ?? f.name}-${i}`} style={[styles.fileChip, { backgroundColor: colors.surface }]}>
                <FileIcon name={f.name} uri={f.file ? attachmentUri(f.file) : undefined} size={26} />
                <Text numberOfLines={1} style={[styles.fileChipName, { color: colors.text }]}>
                  {f.name}
                </Text>
                <Pressable
                  onPress={() => removeAttachment(f)}
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
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[styles.input, { color: colors.text }]}
        />
      </Animated.View>

      {/* Pinned to the bottom row: beside the text when collapsed, below it when expanded. */}
      <View style={styles.toolbar} pointerEvents="box-none">
        <Pressable
          onPress={() => openPopover('attach')}
          hitSlop={6}
          style={({ pressed }) => [styles.circle, pressed && { opacity: 0.5 }]}
          accessibilityLabel="Attach"
        >
          <Feather name="plus" size={24} color={colors.text} />
        </Pressable>

        <View style={styles.trailing}>
          {context && (
            <Animated.View style={[styles.meterSlot, meterStyle]} pointerEvents={keyboardVisible ? 'auto' : 'none'}>
              <Pressable
                onPress={() => openPopover('context')}
                hitSlop={{ top: 8, bottom: 8, left: 10, right: 6 }}
                style={({ pressed }) => [styles.meterButton, pressed && { opacity: 0.5 }]}
                accessibilityLabel={`Context: ${Math.round(
                  ((context.system + context.tools + context.messages) / context.budget) * 100
                )}% used`}
              >
                <ContextMeter usage={context} />
              </Pressable>
            </Animated.View>
          )}
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
          {streaming && (
            <Pressable
              onPress={onStop}
              hitSlop={6}
              style={({ pressed }) => [
                styles.circle,
                !bothButtons && { backgroundColor: colors.accent },
                bothButtons && pressed && { opacity: 0.5 },
              ]}
              accessibilityLabel="Stop"
            >
              <View style={[styles.stop, { backgroundColor: bothButtons ? colors.text : colors.accentFg }]} />
            </Pressable>
          )}
          {(!streaming || bothButtons) && (
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
    </>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: ROW / 2, overflow: 'hidden' },
  thumbs: { gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 2 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    maxWidth: 180,
    borderRadius: 20,
    paddingLeft: 7,
    paddingRight: 14,
  },
  fileChipName: { fontSize: 14, flexShrink: 1 },
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    height: 32,
    maxWidth: 220,
    borderRadius: 16,
    paddingLeft: 10,
    paddingRight: 9,
  },
  quoteText: { fontSize: 14, flexShrink: 1 },
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
  meterSlot: { height: BUTTON, overflow: 'hidden' },
  meterButton: { width: METER, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  circle: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
  stop: { width: 12, height: 12, borderRadius: 2 },
});
