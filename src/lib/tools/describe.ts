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
    default:
      return name;
  }
}
