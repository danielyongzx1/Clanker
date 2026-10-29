import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { attachmentUri } from '@/lib/attachments';
import type { ContentPart, FilePart, ImagePart, ToolPart } from '@/lib/providers';
import { sitesOf, sourcesOf } from '@/lib/sources';
import { useTheme } from '@/lib/theme';
import { messageText, type Message } from '@/store/chats';
import { Markdown } from './Markdown';
import { SiteChips, SourcesButton } from './Sources';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ToolCall } from './ToolCall';

type Props = {
  message: Message;
  isLast: boolean;
  onRegenerate: (messageId: string) => void;
};

function Files({ files, align }: { files: FilePart[]; align: 'flex-end' | 'flex-start' }) {
  const { colors } = useTheme();
  if (!files.length) return null;
  return (
    <View style={[styles.images, { justifyContent: align }]}>
      {files.map((f, i) => (
        <View
          key={`${f.file ?? f.name}-${i}`}
          style={[styles.fileChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Feather name="paperclip" size={15} color={colors.textSecondary} />
          <Text numberOfLines={1} style={[styles.fileName, { color: colors.text }]}>
            {f.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Images({ images, align }: { images: ImagePart[]; align: 'flex-end' | 'flex-start' }) {
  if (!images.length) return null;
  const size = images.length === 1 ? 220 : 120;
  return (
    <View style={[styles.images, { justifyContent: align }]}>
      {images.map((img) => (
        <Image
          key={img.file}
          source={{ uri: attachmentUri(img.file) }}
          style={{
            width: size,
            height: img.width && img.height && images.length === 1 ? Math.min(size * (img.height / img.width), 320) : size,
            borderRadius: 16,
          }}
          contentFit="cover"
        />
      ))}
    </View>
  );
}

type Segment =
  | { kind: 'text'; text: string; at?: number }
  | { kind: 'tool'; part: ToolPart }
  | { kind: 'thought'; text: string; ms?: number };

/** Runs of text merged into one markdown block, with thoughts and tool calls between them, in reply order. */
function segmentsOf(message: Message): Segment[] {
  // Replies saved before thoughts were content parts keep theirs in one block at the top.
  const out: Segment[] = message.reasoning ? [{ kind: 'thought', text: message.reasoning, ms: message.thoughtMs }] : [];
  for (const part of message.content) {
    const last = out[out.length - 1];
    if (part.type === 'text') {
      if (last?.kind === 'text') last.text += part.text;
      else out.push({ kind: 'text', text: part.text, at: part.at });
    } else if (part.type === 'tool') out.push({ kind: 'tool', part });
    else if (part.type === 'thought') out.push({ kind: 'thought', text: part.text, ms: part.ms });
  }
  return out;
}

// While a reply streams, text after its last tool call may be the answer or a note before the next
// call; there is no telling until the response ends. Notes are a sentence or two, so the work folds
// away once the text runs past this, and otherwise when the reply finishes.
const ANSWER_CHARS = 240;

/**
 * Splits a reply that used tools into the work (thoughts, tool calls and notes, up to the last
 * thought or call) and the answer after it. Replies without tool calls aren't split.
 */
function splitWork(segments: Segment[]) {
  const end = segments.findLastIndex((s) => s.kind !== 'text');
  const work = segments.slice(0, end + 1);
  if (!work.some((s) => s.kind === 'tool')) return null;
  const answer = segments.slice(end + 1) as Extract<Segment, { kind: 'text' }>[];
  return { work, answer, text: answer.map((s) => s.text).join('').trim(), at: answer[0]?.at };
}

function duration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The work behind an answer under a "Worked for Ns" header, open while it happens and folded once the answer comes. */
function Work({
  segments,
  folded,
  live,
  ms,
  render,
  content,
}: {
  segments: Segment[];
  /** Whether the work is done and the answer is on its way, which folds it unless the user opened it. */
  folded: boolean;
  live: boolean;
  ms: number;
  render: (seg: Segment, i: number) => ReactNode;
  content: ContentPart[];
}) {
  const { colors } = useTheme();
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? !folded;
  const { sites, searched } = useMemo(() => sitesOf(content), [content]);
  const label = live && !folded ? 'Working…' : `Worked for ${duration(ms)}`;
  return (
    <>
      <Pressable
        onPress={() => setOpenOverride(!open)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${open ? 'hide' : 'show'} steps`}
        style={({ pressed }) => [styles.workHeader, pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.workLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Feather
          name="chevron-down"
          size={14}
          color={colors.textSecondary}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {/* Under the header rather than after the steps: a note the model writes before its next
          call shows after the steps and joins them when the call lands, which would push the
          sites down on every round. */}
      <SiteChips sites={sites} searched={searched} />
      {open && segments.map(render)}
    </>
  );
}

/** One stretch of the model's thinking: a "Thought for Ns" pill that shows or hides the text. */
function Thoughts({ text, ms, live }: { text: string; ms?: number; live: boolean }) {
  const { colors } = useTheme();
  // Expanded while it streams; a tap pins the choice either way.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? live;
  // The box is capped in height, so while thoughts stream it follows their end, until the user
  // drags it to read back; dragging back down to the end picks the following up again.
  const scroll = useRef<ScrollViewInstance>(null);
  const follow = useRef(true);
  const settle = ({ nativeEvent: e }: NativeSyntheticEvent<NativeScrollEvent>) => {
    follow.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 24;
  };
  return (
    <>
      <ThinkingIndicator
        thinking={live}
        expanded={open}
        toggleable
        thoughtMs={ms}
        onToggle={() => setOpenOverride(!open)}
      />
      {open && (
        <ScrollView
          ref={scroll}
          style={styles.thoughts}
          nestedScrollEnabled
          onContentSizeChange={() => live && follow.current && scroll.current?.scrollToEnd({ animated: false })}
          onScrollBeginDrag={() => (follow.current = false)}
          onScrollEndDrag={settle}
          onMomentumScrollEnd={settle}
        >
          <View style={[styles.thoughtsInner, { borderLeftColor: colors.border }]}>
            <Text selectable style={[styles.thoughtsText, { color: colors.textSecondary }]}>
              {text}
            </Text>
          </View>
        </ScrollView>
      )}
    </>
  );
}

function MessageBubbleInner({ message, isLast, onRegenerate }: Props) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const images = message.content.filter((p): p is ImagePart => p.type === 'image');
  const files = message.content.filter((p): p is FilePart => p.type === 'file');

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <Images images={images} align="flex-end" />
        <Files files={files} align="flex-end" />
        {!!text && (
          <Pressable onLongPress={copy} style={[styles.userBubble, { backgroundColor: colors.userBubble }]}>
            <Text selectable style={[styles.userText, { color: colors.text }]}>
              {text}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  const streaming = message.status === 'streaming';
  const segments = segmentsOf(message);
  const lastSeg = segments[segments.length - 1];
  // A bare pulsing pill while the model is working with nothing streaming yet: before its first
  // token, and while it works out its next step after a round of tool calls. Streamed thoughts
  // pulse in their own pill instead.
  const waiting =
    streaming && (!lastSeg || (lastSeg.kind === 'tool' && (lastSeg.part.status === 'done' || lastSeg.part.status === 'error')));
  const split = splitWork(segments);
  const answered = !!split?.text && (!streaming || split.text.length > ANSWER_CHARS);
  // From the start of the reply to the start of its answer; replies saved without that time add up their steps.
  const workedMs =
    split && answered && split.at
      ? split.at - message.createdAt
      : (split?.work ?? []).reduce(
          (ms, s) => ms + (s.kind === 'tool' ? (s.part.durationMs ?? 0) : s.kind === 'thought' ? (s.ms ?? 0) : 0),
          0
        );
  const sources = message.status === 'done' ? sourcesOf(message.content) : [];

  const render = (seg: Segment, i: number) =>
    seg.kind === 'tool' ? (
      <ToolCall key={seg.part.id} part={seg.part} />
    ) : seg.kind === 'thought' ? (
      <Thoughts key={`r${i}`} text={seg.text} ms={seg.ms} live={streaming && seg === lastSeg} />
    ) : (
      !!seg.text.trim() && <Markdown key={`t${i}`} value={seg.text} live={streaming && seg === lastSeg} />
    );

  return (
    <View style={styles.assistantRow}>
      {split ? (
        <>
          <Work
            segments={split.work}
            folded={answered}
            live={streaming}
            ms={workedMs}
            render={render}
            content={message.content}
          />
          {split.answer.map((seg, i) => render(seg, split.work.length + i))}
        </>
      ) : (
        segments.map(render)
      )}
      {waiting && <ThinkingIndicator thinking expanded={false} toggleable={false} onToggle={() => {}} />}

      {message.status === 'error' && (
        <View style={[styles.error, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
          <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>{message.error}</Text>
          <Pressable
            onPress={() => onRegenerate(message.id)}
            style={[styles.retry, { borderColor: colors.danger }]}
            hitSlop={6}
          >
            <Feather name="rotate-ccw" size={14} color={colors.danger} />
            <Text style={{ color: colors.danger, fontWeight: '500' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {message.status === 'done' && (
        <View style={styles.actions}>
          {!!text && (
            <Pressable onPress={copy} hitSlop={8} style={styles.action}>
              <Feather name={copied ? 'check' : 'copy'} size={16} color={colors.textSecondary} />
            </Pressable>
          )}
          {isLast && (
            <Pressable onPress={() => onRegenerate(message.id)} hitSlop={8} style={styles.action}>
              <Feather name="refresh-cw" size={16} color={colors.textSecondary} />
            </Pressable>
          )}
          {!!message.model && (
            <Text numberOfLines={1} style={[styles.model, { color: colors.textTertiary }]}>
              {message.model}
            </Text>
          )}
          {!!sources.length && (
            <View style={styles.sources}>
              <SourcesButton sources={sources} />
            </View>
          )}
        </View>
      )}
      {!!message.memorySaved?.length && (
        <Pressable
          onPress={() => router.push('/settings/memory')}
          hitSlop={6}
          style={({ pressed }) => [styles.memory, pressed && { opacity: 0.5 }]}
          accessibilityLabel={`Memory updated: ${message.memorySaved.join('; ')}`}
        >
          <Feather name="bookmark" size={13} color={colors.textTertiary} />
          <Text numberOfLines={1} style={[styles.memoryText, { color: colors.textTertiary }]}>
            Memory updated · {message.memorySaved.join('; ')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleInner);

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingHorizontal: 16, marginVertical: 10, gap: 6 },
  userBubble: { maxWidth: '82%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 23 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '82%' },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '82%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  fileName: { fontSize: 15, flexShrink: 1 },
  assistantRow: { paddingHorizontal: 16, marginVertical: 6, gap: 2 },
  thoughts: { maxHeight: 260, marginVertical: 4 },
  thoughtsInner: { borderLeftWidth: 3, paddingLeft: 12, paddingRight: 4 },
  thoughtsText: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginLeft: -6 },
  action: { padding: 6 },
  model: { fontSize: 12, marginLeft: 6, flexShrink: 1 },
  sources: { marginLeft: 'auto' },
  memory: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 4 },
  memoryText: { fontSize: 13, flexShrink: 1 },
  workHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, marginLeft: 2, alignSelf: 'flex-start' },
  workLabel: { fontSize: 15, fontWeight: '500' },
  error: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginTop: 4 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
