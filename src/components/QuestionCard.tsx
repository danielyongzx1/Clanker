import Feather from '@expo/vector-icons/Feather';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from '@/lib/haptics';
import type { ToolPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { answerQuestions, questionsOf, skipQuestions } from '@/lib/tools/ask';

/**
 * An ask_user call waiting on the user: options to pick and a box for answers in their own words.
 * Once answered the call finishes and its row shows in the reply like any other.
 */
function QuestionCardInner({ part }: { part: ToolPart }) {
  const { colors } = useTheme();
  const questions = useMemo(() => questionsOf(part.input), [part.input]);
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ''));
  const [sent, setSent] = useState(false);

  // A lone question with a single answer to pick goes off with the tap.
  const instant = questions.length === 1 && !questions[0].multiSelect && questions[0].options.length > 0;
  const answers = questions.map((_, i) => [...(picked[i] ?? []), (typed[i] ?? '').trim()].filter(Boolean).join(', '));
  const ready = !sent && answers.some(Boolean);

  const send = (list: string[]) => {
    if (sent) return;
    setSent(true);
    answerQuestions(part.id, list);
  };

  const pick = (i: number, label: string) => {
    void Haptics.selectionAsync();
    if (instant) return send([label]);
    const multi = questions[i].multiSelect;
    setPicked((prev) =>
      prev.map((p, j) => (j !== i ? p : multi ? (p.includes(label) ? p.filter((l) => l !== label) : [...p, label]) : p[0] === label ? [] : [label]))
    );
    // One answer per single-choice question: a picked option replaces what was typed.
    if (!multi) setTyped((prev) => prev.map((t, j) => (j === i ? '' : t)));
  };

  const type = (i: number, value: string) => {
    setTyped((prev) => prev.map((t, j) => (j === i ? value : t)));
    if (!questions[i].multiSelect && value.trim()) setPicked((prev) => prev.map((p, j) => (j === i ? [] : p)));
  };

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      {questions.map((q, i) => (
        <View key={i} style={styles.question}>
          {!!q.header && <Text style={[styles.header, { color: colors.textTertiary }]}>{q.header}</Text>}
          <Text selectable style={[styles.prompt, { color: colors.text }]}>
            {q.question}
          </Text>
          {q.multiSelect && <Text style={[styles.hint, { color: colors.textTertiary }]}>Pick any that apply</Text>}
          {q.options.map((o) => {
            const on = picked[i]?.includes(o.label) ?? false;
            const icon = q.multiSelect ? (on ? 'check-square' : 'square') : on ? 'check-circle' : 'circle';
            return (
              <Pressable
                key={o.label}
                onPress={() => pick(i, o.label)}
                disabled={sent}
                accessibilityRole={q.multiSelect ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: on, disabled: sent }}
                accessibilityHint={o.description}
                style={({ pressed }) => [
                  styles.option,
                  { borderColor: on ? colors.text : colors.border },
                  (on || pressed) && { backgroundColor: colors.surface },
                ]}
              >
                {!instant && <Feather name={icon} size={17} color={on ? colors.text : colors.textTertiary} />}
                <View style={styles.optionText}>
                  <Text style={[styles.label, { color: colors.text }]}>{o.label}</Text>
                  {!!o.description && (
                    <Text style={[styles.description, { color: colors.textSecondary }]}>{o.description}</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
          <TextInput
            value={typed[i]}
            onChangeText={(v) => type(i, v)}
            editable={!sent}
            multiline
            placeholder={q.options.length ? 'Something else…' : 'Your answer'}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={`Your own answer to: ${q.question}`}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface }]}
          />
        </View>
      ))}
      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            setSent(true);
            skipQuestions(part.id);
          }}
          disabled={sent}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.skip, pressed && { opacity: 0.5 }]}
        >
          <Text style={[styles.skipText, { color: colors.textSecondary }]}>Skip</Text>
        </Pressable>
        {(!instant || !!typed[0]?.trim()) && (
          <Pressable
            onPress={() => send(answers)}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            style={({ pressed }) => [styles.send, { backgroundColor: colors.sendBg }, (!ready || pressed) && { opacity: 0.4 }]}
          >
            <Text style={[styles.sendText, { color: colors.sendFg }]}>Send</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export const QuestionCard = memo(QuestionCardInner);

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 18, marginVertical: 6 },
  question: { gap: 8 },
  header: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  prompt: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  hint: { fontSize: 13, marginTop: -4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionText: { flex: 1, gap: 2 },
  label: { fontSize: 15, lineHeight: 20 },
  description: { fontSize: 13, lineHeight: 18 },
  input: { borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 15, minHeight: 42, maxHeight: 140 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  skip: { paddingVertical: 6 },
  skipText: { fontSize: 15, fontWeight: '500' },
  send: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  sendText: { fontSize: 15, fontWeight: '600' },
});
