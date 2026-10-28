import { requireOptionalNativeModule } from 'expo';

export type ShellResult = {
  stdout: string;
  stderr: string;
  /** -1 when the process was killed for running past its timeout. */
  exitCode: number;
  timedOut: boolean;
  /** True when stdout or stderr went past 256 KB and the rest was dropped. */
  truncated: boolean;
};

type ClankerShellModule = {
  exec(id: string, command: string, cwd: string, timeoutMs: number, env: Record<string, string>): Promise<ShellResult>;
  kill(id: string): void;
};

/** Null on iOS (apps there can't spawn processes) and in builds made before this module was added. */
export const ClankerShell = requireOptionalNativeModule<ClankerShellModule>('ClankerShell');
