import { useChats } from '@/store/chats';
import type { ToolOutcome } from './tools';
import { markObserved } from './tools/observe';

/**
 * Background jobs: scripts and shell commands the model started with `background: true`. They
 * outlive the reply that started them (not an app restart), and the model collects their results
 * with job_output. Each job also updates the tool row that started it.
 */

export type JobStatus = 'running' | 'done' | 'error' | 'killed';

type Job = {
  id: string;
  conversationId: string;
  messageId: string;
  toolId: string;
  tool: string;
  label: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  outcome?: ToolOutcome;
  /** Whether the model has read the result with job_output. */
  collected: boolean;
  controller: AbortController;
  done: Promise<void>;
};

const MAX_RUNNING = 4;
const jobs = new Map<string, Job>();

function newId() {
  for (;;) {
    const id = `j${Math.random().toString(36).slice(2, 6)}`;
    if (!jobs.has(id)) return id;
  }
}

export function runningJobs() {
  return [...jobs.values()].filter((j) => j.status === 'running').length;
}

/** Starts `run` detached and returns the job; throws when too many are running. */
export function startJob(opts: {
  conversationId: string;
  messageId: string;
  toolId: string;
  tool: string;
  label: string;
  run: (signal: AbortSignal, jobId: string) => Promise<ToolOutcome>;
}) {
  if (runningJobs() >= MAX_RUNNING) {
    throw new Error(`${MAX_RUNNING} background jobs are already running. Wait for one with job_output, or stop one with job_kill.`);
  }
  const controller = new AbortController();
  const id = newId();
  const job: Job = {
    id,
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    toolId: opts.toolId,
    tool: opts.tool,
    label: opts.label,
    status: 'running',
    startedAt: Date.now(),
    collected: false,
    controller,
    done: Promise.resolve(),
  };
  jobs.set(id, job);
  useChats.getState().patchTool(opts.conversationId, opts.messageId, opts.toolId, { background: { job: id, status: 'running' } });
  job.done = opts
    .run(controller.signal, id)
    .catch((e): ToolOutcome => ({ output: e instanceof Error ? e.message : String(e), isError: true }))
    .then((outcome) => {
      job.outcome = outcome;
      job.finishedAt = Date.now();
      if (job.status === 'running') job.status = outcome.isError ? 'error' : 'done';
      if (outcome.files?.length) markObserved(job.conversationId, outcome.files);
      useChats.getState().patchTool(job.conversationId, job.messageId, job.toolId, {
        background: { job: id, status: job.status, output: outcome.output },
        ...(outcome.files?.length ? { files: outcome.files } : {}),
      });
    });
  return job;
}

export function getJob(id: string) {
  return jobs.get(id);
}

export function killJob(id: string) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.status = 'killed';
  job.controller.abort();
  return true;
}

/** Resolves when the job finishes, or after `ms`, or when `signal` aborts. */
export function waitForJob(job: Job, ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      resolve();
    };
    signal.addEventListener('abort', stop);
    job.done.then(stop);
  });
}

function age(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function describeJob(job: Job) {
  const now = Date.now();
  const state =
    job.status === 'running'
      ? `running for ${age(now - job.startedAt)}`
      : `${job.status} after ${age((job.finishedAt ?? now) - job.startedAt)}, ${age(now - (job.finishedAt ?? now))} ago${job.collected ? '' : ', not collected yet'}`;
  return `${job.id} ${job.tool} "${job.label}": ${state}`;
}

/** Jobs started in a chat, newest first. Collected jobs that finished long ago are left out. */
export function jobsOf(conversationId: string) {
  const stale = Date.now() - 30 * 60_000;
  return [...jobs.values()]
    .filter((j) => j.conversationId === conversationId && !(j.collected && (j.finishedAt ?? Infinity) < stale))
    .sort((a, b) => b.startedAt - a.startedAt);
}
