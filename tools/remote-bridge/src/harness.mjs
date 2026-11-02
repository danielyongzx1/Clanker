import { randomUUID } from 'node:crypto';
import { addText, toolEvent, terminal } from './protocol.mjs';
import { acceptHarnessProjection, renderHarnessMetrics } from './harness-metrics.mjs';
import { harnessEndpoint } from './desktop-discovery.mjs';

const unwrap = (result) => { if (!result.ok) throw new Error(`Harness ${result.error.code}: ${result.error.message}`); return result.value; };

export function renderHarnessRun(run) {
  run.content = [];
  const events = Object.values(run.harnessEvents ?? {}).sort((a, b) => a.seq - b.seq);
  for (const event of events) {
    const data = event.data;
    if (event.type === 'assistant/message') {
      for (const block of data.message.content ?? []) {
        if (block.type === 'text') addText(run, block.text);
        if (block.type === 'reasoning') addText(run, block.text, 'thought');
      }
    }
    if (event.type === 'tool/call') {
      let input; try { input = JSON.parse(data.arguments); } catch { input = { arguments: data.arguments }; }
      toolEvent(run, { id: data.callId, name: data.name, input });
    }
    if (event.type === 'tool/result') {
      const message = data.message;
      toolEvent(run, { id: message.toolCallId, name: message.source?.toolName, error: message.isError, preview: (message.content ?? []).map((p) => p.text ?? '').join('\n') }, true);
    }
    if (event.type === 'turn/end') {
      const reason = data.reason?.kind;
      run.state = reason === 'completed' || reason === 'max-tokens' ? 'completed' : reason === 'aborted' ? 'cancelled' : 'failed';
      if (run.state === 'failed') run.error = data.reason?.error?.message ?? `Harness turn ended: ${reason}`;
    }
  }
  renderHarnessMetrics(run, events);
  if (!terminal(run.state)) for (const part of run.harnessLive ?? []) addText(run, part.text, part.type);
}

export class HarnessAdapter {
  constructor(config) { this.config = config; this.kind = 'harness'; this.pending = new Map(); this.active = new Map(); this.agents = new Map(); }
  async connect() {
    const operation = (this.connecting ?? Promise.resolve()).catch(() => {}).then(async () => {
      const endpoint = await harnessEndpoint(this.config);
      if (this.connection && this.endpointKey !== endpoint.key) { await this.close(); this.connection = undefined; this.ctx = undefined; this.agents.clear(); }
      if (!this.connection) {
        this.endpointKey = endpoint.key;
        this.connection = this.open(endpoint).catch((error) => { this.connection = undefined; throw error; });
      }
      return this.connection;
    });
    this.connecting = operation;
    return operation;
  }
  async modelCacheKey() { return (await harnessEndpoint(this.config)).key; }
  async open(endpoint) {
    const [{ Context }, registry, connection, gateway, { default: sessionRemote }, { default: WebSocket }] = await Promise.all([
      import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-typert-registry/client'),
      import('@deepseek-ai/dsh-client-connection/client'), import('@deepseek-ai/dsh-api-gateway/client'),
      import('@deepseek-ai/dsh-api-session-controller/remote'), import('ws'),
    ]);
    const base = endpoint.url.replace(/\/+$/, '') + '/';
    const response = await fetch(`${base}connect?token=${encodeURIComponent(endpoint.token)}&interactions=answer`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const cookie = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    if (response.status !== 302 || !cookie) throw new Error('Harness API pairing failed. Use the launch token from dsh web --no-open; this bridge supports Harness 0.2.1-rc.5.');
    const ctx = new Context();
    registry.apply(ctx);
    connection.installConnection(ctx, { interactions: 'answer', transport: {
      streamBaseUrl: base,
      fetch: (route, init) => fetch(new URL(route.replace(/^\//, ''), base), { ...init, headers: { ...init.headers, Cookie: cookie } }),
      createWebSocket: (url) => new WebSocket(url, { headers: { Cookie: cookie } }),
    } });
    ctx.typert.contexts.registerClient('agent', {
      identity: (agent) => agent.clankerSessionId,
      resolve: (id) => {
        if (!this.agents.has(id)) this.agents.set(id, ctx.extend({ clankerSessionId: id }));
        return this.agents.get(id);
      },
    });
    gateway.apply(ctx);
    await ctx.remote.$mount(sessionRemote);
    ctx.remote.$on('approval/request', (request, next) => this.control(request, 'approval', next));
    ctx.remote.$on('user-questions/request', (request, next) => this.control(request, 'clarification', next));
    this.ctx = ctx;
    return ctx.remote;
  }
  async models() {
    const remote = await this.connect();
    const catalog = unwrap(await remote.session.modelCatalog());
    if (!Array.isArray(catalog.groups)) throw new Error('Unsupported Harness model catalog. Use the documented compatible release 0.2.1-rc.5.');
    this.modelRoutes = new Map(catalog.groups.flatMap((group) => group.models.map((model) => [`${group.id}/${model.id}`, { provider: group.id, model: model.id }])));
    this.modelOptions = Object.fromEntries(catalog.groups.flatMap((group) => group.models.map((model) => [`${group.id}/${model.id}`, {
      efforts: (model.reasoning?.efforts ?? []).map((entry) => entry.id),
      ...(model.reasoning?.defaultEffort ? { defaultEffort: model.reasoning.defaultEffort } : {}),
    }])));
    return [...this.modelRoutes.keys()];
  }
  async ensureSession(session) {
    const remote = await this.connect();
    const created = unwrap(await remote.session.create({ sessionId: session.upstreamCandidate ?? session.id, cwd: session.workspace }));
    if (!this.modelRoutes) await this.models();
    const selected = this.modelRoutes.get(session.model);
    if (!selected) throw new Error('Harness model is unavailable.');
    unwrap(await remote.session.selectModel({ sessionId: created.sessionId, ...selected }));
    return created.sessionId;
  }
  async start(run, session, update) {
    const remote = await this.connect();
    if (!this.modelRoutes) await this.models();
    const selected = this.modelRoutes.get(session.model);
    if (!selected) throw new Error('Harness model is unavailable.');
    // Effort belongs to the frozen submission, not a later change to the phone's slider.
    unwrap(await remote.session.selectModel({ sessionId: session.upstreamId, ...selected, ...(run.effort ? { reasoningEffort: run.effort } : {}) }));
    const opening = remote.session.follow({ address: { kind: 'session', sessionId: session.upstreamId }, maxMessages: 10 });
    try {
      for await (const frame of opening) { if (frame.type === 'snapshot') { run.harnessAfter = frame.cursor; acceptHarnessProjection(run, frame.projections); break; } }
    } finally { opening.dispose(); }
    this.active.set(session.upstreamId, { run, update });
    // Generated prompt requestId is durable and deduplicated by Harness itself.
    unwrap(await remote.session.prompt({ sessionId: session.upstreamId, requestId: run.id, mode: 'queue', content: [{ type: 'text', text: `${session.instructions ? `Project instructions:\n${session.instructions}\n\n` : ''}${run.input}` }] }));
    return session.upstreamId;
  }
  async observe(run, update, signal) {
    const remote = await this.connect();
    const context = this.ctx;
    this.active.set(run.upstreamId, { run, update });
    const stopping = new AbortController();
    const combined = AbortSignal.any([signal, stopping.signal]);
    const request = { address: { kind: 'session', sessionId: run.upstreamId }, maxMessages: 500, assistantStream: true };
    const stream = remote.session.follow(request, combined);
    let pending = Promise.resolve();
    const consume = (frame) => {
      const operation = pending.then(async () => {
        let projection;
        if (frame.type === 'event' && ['assistant/message', 'assistant/attempt', 'turn/end', 'request/context'].includes(frame.event.type)) {
          projection = unwrap(await remote.session.projections({ sessionId: run.upstreamId }));
        }
        await update((r) => {
          r.error = undefined;
          if (projection) acceptHarnessProjection(r, projection);
          r.harnessEvents ??= {};
          const accept = (record) => {
            const event = record.event;
            if (event && event.seq > (r.harnessAfter ?? Infinity)) {
              r.harnessEvents[event.seq] = event;
              if (event.type === 'assistant/message') r.harnessLive = [];
            }
          };
          if (frame.type === 'snapshot') {
            acceptHarnessProjection(r, frame.projections);
            r.harnessLive = [];
            for (const record of frame.records) accept(record);
            const attempt = frame.assistantStream?.activeAttempt;
            if (attempt && attempt.startedAfterSeq >= r.harnessAfter) {
              for (const record of attempt.stream) {
                if (record.type === 'text-chunks' || record.type === 'reasoning-chunks') r.harnessLive.push({ type: record.type === 'text-chunks' ? 'text' : 'thought', text: record.texts.join('') });
              }
            }
          }
          if (frame.type === 'event') accept(frame);
          if (frame.type === 'assistant-stream') {
            const live = frame.frame;
            if (live.type === 'start' || live.type === 'end') r.harnessLive = [];
            if (live.type === 'chunk' && ['text-delta', 'reasoning-delta'].includes(live.chunk.type)) (r.harnessLive ??= []).push({ type: live.chunk.type === 'text-delta' ? 'text' : 'thought', text: live.chunk.text });
          }
          renderHarnessRun(r);
        });
      });
      pending = operation.catch(() => {});
      return operation;
    };
    // Some Desktop generations deliver live chunks but miss the final journal
    // notification. A fresh read repairs the cursor without submitting a prompt.
    const pause = () => new Promise((resolve) => {
      const done = () => { clearTimeout(timer); combined.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Math.max(100, this.config.harnessReconcileMs ?? 5000));
      if (combined.aborted) done(); else combined.addEventListener('abort', done, { once: true });
    });
    let reconcileError;
    const reconciling = (async () => {
      while (!combined.aborted && !terminal(run.state)) {
        await pause(); if (combined.aborted) return;
        const opening = remote.session.follow(request, combined);
        try {
          for await (const frame of opening) {
            if (frame.type !== 'snapshot') continue;
            await consume(frame);
            if (terminal(run.state)) stopping.abort();
            break;
          }
        } finally { opening.dispose(); }
      }
    })().catch((error) => { if (!combined.aborted) { reconcileError = error; stopping.abort(); } });
    try {
      for await (const frame of stream) {
        await consume(frame);
        if (terminal(run.state)) return;
      }
      if (reconcileError) throw reconcileError;
    } catch (error) {
      if (terminal(run.state)) return;
      if (!signal.aborted && this.ctx === context) { await this.close(); this.connection = undefined; this.ctx = undefined; }
      throw reconcileError ?? error;
    } finally { stopping.abort(); stream.dispose(); await reconciling; this.active.delete(run.upstreamId); }
  }
  async control(request, kind, next) {
    const current = this.active.get(request.agent?.clankerSessionId);
    if (!current) return next();
    if (kind === 'clarification') {
      const questions = request.questions ?? [];
      const answers = await Promise.all(questions.map((question) => this.ask(current, request, {
        id: randomUUID(), kind: question.intent?.kind === 'approval' ? 'approval' : 'clarification',
        prompt: `${question.question}${question.detail ? '\n\n' + question.detail : ''}`,
        choices: question.options?.map((option) => option.label),
      }).then((answer) => ({ id: question.id, selected: question.options?.some((option) => option.label === answer) ? [answer] : [], ...(question.options?.some((option) => option.label === answer) ? {} : { custom: answer }) }))));
      return { answers };
    }
    return this.ask(current, request, { id: randomUUID(), kind: 'approval', prompt: request.reason ?? request.toolName ?? 'Remote tool requests approval', choices: ['once', 'deny'] });
  }
  ask(current, request, control) {
    const kind = control.kind;
    const id = control.id;
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return; settled = true;
        this.pending.delete(id); request.signal?.removeEventListener('abort', cancelled);
        void current.update((r) => { r.controls = r.controls.filter((c) => c.id !== id); if (!terminal(r.state)) r.state = r.controls.length ? 'waiting' : 'running'; });
        resolve(value);
      };
      const cancelled = () => { if (kind === 'approval') settle('cancelled'); else { this.pending.delete(id); reject(new Error('Harness question cancelled.')); } };
      this.pending.set(id, { runId: current.run.id, settle, kind, directApproval: !request.questions });
      request.signal?.addEventListener('abort', cancelled, { once: true });
      void current.update((r) => {
        r.state = 'waiting';
        r.controls.push(control);
      });
      if (request.signal?.aborted) cancelled();
    });
  }
  async stop(run) { unwrap(await (await this.connect()).session.cancel({ sessionId: run.upstreamId })); }
  async respond(run, control, answer) {
    const pending = this.pending.get(control.id);
    if (!pending || pending.runId !== run.id) throw Object.assign(new Error('This prompt is no longer current. Reconnect to refresh it.'), { status: 409 });
    pending.settle(pending.directApproval ? answer === 'once' ? 'allowed-once' : 'rejected' : answer);
  }
  async close() { if (this.ctx) await this.ctx.fiber.dispose(); }
}
