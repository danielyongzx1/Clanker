import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { create } from 'zustand';
import { useTheme } from '@/lib/theme';
import { MenuGlyph, type MenuIcon } from './ContextMenu';

/**
 * Themed dialogs, called from anywhere and shown by the one DialogHost at the root. Android's
 * Alert can't color a button red or follow the dark theme, so confirmations go through here.
 */

type Confirm = {
  kind: 'confirm';
  title: string;
  message?: string;
  confirmLabel: string;
  /** Red confirm button, for deleting. */
  destructive?: boolean;
  /** Only the confirm button, for a notice. */
  noCancel?: boolean;
  onConfirm: () => void;
};

type Prompt = {
  kind: 'prompt';
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  maxLength?: number;
  /** Called with the trimmed text, which is never empty. */
  onSubmit: (text: string) => void;
};

export type Choice = { label: string; icon: MenuIcon; detail?: string; selected?: boolean; onPress: () => void };

type Choose = { kind: 'choose'; title: string; message?: string; choices: Choice[] };

type Dialog = (Confirm | Prompt | Choose) & { id: number };

const useDialogs = create<{ dialog: Dialog | null }>()(() => ({ dialog: null }));

let nextId = 1;
const show = (dialog: Confirm | Prompt | Choose) => useDialogs.setState({ dialog: { ...dialog, id: nextId++ } });
const close = () => useDialogs.setState({ dialog: null });

export const confirm = (opts: Omit<Confirm, 'kind'>) => show({ kind: 'confirm', ...opts });
/** A notice with an OK button. */
export const notify = (title: string, message?: string) =>
  show({ kind: 'confirm', title, message, confirmLabel: 'OK', noCancel: true, onConfirm: () => {} });
export const prompt = (opts: Omit<Prompt, 'kind'>) => show({ kind: 'prompt', ...opts });
export const choose = (opts: Omit<Choose, 'kind'>) => show({ kind: 'choose', ...opts });

/** Mount once, at the root, above every screen. */
export function DialogHost() {
  const { colors } = useTheme();
  const dialog = useDialogs((s) => s.dialog);

  // A choice or a confirmation may open the next dialog, so close this one before acting.
  const act = (fn: () => void) => {
    close();
    fn();
  };

  return (
    <Modal visible={!!dialog} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={close}>
        <Pressable style={[styles.dialog, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {dialog && (
            <>
              <Text style={[styles.title, { color: colors.text }]}>{dialog.title}</Text>
              {!!dialog.message && <Text style={[styles.message, { color: colors.textSecondary }]}>{dialog.message}</Text>}
              {dialog.kind === 'confirm' && (
                <View style={styles.buttons}>
                  {!dialog.noCancel && <Button label="Cancel" onPress={close} />}
                  <Button
                    label={dialog.confirmLabel}
                    variant={dialog.destructive ? 'danger' : 'primary'}
                    onPress={() => act(dialog.onConfirm)}
                  />
                </View>
              )}
              {/* Keyed by the dialog, so a new prompt starts from its own initial text. */}
              {dialog.kind === 'prompt' && <PromptBody key={dialog.id} dialog={dialog} onDone={act} />}
              {dialog.kind === 'choose' && (
                <>
                  <ScrollView style={styles.choices} bounces={false}>
                    {dialog.choices.map((c) => (
                      <Pressable
                        key={c.label}
                        onPress={() => act(c.onPress)}
                        style={({ pressed }) => [styles.choice, pressed && { backgroundColor: colors.surfaceHover }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: c.selected }}
                      >
                        <MenuGlyph icon={c.icon} size={20} color={colors.textSecondary} />
                        <View style={styles.choiceText}>
                          <Text numberOfLines={1} style={[styles.choiceLabel, { color: colors.text }]}>
                            {c.label}
                          </Text>
                          {!!c.detail && (
                            <Text numberOfLines={1} style={[styles.choiceDetail, { color: colors.textTertiary }]}>
                              {c.detail}
                            </Text>
                          )}
                        </View>
                        {c.selected && <MenuGlyph icon={{ feather: 'check' }} size={18} color={colors.accentText} />}
                      </Pressable>
                    ))}
                  </ScrollView>
                  <View style={styles.buttons}>
                    <Button label="Cancel" onPress={close} />
                  </View>
                </>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PromptBody({ dialog, onDone }: { dialog: Prompt; onDone: (fn: () => void) => void }) {
  const { colors } = useTheme();
  const [text, setText] = useState(dialog.initial ?? '');
  const submit = () => {
    const t = text.trim();
    if (t) onDone(() => dialog.onSubmit(t));
  };
  return (
    <>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={dialog.placeholder}
        placeholderTextColor={colors.textTertiary}
        maxLength={dialog.maxLength}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
      />
      <View style={styles.buttons}>
        <Button label="Cancel" onPress={close} />
        <Button label={dialog.confirmLabel} variant="primary" disabled={!text.trim()} onPress={submit} />
      </View>
    </>
  );
}

function Button({
  label,
  onPress,
  variant,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const bg = variant === 'danger' ? colors.danger : variant === 'primary' ? colors.sendBg : 'transparent';
  const fg = variant === 'danger' ? '#FFFFFF' : variant === 'primary' ? colors.sendFg : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: bg }, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}
    >
      <Text style={{ color: fg, fontSize: 16, fontWeight: variant ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 28 },
  dialog: { borderRadius: 24, padding: 22, gap: 14, borderWidth: StyleSheet.hairlineWidth, maxHeight: '80%' },
  title: { fontSize: 19, fontWeight: '600' },
  message: { fontSize: 15, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  choices: { marginHorizontal: -10, flexGrow: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 12 },
  choiceText: { flex: 1 },
  choiceLabel: { fontSize: 16 },
  choiceDetail: { fontSize: 13, marginTop: 1 },
});
