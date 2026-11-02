import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { attachmentUri } from '@/lib/attachments';
import { openWorkspaceFile, shareWorkspaceFile } from '@/lib/openFile';
import type { ToolPart } from '@/lib/providers';
import { fonts, useTheme } from '@/lib/theme';
import { describeCall, lineChanges } from '@/lib/tools';
import { questionsOf } from '@/lib/tools/ask';
import type { Workspace } from '@/lib/workspace';
import { useWorkspace } from '@/lib/useWorkspace';
import { CodeBlock } from './CodeBlock';
import { NestedScroll } from './NestedScroll';

const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  ask_user: 'help-circle',
  read_file: 'file-text',
  write_file: 'file-plus',
  edit_file: 'edit-3',
  delete_path: 'trash-2',
  move_path: 'copy',
  list_files: 'folder',
  search_files: 'search',
  run_python: 'code',
  run_javascript: 'code',
  run_shell: 'terminal',
  job_output: 'clock',
  job_kill: 'x-octagon',
  web_search: 'globe',
  web_fetch: 'link',
  compress: 'minimize-2',
  decompress: 'maximize-2',
  search_context: 'search',
  context_status: 'bar-chart-2',
};

const JOB_LABELS = {
  running: 'in background',
  done: 'background · done',
  error: 'background · failed',
  killed: 'stopped',
  lost: 'lost on restart',
};

const LANGUAGES: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  json: 'json',
  md: 'markdown',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
};

function seconds(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

const basename = (path: string) => path.split('/').pop() ?? path;

/** The part of the call worth showing in full: the script, the command, or the written content. */
function CallInput({ part }: { part: ToolPart }) {
  const { colors } = useTheme();
  const input = part.input;
  // While the model is still writing the call, the code shows its growing end.
  const live = part.status === 'writing';
  if (part.name === 'ask_user') {
    // An answered call's output repeats the questions with their answers.
    if (part.status === 'done') return null;
    const text = questionsOf(input)
      .map((q) => [q.question, ...q.options.map((o) => `  · ${o.label}`)].join('\n'))
      .join('\n\n');
    return (
      <Text selectable style={[styles.summary, { color: colors.textSecondary }]}>
        {text}
      </Text>
    );
  }
  if ((part.name === 'run_python' || part.name === 'run_javascript') && typeof input.code === 'string') {
    return <CodeBlock code={input.code} language={part.name === 'run_python' ? 'python' : 'javascript'} live={live} />;
  }
  if (part.name === 'run_shell' && typeof input.command === 'string') {
    return <CodeBlock code={input.command} language="bash" live={live} />;
  }
  if (part.name === 'write_file' && typeof input.content === 'string' && input.encoding !== 'base64') {
    const ext = String(input.path ?? '').split('.').pop()?.toLowerCase() ?? '';
    const code = !live && input.content.length > 20_000 ? input.content.slice(0, 20_000) + '\n…' : input.content;
    return <CodeBlock code={code} language={LANGUAGES[ext]} live={live} />;
  }
  if (part.name === 'edit_file') {
    return (
      <CodeBlock
        code={`- ${String(input.old_string ?? '').replace(/\n/g, '\n- ')}\n+ ${String(input.new_string ?? '').replace(/\n/g, '\n+ ')}`}
        language="diff"
        live={live}
      />
    );
  }
  const json = JSON.stringify(input, null, 2);
  return json === '{}' ? null : (
    <Text selectable style={[styles.mono, { color: colors.textSecondary }]}>
      {json}
    </Text>
  );
}

/** Chips for files a tool created or changed; tap to open, long-press to share. */
export function FileChips({ files }: { files: string[] }) {
  const { colors } = useTheme();
  const ws = useWorkspace();
  const run = (fn: (ws: Workspace, p: string) => Promise<void>, path: string) =>
    (ws ? fn(ws, path) : Promise.reject(new Error('This chat has no workspace.'))).catch((e) => Alert.alert('Could not open file', e instanceof Error ? e.message : String(e)));
  return (
    <View style={styles.chips}>
      {files.map((path) => (
        <Pressable
          key={path}
          onPress={() => run(openWorkspaceFile, path)}
          onLongPress={() => run(shareWorkspaceFile, path)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${basename(path)}`}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <Feather name="file" size={14} color={colors.textSecondary} />
          <Text numberOfLines={1} style={[styles.chipText, { color: colors.text }]}>
            {basename(path)}
          </Text>
          <Feather name="external-link" size={13} color={colors.textTertiary} />
        </Pressable>
      ))}
    </View>
  );
}

function ToolCallInner({ part }: { part: ToolPart }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const job = part.background;
  const writing = part.status === 'writing';
  // A background job's row tracks the job, not the call that started it.
  const running = writing || part.status === 'running' || job?.status === 'running';
  const failed = part.status === 'error' || job?.status === 'error';
  const output = job?.output ?? part.output;
  const label = describeCall(part.name, part.input);
  const changes = lineChanges(part.name, part.input);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => setOpen(!open)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${writing ? 'writing' : running ? 'running' : failed ? 'failed' : 'done'}`}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      >
        <Feather name={ICONS[part.name] ?? 'tool'} size={14} color={failed ? colors.danger : colors.textSecondary} />
        <Text numberOfLines={1} style={[styles.label, { color: failed ? colors.danger : colors.textSecondary }]}>
          {label}
        </Text>
        {!!changes?.added && <Text style={[styles.meta, { color: colors.success }]}>+{changes.added}</Text>}
        {!!changes?.removed && <Text style={[styles.meta, { color: colors.danger }]}>−{changes.removed}</Text>}
        {job && <Text style={[styles.meta, { color: colors.textTertiary }]}>{JOB_LABELS[job.status]}</Text>}
        {running ? (
          <ActivityIndicator size="small" color={colors.textTertiary} style={styles.spinner} />
        ) : (
          !job &&
          part.durationMs != null && (
            <Text style={[styles.meta, { color: colors.textTertiary }]}>{seconds(part.durationMs)}</Text>
          )
        )}
        <Feather
          name="chevron-down"
          size={14}
          color={colors.textTertiary}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      {open && (
        <View style={[styles.details, { borderLeftColor: colors.border }]}>
          {part.name === 'compress' && Array.isArray(part.input.ranges) ? (
            (part.input.ranges as { from?: string; to?: string; summary?: string }[]).map((r, i) => (
              <Text key={i} selectable style={[styles.summary, { color: colors.textSecondary }]}>
                <Text style={{ fontWeight: '600' }}>{r.to && r.to !== r.from ? `${r.from}–${r.to}` : r.from}: </Text>
                {r.summary}
              </Text>
            ))
          ) : (
            <CallInput part={part} />
          )}
          {output != null && (
            <NestedScroll style={[styles.output, { backgroundColor: colors.codeBg }]} contentContainerStyle={styles.outputContent}>
              <Text selectable style={[styles.mono, { color: failed ? colors.danger : colors.text }]}>
                {output.length > 20_000 ? output.slice(0, 20_000) + '\n…' : output || '(no output)'}
              </Text>
            </NestedScroll>
          )}
        </View>
      )}

      {!!part.images?.length && (
        <View style={styles.chips}>
          {part.images.map((img) => (
            <Image
              key={img.file}
              source={{ uri: attachmentUri(img.file) }}
              style={[styles.thumb, { borderColor: colors.border }]}
              contentFit="cover"
            />
          ))}
        </View>
      )}
      {!!part.files?.length && <FileChips files={part.files} />}
    </View>
  );
}

export const ToolCall = memo(ToolCallInner);

const styles = StyleSheet.create({
  container: { marginVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  label: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
  meta: { fontSize: 12 },
  spinner: { transform: [{ scale: 0.7 }], marginVertical: -4 },
  details: { borderLeftWidth: 3, paddingLeft: 12, marginLeft: 5, marginBottom: 6, gap: 6 },
  // The padding goes on the content: on the scroll view itself Android leaves it out of the scroll range and cuts off the end.
  output: { maxHeight: 260, borderRadius: 8 },
  outputContent: { padding: 10 },
  mono: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 },
  summary: { fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  chipText: { fontSize: 14, flexShrink: 1 },
  thumb: { width: 96, height: 96, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
});
