import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type Glyph = keyof typeof MaterialCommunityIcons.glyphMap;
type Kind = { icon: Glyph; color: string };

// Brand colours for the office formats people know by colour; the rest get their own hue.
const KINDS: [RegExp, Kind][] = [
  [/\.pdf$/i, { icon: 'file-pdf-box', color: '#E5252A' }],
  [/\.(docx?|odt|rtf|pages)$/i, { icon: 'file-word-box', color: '#2B6CD9' }],
  [/\.(xlsx?|xlsm|ods|numbers)$/i, { icon: 'file-excel-box', color: '#1E8C4E' }],
  [/\.(csv|tsv)$/i, { icon: 'file-delimited', color: '#1E8C4E' }],
  [/\.(pptx?|odp|key)$/i, { icon: 'file-powerpoint-box', color: '#D9542B' }],
  [/\.svg$/i, { icon: 'svg', color: '#E39B1B' }],
  [/\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|tiff?)$/i, { icon: 'file-image', color: '#8A5CD8' }],
  [/\.(mp4|mov|webm|mkv|avi|m4v)$/i, { icon: 'file-video', color: '#D9437F' }],
  [/\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i, { icon: 'file-music', color: '#E07B1F' }],
  [/\.(zip|gz|tgz|7z|rar|tar|bz2|xz)$/i, { icon: 'folder-zip', color: '#A8812A' }],
  [/\.epub$/i, { icon: 'book-open-variant', color: '#6C7A3A' }],
  [/\.py$/i, { icon: 'language-python', color: '#3B77A8' }],
  [/\.(js|mjs|cjs|jsx)$/i, { icon: 'language-javascript', color: '#C9A800' }],
  [/\.tsx?$/i, { icon: 'language-typescript', color: '#3178C6' }],
  [/\.html?$/i, { icon: 'language-html5', color: '#E4572E' }],
  [/\.(css|scss|less)$/i, { icon: 'language-css3', color: '#5A4FCF' }],
  [/\.json$/i, { icon: 'code-json', color: '#8C8C3C' }],
  [/\.(md|markdown)$/i, { icon: 'language-markdown', color: '#5F6B7A' }],
  [/\.(java|kt|kts)$/i, { icon: 'language-java', color: '#B07219' }],
  [/\.swift$/i, { icon: 'language-swift', color: '#F05138' }],
  [/\.(c|h)$/i, { icon: 'language-c', color: '#55658A' }],
  [/\.(cpp|cc|hpp|cxx)$/i, { icon: 'language-cpp', color: '#00599C' }],
  [/\.rs$/i, { icon: 'language-rust', color: '#A5583A' }],
  [/\.go$/i, { icon: 'language-go', color: '#00A7D0' }],
  [/\.rb$/i, { icon: 'language-ruby', color: '#CC342D' }],
  [/\.php$/i, { icon: 'language-php', color: '#777BB4' }],
  [/\.(sql|db|sqlite3?)$/i, { icon: 'database', color: '#3E7C8C' }],
  [/\.(xml|ya?ml|toml|ini|cfg|conf)$/i, { icon: 'file-xml-box', color: '#7A6A55' }],
  [/\.(sh|bash|zsh|ps1|bat)$/i, { icon: 'console', color: '#4A5560' }],
  [/\.(txt|log)$/i, { icon: 'file-document-outline', color: '#6E7781' }],
];
const OTHER: Kind = { icon: 'file-outline', color: '#6E7781' };

export const fileKind = (name: string) => KINDS.find(([re]) => re.test(name))?.[1] ?? OTHER;

/** Formats a phone can draw itself, so worth a thumbnail. */
export const isPreviewable = (name: string) => /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(name);

/**
 * A square tile for a file: a thumbnail for an image, given `uri`, otherwise the file type's icon
 * on a wash of its colour.
 */
export function FileIcon({ name, uri, size = 44, style }: { name: string; uri?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const [broken, setBroken] = useState(false);
  const kind = fileKind(name);
  const radius = Math.round(size / 4);
  const tile = { width: size, height: size, borderRadius: radius, overflow: 'hidden' as const };
  if (uri && !broken && isPreviewable(name)) {
    return (
      <View style={[tile, { backgroundColor: `${kind.color}22` }, style]}>
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          // Local files the agent rewrites keep their uri, so a cached copy would go stale.
          cachePolicy="none"
          recyclingKey={uri}
          onError={() => setBroken(true)}
        />
      </View>
    );
  }
  return (
    <View style={[tile, { backgroundColor: `${kind.color}22`, alignItems: 'center', justifyContent: 'center' }, style]}>
      <MaterialCommunityIcons name={kind.icon} size={Math.round(size * 0.58)} color={kind.color} />
    </View>
  );
}
