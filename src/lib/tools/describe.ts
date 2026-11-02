const short = (text: string) => (text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text);

const linesOf = (v: unknown) => (typeof v === 'string' && v ? v.replace(/\r?\n$/, '').split(/\r?\n/) : []);

/**
 * Lines a file write or edit adds and removes, for the "+3 −1" by its label. An edit's lines in
 * common at the start and end of both strings don't count. Works on calls still being written.
 */
export function lineChanges(name: string, input: Record<string, unknown>) {
  if (name === 'write_file' && input.encoding !== 'base64') return { added: linesOf(input.content).length, removed: 0 };
  if (name !== 'edit_file') return null;
  const before = linesOf(input.old_string);
  const after = linesOf(input.new_string);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return { added: after.length - start - end, removed: before.length - start - end };
}

/** One-line label for a tool call, e.g. "Read report.pdf". */
export function describeCall(name: string, input: Record<string, unknown>) {
  const p = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'read_file':
      return `Read ${p('path')}`;
    case 'write_file':
      return `Write ${p('path')}`;
    case 'edit_file':
      return `Edit ${p('path')}`;
    case 'delete_path':
      return `Delete ${p('path')}`;
    case 'move_path':
      return `${input.copy ? 'Copy' : 'Move'} ${p('from')} → ${p('to')}`;
    case 'list_files':
      return p('pattern') ? `Find ${p('pattern')}` : `List ${p('path') || 'workspace'}`;
    case 'search_files':
      return `Search “${p('pattern')}”`;
    case 'run_python':
      return input.background ? 'Run Python in background' : 'Run Python';
    case 'run_javascript':
      return input.background ? 'Run JavaScript in background' : 'Run JavaScript';
    case 'run_shell':
      return `$ ${p('command').split('\n')[0]}`;
    case 'job_output':
      return p('job_id') ? `Check job ${p('job_id')}` : 'List background jobs';
    case 'job_kill':
      return `Stop job ${p('job_id')}`;
    case 'web_search':
      return `Search web “${p('query')}”`;
    case 'web_fetch':
      return `${p('save_as') ? 'Download' : 'Fetch'} ${p('url').replace(/^https?:\/\/(www\.)?/, '')}`;
    case 'compress': {
      const ranges = Array.isArray(input.ranges) ? (input.ranges as { from?: unknown; to?: unknown }[]) : [];
      const labels = ranges.map((r) => (r.to && r.to !== r.from ? `${r.from}–${r.to}` : String(r.from)));
      return `Compress ${labels.join(', ') || 'context'}`;
    }
    case 'decompress':
      return `Restore ${p('block_id')}`;
    case 'search_context':
      return `Search history “${p('query')}”`;
    case 'context_status':
      return 'Check context';
    case 'memory_save':
      return `Remembered “${short(p('text'))}”`;
    case 'memory_update':
      return `Updated memory “${short(p('text'))}”`;
    case 'memory_forget':
      return 'Forgot a memory';
    case 'search_chats':
      return `Search chats “${p('query')}”`;
    case 'read_chat':
      return 'Read an earlier chat';
    case 'phone_screen':
      return input.screenshot ? 'Take a screenshot' : 'Look at the screen';
    case 'phone_tap': {
      const verb = input.long_press ? 'Long-press' : 'Tap';
      return input.element != null ? `${verb} [${input.element}]` : `${verb} (${input.x ?? '?'}, ${input.y ?? '?'})`;
    }
    case 'phone_type':
      return `Type “${short(p('text'))}”`;
    case 'phone_scroll':
      return `Scroll ${p('direction') || 'down'}`;
    case 'phone_swipe':
      return 'Swipe';
    case 'phone_press': {
      const key = p('key').replace('_', ' ');
      return key === 'notifications' || key === 'quick settings' ? `Open ${key}` : `Press ${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    }
    case 'phone_open_app':
      return `Open ${p('app')}`;
    case 'phone_list_apps':
      return 'List apps';
    default:
      return name;
  }
}
