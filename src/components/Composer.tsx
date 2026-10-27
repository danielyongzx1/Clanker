import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { attachmentUri, deleteAttachment, pickImages } from '@/lib/attachments';
import type { ImagePart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';

type Props = {
  text: string;
  onChangeText: (text: string) => void;
  streaming: boolean;
  onSend: (text: string, images: ImagePart[]) => void;
  onStop: () => void;
};

export function Composer({ text, onChangeText, streaming, onSend, onStop }: Props) {
  const { colors } = useTheme();
  const [images, setImages] = useState<ImagePart[]>([]);
  const [importing, setImporting] = useState(false);
  const canSend = !streaming && !importing && (text.trim().length > 0 || images.length > 0);

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
    <View style={[styles.box, { backgroundColor: colors.composer, borderColor: colors.composerBorder }]}>
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

      <TextInput
        value={text}
        onChangeText={onChangeText}
        placeholder="Ask anything"
        placeholderTextColor={colors.textTertiary}
        multiline
        style={[styles.input, { color: colors.text }]}
      />

      <View style={styles.toolbar}>
        <Pressable
          onPress={openAttachMenu}
          hitSlop={6}
          style={[styles.circle, { borderColor: colors.composerBorder, borderWidth: 1 }]}
        >
          <Feather name="plus" size={20} color={colors.text} />
        </Pressable>

        {streaming ? (
          <Pressable onPress={onStop} hitSlop={6} style={[styles.circle, { backgroundColor: colors.sendBg }]}>
            <View style={[styles.stop, { backgroundColor: colors.sendFg }]} />
          </Pressable>
        ) : (
          <Pressable
            onPress={send}
            disabled={!canSend}
            hitSlop={6}
            style={[styles.circle, { backgroundColor: canSend ? colors.sendBg : colors.sendDisabledBg }]}
          >
            <Feather name="arrow-up" size={20} color={colors.sendFg} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 10,
    borderRadius: 26,
    borderWidth: 1,
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  thumbs: { gap: 8, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 4 },
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
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 160,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    textAlignVertical: 'top',
  },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stop: { width: 12, height: 12, borderRadius: 2 },
});
