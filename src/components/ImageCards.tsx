import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { openWorkspaceFile } from '@/lib/openFile';
import { useTheme } from '@/lib/theme';
import type { Workspace } from '@/lib/workspace';
import { useWorkspace } from '@/lib/useWorkspace';
import { REPLY_GUTTER } from './Chart';
import { HorizontalScroll } from './HorizontalScroll';

export type ImageCard = { url: string; title?: string; subtitle?: string; link?: string; fit?: 'cover' | 'contain' };

const REMOTE = /^(https?:|data:)/i;
// Cards in a row of three or more scroll sideways, each this share of the screen wide.
const SCROLL_CARD = 0.62;
const CARD_GAP = 12;

// Aspect ratios of images already loaded, so one that remounts (the chat list recycles rows)
// takes its final size at once instead of starting at the default and jumping.
const ratios = new Map<string, number>();

/** Where an image the model referenced lives: a web URL as is, anything else as a workspace path. */
function resolve(src: string, ws: Workspace | null): { uri: string; workspace?: string } {
  if (REMOTE.test(src) || src.startsWith('file:') || !ws) return { uri: src };
  try {
    const file = ws.fileAt(src);
    if (file.exists) return { uri: file.uri, workspace: src };
  } catch {}
  return { uri: src };
}

function openTarget(link: string | undefined, src: string, ws: Workspace | null) {
  const target = link || src;
  const { workspace } = resolve(target, ws);
  const run = workspace && ws ? openWorkspaceFile(ws, workspace) : /^https?:/i.test(target) ? Linking.openURL(target) : null;
  run?.catch((e) => Alert.alert('Could not open', e instanceof Error ? e.message : String(e)));
}

/** Reads an ```images block: a JSON array of cards, or an object holding one under "images". */
export function parseImages(json: string): ImageCard[] | null {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.images) ? raw.images : null;
  const cards = (list ?? [])
    .filter((c: any) => typeof (c?.url ?? c?.src) === 'string')
    .map(
      (c: any): ImageCard => ({
        url: c.url ?? c.src,
        title: c.title ?? c.alt,
        subtitle: c.subtitle ?? c.caption,
        link: c.link ?? c.href,
        fit: c.fit === 'contain' ? 'contain' : 'cover',
      })
    );
  return cards.length ? cards : null;
}

function Broken({ height }: { height?: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.broken, { height: height ?? 120, backgroundColor: colors.surface }]}>
      <Feather name="image" size={22} color={colors.textTertiary} />
    </View>
  );
}

/** A markdown image: full width at its own aspect ratio, tap to open. */
function ChatImageInner({ src, alt, title }: { src: string; alt?: string; title?: string }) {
  const { colors } = useTheme();
  // Resolving a workspace path checks the file, so it is done once, not on every streamed token.
  const ws = useWorkspace();
  const source = useMemo(() => ({ uri: resolve(src, ws).uri }), [src, ws]);
  const uri = source.uri;
  // Whether the image was seen before, fixed at mount so the fade setting doesn't change under a loading image.
  const [known] = useState(() => ratios.has(uri));
  const [ratio, setRatio] = useState(ratios.get(uri) ?? 16 / 10);
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.inline}>
      {failed ? (
        <Broken />
      ) : (
        <Pressable onPress={() => openTarget(undefined, src, ws)} accessibilityRole="imagebutton" accessibilityLabel={alt || title || 'Image'}>
          <Image
            source={source}
            // Very tall images are cut down rather than taking over the reply.
            style={[styles.inlineImage, { aspectRatio: Math.max(ratio, 0.6), backgroundColor: colors.surface }]}
            contentFit="cover"
            // Fade in only the first time; an image seen before appears straight from the cache.
            transition={known ? 0 : 150}
            onLoad={(e) => {
              if (!e.source.width || !e.source.height) return;
              const r = e.source.width / e.source.height;
              ratios.set(uri, r);
              setRatio(r);
            }}
            onError={() => setFailed(true)}
          />
        </Pressable>
      )}
      {!!title && <Text style={[styles.inlineCaption, { color: colors.textTertiary }]}>{title}</Text>}
    </View>
  );
}

export const ChatImage = memo(ChatImageInner);

function Card({ card, width }: { card: ImageCard; width: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const height = Math.round(width * 0.8);
  const ws = useWorkspace();
  const source = useMemo(() => ({ uri: resolve(card.url, ws).uri }), [card.url, ws]);
  const uri = source.uri;
  const [known] = useState(() => ratios.has(uri));
  const contain = card.fit === 'contain';
  return (
    <Pressable
      onPress={() => openTarget(card.link, card.url, ws)}
      accessibilityRole="imagebutton"
      accessibilityLabel={card.title || 'Image'}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.8 }]}
    >
      {failed ? (
        <Broken height={height} />
      ) : (
        <Image
          source={source}
          // Product shots and logos usually sit on white; "contain" keeps them whole on a white card.
          style={[styles.cardImage, { height, backgroundColor: contain ? '#FFFFFF' : colors.surface }]}
          contentFit={card.fit ?? 'cover'}
          contentPosition="center"
          transition={known ? 0 : 150}
          onLoad={(e) => e.source.width && e.source.height && ratios.set(uri, e.source.width / e.source.height)}
          onError={() => setFailed(true)}
        />
      )}
      {!!card.title && (
        <Text
          numberOfLines={3}
          style={[
            styles.cardTitle,
            { color: colors.text },
            !!card.link && { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.textTertiary },
          ]}
        >
          {card.title}
        </Text>
      )}
      {!!card.subtitle && (
        <Text numberOfLines={2} style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          {card.subtitle}
        </Text>
      )}
    </Pressable>
  );
}

/** Images side by side with captions; three or more scroll sideways. */
function ImageCardsInner({ source }: { source: string }) {
  const { width: screen } = useWindowDimensions();
  // Starts at a reply's width on this screen so the cards have their height from the first frame.
  const [width, setWidth] = useState(Math.max(0, screen - REPLY_GUTTER));
  const cards = useMemo(() => parseImages(source) ?? [], [source]);
  if (cards.length <= 2) {
    const cardWidth = cards.length === 1 ? width : (width - CARD_GAP) / 2;
    return (
      <View style={styles.row} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
        {cards.map((card, i) => (
          <Card key={i} card={card} width={cardWidth} />
        ))}
      </View>
    );
  }
  return (
    <HorizontalScroll style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {cards.map((card, i) => (
        <Card key={i} card={card} width={Math.round(screen * SCROLL_CARD)} />
      ))}
    </HorizontalScroll>
  );
}

export const ImageCards = memo(ImageCardsInner);

const styles = StyleSheet.create({
  inline: { marginVertical: 8, gap: 6 },
  inlineImage: { width: '100%', borderRadius: 14 },
  inlineCaption: { fontSize: 13, lineHeight: 18 },
  broken: { width: '100%', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: CARD_GAP, marginVertical: 10 },
  scroll: { marginVertical: 10, marginHorizontal: -16 },
  scrollContent: { gap: CARD_GAP, paddingHorizontal: 16 },
  cardImage: { width: '100%', borderRadius: 16 },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', marginTop: 10 },
  cardSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
});
