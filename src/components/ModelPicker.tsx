import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useShallow } from 'zustand/react/shallow';
import { PROVIDER_LABELS } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { modelProvider } from '@/lib/remote/types';
import { useBackends } from '@/store/backends';
import { useChats } from '@/store/chats';
import { useSettings } from '@/store/settings';
import { RemoteFiles } from './RemoteReply';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The chat on screen, or null for the new-chat state. */
  conversationId: string | null;
};

const BACKEND_LABELS = { hermes: 'Hermes', harness: 'DeepSeek Harness' } as const;

const ENTER = { duration: 260, easing: Easing.bezier(0.23, 1, 0.32, 1) };
const EXIT = { duration: 180, easing: Easing.bezier(0.3, 0, 0.8, 0.6) };
/** The share of the screen it opens at, the same whichever backend's models it shows. */
const SHEET_HEIGHT = 0.6;

type Choice = { key: string; model: string; selected: boolean; onPress: () => void };

/**
 * The sheet behind the chat title. On a new chat it also picks the backend, from chips above the
 * models; once a chat has started its backend is fixed. A remote chat can still switch to another of
 * its backend's models, and the sheet lists that chat's remote files under them.
 */
export function ModelPicker({ visible, onClose, conversationId }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const endpoints = useSettings((s) => s.endpoints);
  const active = useSettings((s) => s.active);
  const remotes = useBackends((s) => s.remotes);
  const selectedBackend = useBackends((s) => s.selected);
  const conversation = useChats(
    useShallow((s) => {
      const c = conversationId ? s.conversations[conversationId] : undefined;
      return c ? { backendId: c.backendId ?? 'local', model: c.model, started: c.messages.length > 0 } : undefined;
    })
  );
  const [query, setQuery] = useState('');
  // Whether it rests full screen. It only sets how much of the list sits off the bottom, so it
  // changes once the sheet settles rather than on every frame of a drag.
  const [expanded, setExpanded] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);
  // Stays mounted through the exit animation; the search clears as it opens rather than as it
  // closes, so the list doesn't change under the sliding sheet.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) {
    setMounted(true);
    setQuery('');
    setExpanded(false);
  }

  // The sheet is always full height and only ever moves: resizing it relaid it out every frame.
  // `extent` is how much of it shows. It rests at `mid` or `full`, and dragging below `mid`
  // slides it away.
  const mid = height * SHEET_HEIGHT;
  const full = height - insets.top;
  const extent = useSharedValue(mid);
  const dragStart = useSharedValue(mid);
  const dragClosed = useSharedValue(false);

  // Opening and closing; the backdrop fades while the sheet slides.
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      extent.set(mid);
      dragClosed.set(false);
      progress.set(0);
      progress.set(withTiming(1, ENTER));
    } else if (mounted && !dragClosed.get()) {
      // A drag-to-close is already sliding it away and unmounts it when done.
      progress.set(
        withTiming(0, EXIT, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(setMounted, false);
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * Math.min(1, extent.value / mid) }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: full - extent.value * progress.value }] }));
  // The bottom bar stays put above `mid`; below it, it goes with the sheet as if that were `mid` tall.
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, mid - extent.value * progress.value) }],
  }));

  const settle = (target: number) => {
    'worklet';
    extent.set(
      withTiming(target, ENTER, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(setExpanded, target === full);
      })
    );
  };

  // Settles where the drag was heading, counting the flick's speed, at the nearest of closed,
  // `mid` and `full`.
  const pan = Gesture.Pan()
    .onBegin(() => {
      dragStart.set(extent.get());
    })
    .onUpdate((e) => {
      extent.set(Math.min(full, Math.max(0, dragStart.get() - e.translationY)));
    })
    .onEnd((e) => {
      const projected = extent.get() - e.velocityY * 0.15;
      const target = [0, mid, full].reduce((a, b) => (Math.abs(b - projected) < Math.abs(a - projected) ? b : a));
      if (target !== 0) return settle(target);
      // Carries straight on from the finger, starting at the flick's speed, rather than waiting a
      // render for the closing animation.
      dragClosed.set(true);
      const speed = Math.max(e.velocityY, 600);
      const duration = Math.min(320, Math.max(120, ((2 * extent.get()) / speed) * 1000));
      extent.set(
        withTiming(0, { duration, easing: Easing.out(Easing.quad) }, (finished) => {
          'worklet';
          if (!finished) return;
          progress.set(0);
          scheduleOnRN(setMounted, false);
        })
      );
      scheduleOnRN(onClose);
    });
  const resize = () => {
    'worklet';
    settle(extent.get() > mid + 1 ? mid : full);
  };
  const tap = Gesture.Tap().onEnd(resize);

  const backendId = conversation?.backendId ?? selectedBackend;
  const backend = remotes.find((b) => b.id === backendId);
  const remote = backendId !== 'local';
  // Chats are created by their first message, so only the new-chat state can still switch.
  const canSwitch = !conversation && remotes.length > 0;
  const remoteStarted = remote && !!conversation?.started;
  // Bridges from before model switching keep a chat on the model it started with.
  const remoteLocked = remoteStarted && !backend?.modelSwitching;
  const chatModel = remoteStarted ? conversation?.model : undefined;

  // The current model stays listed even when hidden, so its check mark shows.
  const remoteModels = useMemo(() => {
    if (!remote || !backend || remoteLocked) return [];
    const current = chatModel ?? backend.model;
    // Bridges from before switching across providers keep a chat on the provider it started with.
    const provider = chatModel && backend.modelSwitching !== 'any' && modelProvider(chatModel);
    return backend.models.filter(
      (m) => m === current || (!backend.hiddenModels?.includes(m) && (!provider || modelProvider(m) === provider))
    );
  }, [remote, backend, remoteLocked, chatModel]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (remote) {
      if (!backend || remoteLocked) return [];
      return [
        {
          key: backend.id,
          title: `${backend.name} · ${BACKEND_LABELS[backend.kind]}`,
          data: remoteModels
            .filter((m) => !q || m.toLowerCase().includes(q))
            .map(
              (m): Choice => ({
                key: m,
                model: m,
                selected: (chatModel ?? backend.model) === m,
                onPress: () =>
                  chatModel && conversationId
                    ? useChats.getState().setRemoteModel(conversationId, m)
                    : useBackends.getState().save({ ...backend, model: m }),
              })
            ),
        },
      ];
    }
    return endpoints
      .map((e) => ({
        key: e.id,
        title: `${e.name} · ${PROVIDER_LABELS[e.type]}`,
        data: e.models
          .filter((m) => !q || m.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
          .map(
            (m): Choice => ({
              key: `${e.id}-${m}`,
              model: m,
              selected: active?.endpointId === e.id && active.model === m,
              onPress: () => useSettings.getState().setActive({ endpointId: e.id, model: m }),
            })
          ),
      }))
      .filter((s) => s.data.length > 0);
  }, [remote, backend, remoteLocked, remoteModels, chatModel, conversationId, endpoints, active, query]);

  const totalModels = remote ? remoteModels.length : endpoints.reduce((n, e) => n + e.models.length, 0);

  // What of the list sits behind the bottom bar or off the bottom of the screen, so its last rows
  // can still scroll into view.
  const hiddenBottom = footerHeight + (expanded ? 0 : full - mid);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdropStyle]}>
          <Pressable style={styles.fill} onPress={visible ? onClose : undefined} accessibilityLabel="Close models" />
        </Animated.View>
        <Animated.View
          pointerEvents={visible ? 'auto' : 'none'}
          style={[
            styles.sheet,
            { height: full, backgroundColor: colors.background, borderColor: colors.border },
            sheetStyle,
          ]}
        >
          {/* The handle: drag to resize or close, tap to switch between the two sizes. */}
          <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
            <View
              style={styles.handle}
              accessible
              accessibilityRole="button"
              accessibilityLabel={remoteLocked ? 'This chat' : 'Models'}
              accessibilityHint="Drag to resize or close"
              accessibilityActions={[{ name: 'activate', label: 'Resize' }, { name: 'escape', label: 'Close' }]}
              onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'escape' ? onClose() : resize())}
            >
              <View style={[styles.grabber, { backgroundColor: colors.border }]} />
              <Text style={[styles.title, { color: colors.text }]}>{remoteLocked ? 'This chat' : 'Models'}</Text>
            </View>
          </GestureDetector>

          {canSwitch && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.backends} style={styles.backendsRow}>
              {[{ id: 'local', name: 'Clanker', icon: 'smartphone' as const }, ...remotes.map((b) => ({ id: b.id, name: b.name, icon: 'server' as const }))].map(
                (b) => {
                  const on = b.id === backendId;
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => {
                        setQuery('');
                        useBackends.getState().select(b.id);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Backend: ${b.name}`}
                      style={({ pressed }) => [
                        styles.backend,
                        { borderColor: on ? colors.text : colors.border, backgroundColor: on ? colors.surface : 'transparent' },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Feather name={b.icon} size={15} color={on ? colors.text : colors.textSecondary} />
                      {/* One weight for both states: bolding the chosen chip widened it and nudged the rest along. */}
                      <Text numberOfLines={1} style={{ color: on ? colors.text : colors.textSecondary, fontSize: 14, fontWeight: '500' }}>
                        {b.name}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </ScrollView>
          )}

          {remoteLocked ? (
            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: hiddenBottom }}>
              <Text style={[styles.section, { color: colors.textTertiary }]}>
                {backend ? `${backend.name} · ${BACKEND_LABELS[backend.kind]}` : 'Remote backend'}
              </Text>
              <View style={styles.row}>
                <Text numberOfLines={1} style={[styles.model, { color: colors.text }]}>
                  {conversation?.model}
                </Text>
                <Feather name="lock" size={16} color={colors.textTertiary} />
              </View>
              <Text style={[styles.note, { color: colors.textTertiary }]}>
                This bridge keeps a chat on the model it started with. Update the bridge on the host to switch models
                within a chat, or start a new chat to use another.
              </Text>
              <Text style={[styles.section, { color: colors.textTertiary }]}>Files on the remote device</Text>
              {conversationId && <RemoteFiles chatId={conversationId} />}
            </ScrollView>
          ) : (
            <>
              {totalModels > 8 && (
                <View style={[styles.search, { backgroundColor: colors.surface }]}>
                  <Feather name="search" size={16} color={colors.textTertiary} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search models"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.searchInput, { color: colors.text }]}
                  />
                </View>
              )}

              <SectionList
                sections={sections}
                keyExtractor={(item) => item.key}
                keyboardShouldPersistTaps="handled"
                stickySectionHeadersEnabled={false}
                style={styles.list}
                contentContainerStyle={{ paddingBottom: hiddenBottom }}
                renderSectionHeader={({ section }) => (
                  <Text style={[styles.section, { color: colors.textTertiary }]}>{section.title}</Text>
                )}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      item.onPress();
                      onClose();
                    }}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                  >
                    <Text numberOfLines={1} style={[styles.model, { color: colors.text }]}>
                      {item.model}
                    </Text>
                    {item.selected && <Feather name="check" size={18} color={colors.text} />}
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={[styles.empty, { color: colors.textSecondary }]}>
                    {query.trim()
                      ? 'No models match.'
                      : remote
                        ? 'This backend has no models. Check its model provider on the host, then refresh it in Settings.'
                        : 'No endpoints yet. Add one to start chatting.'}
                  </Text>
                }
                ListFooterComponent={
                  remoteStarted && conversationId ? (
                    <>
                      <Text style={[styles.note, { color: colors.textTertiary }]}>
                        {backend?.modelSwitching === 'any'
                          ? 'A remote chat keeps its backend; a new model applies from the next message. Start a new chat to use another backend.'
                          : 'This bridge keeps a chat on the provider it started with; a new model applies from the next message. Update the bridge on the host to switch providers.'}
                      </Text>
                      <Text style={[styles.section, { color: colors.textTertiary }]}>Files on the remote device</Text>
                      <RemoteFiles chatId={conversationId} />
                    </>
                  ) : undefined
                }
              />
            </>
          )}

        </Animated.View>

        {/* Kept apart from the sheet so it stays in view while the sheet's lower part is off screen. */}
        <Animated.View
          pointerEvents={visible ? 'auto' : 'none'}
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
          style={[
            styles.footer,
            { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom },
            footerStyle,
          ]}
        >
          <Pressable
            onPress={() => {
              onClose();
              router.push(remote && backend ? { pathname: '/settings/backend', params: { id: backend.id } } : '/settings');
            }}
            style={({ pressed }) => [styles.manage, pressed && { opacity: 0.6 }]}
          >
            <Feather name="settings" size={18} color={colors.text} />
            <Text style={[styles.model, { color: colors.text }]}>{remote ? 'Manage backend' : 'Manage endpoints'}</Text>
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  handle: { paddingTop: 8, paddingBottom: 4 },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
  // Neither the chips nor the search box give up height to the list below them.
  backendsRow: { flexGrow: 0, flexShrink: 0, marginBottom: 8 },
  backends: { gap: 8, paddingHorizontal: 16 },
  backend: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 220,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexShrink: 0,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  list: { flex: 1 },
  section: { fontSize: 13, fontWeight: '500', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  model: { fontSize: 16, flexShrink: 1 },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 20 },
  empty: { textAlign: 'center', padding: 24, fontSize: 15 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
});
