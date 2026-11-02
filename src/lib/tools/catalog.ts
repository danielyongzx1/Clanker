/**
 * The tools as the settings list them, grouped. An entry can cover several tools that only make
 * sense together; they are turned on and off as one.
 */
export type ToolEntry = { names: string[]; title: string; detail: string };

export type ToolGroup = { title: string; footer?: string; tools: ToolEntry[] };

export const LOCAL_TOOL_GROUPS: ToolGroup[] = [
  {
    title: 'Questions',
    footer: 'The reply waits until you answer, in the question or with a message.',
    tools: [{ names: ['ask_user'], title: 'Ask you questions', detail: 'Clarify what you mean before going on' }],
  },
  {
    title: 'Files',
    footer: "Models only see files in Clanker's private workspace.",
    tools: [
      { names: ['list_files'], title: 'List files', detail: 'Browse the workspace and find files by name' },
      { names: ['read_file'], title: 'Read files', detail: 'Text, images, PDFs and Office documents' },
      { names: ['search_files'], title: 'Search files', detail: 'Look for text inside files' },
      { names: ['write_file'], title: 'Create files', detail: 'Write new files or replace existing ones' },
      { names: ['edit_file'], title: 'Edit files', detail: 'Change parts of an existing file' },
      { names: ['move_path'], title: 'Move & rename', detail: 'Reorganise files and folders' },
      { names: ['delete_path'], title: 'Delete files', detail: 'Remove files and folders' },
    ],
  },
  {
    title: 'Code',
    footer: 'Scripts run on this phone. The runtimes download on first use.',
    tools: [
      { names: ['run_python'], title: 'Python', detail: 'Data, charts, Office documents and PDFs' },
      { names: ['run_javascript'], title: 'JavaScript', detail: 'Scripts with npm packages' },
      { names: ['run_shell'], title: 'Shell', detail: 'Android shell utilities' },
      {
        names: ['job_output', 'job_kill'],
        title: 'Background jobs',
        detail: 'Run long scripts while the model keeps working',
      },
    ],
  },
  {
    title: 'Phone',
    footer:
      "Needs Clanker phone control turned on in Android's accessibility settings. What is on screen is sent to the model; a Stop button stays up while it works.",
    tools: [
      {
        names: [
          'phone_screen',
          'phone_tap',
          'phone_type',
          'phone_scroll',
          'phone_swipe',
          'phone_press',
          'phone_open_app',
          'phone_list_apps',
        ],
        title: 'Phone control',
        detail: 'Open apps, read the screen, tap, type and scroll',
      },
    ],
  },
  {
    title: 'Long chats',
    footer: 'Lets the model summarise older parts of a long chat to stay within its context budget. Past the auto-compression threshold, the app compresses history on its own either way.',
    tools: [
      { names: ['compress'], title: 'Compress history', detail: 'Summarise older messages to free up context' },
      { names: ['decompress'], title: 'Restore history', detail: 'Bring back messages it compressed' },
      { names: ['search_context'], title: 'Search history', detail: 'Find details in compressed messages' },
      { names: ['context_status'], title: 'Context status', detail: 'Check how much of the budget is used' },
    ],
  },
];

export const WEB_TOOLS: ToolEntry[] = [
  { names: ['web_search'], title: 'Web search', detail: 'Look things up with the search provider' },
  { names: ['web_fetch'], title: 'Read pages', detail: 'Open web pages and download files' },
];

/** On only in chats with memory on; listed on the memory screen rather than with the local tools. */
export const MEMORY_TOOLS: ToolEntry[] = [
  {
    names: ['memory_save', 'memory_update', 'memory_forget'],
    title: 'Let models save memories',
    detail: 'Models remember, correct and forget things as you chat',
  },
  { names: ['search_chats', 'read_chat'], title: 'Search past chats', detail: 'Models can look up and read your earlier chats' },
];

export const entryOn = (entry: ToolEntry, disabled: string[]) => !entry.names.some((n) => disabled.includes(n));
