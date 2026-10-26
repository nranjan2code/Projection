// vak host: the HTTP + SSE API that runs the agent loop for a UI, on Node
// built-ins only. Any app can mount it: the playground serves it on a fixed
// loopback port, the desktop app runs it as a sidecar behind a token.
//
// Routes (all JSON unless noted):
//   GET  /api/providers                  provider list, availability, default model
//   GET  /api/models?provider=           installed / listed models
//   GET  /api/profile?provider=&model=   capability profile and plan
//   POST /api/chat                       one turn (message or ui action), SSE of AgentEvents
//   POST /api/calibrate                  calibration run, SSE progress
//   POST /api/project                    apply a vak_* call from an outside agent
//   GET  /api/actions?session=&timeout=  long-poll actions on outside surfaces
//   GET  /api/events?session=            SSE of outside projections
//   GET  /api/sessions                   saved conversations
//   GET  /api/sessions/<id>              one conversation: timeline + surfaces
//   DELETE /api/sessions/<id>, POST /api/reset

import { timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { basicCatalog, type AgentEvent, type Catalog, encodeSse, formatDiagnostics, projectText, type SurfaceSnapshot, SurfaceStore, type VpsAction } from "@vak/core";
import {
  actionMessage,
  type CompletionCheck,
  type SurfaceCheck,
  calibrate,
  CALIBRATION_CASES,
  choosePlan,
  type Message,
  type ProfileCache,
  type ProjectionConfig,
  type AgentTool,
  type ProjectionPlan,
  type ProviderEntry,
  resolveProfile,
  runAgent,
  type RunResult,
} from "@vak/providers";

/** What a UI needs to redraw a conversation: one entry per bubble. */
export type TimelineEntry =
  | { kind: "user"; text: string; at: string }
  | { kind: "action"; action: string; at: string }
  | { kind: "assistant"; text: string; surfaces: string[]; notes: { name: string; result: string }[]; status: string; error?: boolean; at: string; used?: { name: string; ok: boolean }[]; stop?: string; limit?: "steps" | "tools"; versions?: SurfaceSnapshot[] };

export interface SessionSummary {
  id: string;
  title: string;
  updated: string;
  /** Lightweight discovery: no messages, surface data or form values. */
  surfaceSummaries?: SurfaceSummary[];
  /** A turn is running (it keeps running with no window attached). */
  running?: boolean;
}

export interface SurfaceSummary { id: string; title?: string; types: string[] }

function surfaceSummary(s: { id: string; title?: string }, nodes: Iterable<{ type: string }>): SurfaceSummary {
  return { id: s.id, title: s.title, types: [...new Set([...nodes].map((n) => n.type))] };
}

export interface SessionView extends SessionSummary {
  timeline: TimelineEntry[];
  surfaces: SurfaceSnapshot[];
  /** The reply so far of the running turn, so a reopened chat shows it at once. */
  pending?: { text: string; surfaces: string[] };
}

export interface HostOptions {
  /** Read on every request, so key changes apply without a restart. */
  providers: () => ProviderEntry[];
  profiles: ProfileCache;
  /** System instructions for the agent; a function is re-read per turn (dates). */
  instructions: string | (() => string);
  catalog?: Catalog;
  /** Directory for per-session .jsonl transcripts of raw model output; none: not recorded. */
  transcripts?: string;
  /** Directory where conversations are saved and reloaded; none: memory only. */
  sessionsDir?: string;
  /** Bearer token every /api request must carry; none: open (loopback-only servers). */
  token?: string;
  /** Host header names accepted (default: loopback names only). */
  hosts?: string[];
  /** Origins allowed to call from another origin (a desktop webview). */
  origins?: string[];
  /** Viewer link returned to outside agents by /api/project. */
  viewerUrl?: (session: string) => string;
  /**
   * Tools beyond vak_* for a turn (MCP integrations, built-ins). Read per turn,
   * so enabling or disabling one applies to the next message.
   */
  tools?: (ctx: { session: string }) => Promise<AgentTool[]> | AgentTool[];
  /** Optional application ownership policy for HTTP session mutations; trusted run() is unaffected. */
  allowSessionMutation?: (session: string) => boolean;
  /** App-specific routes, run after auth; return true when handled. */
  routes?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
  log?: (line: string) => void;
}

interface Session {
  id: string;
  title: string;
  created: string;
  updated: string;
  messages: Message[];
  timeline: TimelineEntry[];
  store: SurfaceStore;
  busy?: AbortController;
  /** The running turn's reply so far. */
  pending?: Extract<TimelineEntry, { kind: "assistant" }>;
  /** Live viewers (GET /api/events) for projections pushed via /api/project. */
  viewers: Set<(e: AgentEvent) => void>;
  /** Surfaces owned by an outside caller: their actions queue here instead of running the model. */
  external: Set<string>;
  inbox: VpsAction[];
  waiters: Set<() => void>;
}

interface SavedSession {
  id: string;
  title: string;
  created: string;
  updated: string;
  messages: Message[];
  timeline: TimelineEntry[];
  surfaces: SurfaceSnapshot[];
  external: string[];
}

/** Trusted in-process execution; transport controls never come from a chat request body. */
export interface HostTurn {
  session: string;
  provider: string;
  model: string;
  message?: string;
  action?: { surface: string; source: string; data: Record<string, unknown> };
  /** Carry on the chat's last turn (one a budget ended) with no new user message. */
  continue?: boolean;
  think?: boolean;
  schemaMode?: string;
  generation?: string;
  effort?: string;
  history?: number;
}

export interface HostRunOptions {
  validateCompletion?: CompletionCheck;
  validateEdits?: SurfaceCheck;
  completion?: "projection" | "response";
  signal?: AbortSignal;
  emit?: (event: AgentEvent) => void;
  tools?: AgentTool[];
  instructions?: string;
  maxSteps?: number;
  /** Integration rounds per turn (default TOOL_ROUNDS), apart from maxSteps. */
  toolRounds?: number;
  maxTokens?: number;
}

export interface VakHost {
  /** Runs on the canonical session/store, independent of any UI connection. Busy sessions reject. */
  run(input: HostTurn, options?: HostRunOptions): Promise<RunResult>;
  /** A detached copy of the canonical view; never exposes mutable session internals. */
  view(id: string): Promise<SessionView>;
  /** Delete an idle session and its raw transcript; running sessions must be stopped first. */
  remove(id: string): Promise<void>;
  /** Handle a request; false when the path is not the host's (serve it yourself). */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /**
   * Ask the user before a tool runs: sends an approval event to the client
   * running the turn and waits for POST /api/approvals/<id>. No answer within
   * five minutes, or the turn stopping, counts as no.
   */
  approve(req: { id: string; server: string; tool: string; title: string; args: unknown }, emit?: (e: AgentEvent) => void, signal?: AbortSignal): Promise<"allow" | "allow-chat" | "deny">;
}

/** Configurations calibration measures for a provider. */
function calibrationConfigs(constrained: boolean): ProjectionConfig[] {
  const configs: ProjectionConfig[] = [
    { generation: "tools", tier: "extended", examples: false, authoring: "inline" },
    { generation: "tools", tier: "core", examples: true, authoring: "inline" },
  ];
  if (constrained) configs.push({ generation: "constrained", tier: "core", examples: true });
  return configs;
}

export async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Host names a loopback server answers to; anything else is a rebinding DNS name. */
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

function sameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Saved sessions kept in memory at once; the rest reload from disk when opened. */
const MAX_LOADED = 24;

const safeId = (id: string) => id.replace(/[^\w-]/g, "_").slice(0, 120) || "default";
const now = () => new Date().toISOString();
const titleOf = (text: string) => (text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text);

export function createHost(opts: HostOptions): VakHost {
  const catalog = opts.catalog ?? basicCatalog;
  const log = opts.log ?? ((line: string) => console.log(line));
  const sessions = new Map<string, Session>();
  const detached = new Map<string, AbortController>();
  const instructions = () => (typeof opts.instructions === "function" ? opts.instructions() : opts.instructions);
  const provider = (id: unknown) => opts.providers().find((p) => p.id === id);
  const approvals = new Map<string, (d: "allow" | "allow-chat" | "deny") => void>();

  function approve(req: { id: string; server: string; tool: string; title: string; args: unknown }, emit?: (e: AgentEvent) => void, signal?: AbortSignal): Promise<"allow" | "allow-chat" | "deny"> {
    // Without a client to ask there is nobody to say yes; a stopped turn says no.
    if (!emit || signal?.aborted) return Promise.resolve("deny");
    return new Promise((resolve) => {
      const done = (d: "allow" | "allow-chat" | "deny") => {
        if (!approvals.has(req.id)) return;
        approvals.delete(req.id);
        clearTimeout(timer);
        emit({ type: "approval_done", id: req.id, decision: d === "deny" ? "deny" : "allow" });
        resolve(d);
      };
      const timer = setTimeout(() => done("deny"), 5 * 60_000);
      approvals.set(req.id, done);
      signal?.addEventListener("abort", () => done("deny"), { once: true });
      emit({ type: "approval", id: req.id, tool: req.tool, server: req.server, title: req.title, args: req.args });
    });
  }

  // --- sessions ---------------------------------------------------------------
  const sessionFile = (id: string) => path.join(opts.sessionsDir!, `${safeId(id)}.json`);

  async function session(id: string): Promise<Session> {
    let s = sessions.get(id);
    if (s) {
      // Most recently used last, so eviction takes the stalest.
      sessions.delete(id);
      sessions.set(id, s);
      return s;
    }
    const at = now();
    s = { id, title: "New chat", created: at, updated: at, messages: [], timeline: [], store: new SurfaceStore(catalog), viewers: new Set(), external: new Set(), inbox: [], waiters: new Set() };
    if (opts.sessionsDir) {
      try {
        const saved = JSON.parse(await readFile(sessionFile(id), "utf8")) as SavedSession;
        Object.assign(s, { title: saved.title, created: saved.created, updated: saved.updated, messages: saved.messages, timeline: saved.timeline, external: new Set(saved.external) });
        for (const snap of saved.surfaces) s.store.load(snap);
      } catch {
        /* new session */
      }
    }
    // Another request may have created it while the file was read.
    const raced = sessions.get(id);
    if (raced) return raced;
    sessions.set(id, s);
    evict();
    return s;
  }

  /**
   * Saved sessions reload from disk, so only the most recent stay in memory.
   * One with a turn running, a viewer, a waiting agent or queued actions stays.
   */
  function evict(): void {
    if (!opts.sessionsDir) return;
    for (const [id, s] of sessions) {
      if (sessions.size <= MAX_LOADED) break;
      if (!s.busy && !s.viewers.size && !s.waiters.size && !s.inbox.length) sessions.delete(id);
    }
  }

  async function save(s: Session, strict = false): Promise<void> {
    if (!opts.sessionsDir || !s.timeline.length) return;
    const saved: SavedSession = {
      id: s.id,
      title: s.title,
      created: s.created,
      updated: s.updated,
      messages: s.messages,
      timeline: keepVersions(s.timeline),
      surfaces: s.store.list().map((st) => s.store.snapshot(st.id)!),
      external: [...s.external],
    };
    try {
      await mkdir(opts.sessionsDir, { recursive: true });
      // Write then rename, so a crash mid-write never leaves half a conversation.
      const file = sessionFile(s.id);
      await writeFile(`${file}.tmp`, JSON.stringify(saved));
      await rename(`${file}.tmp`, file);
      (await summaries()).set(s.id, { id: s.id, title: s.title, updated: s.updated, surfaceSummaries: saved.surfaces.map((snap) => surfaceSummary(snap, snap.nodes)) });
    } catch (err) {
      log(`session not saved: ${(err as Error).message}`);
      if (strict) throw err;
    }
  }

  /**
   * Summaries of saved sessions, read from disk once and then kept current by
   * save and delete, so the list is not re-read (messages and all) per request.
   */
  let index: Promise<Map<string, SessionSummary>> | undefined;
  function summaries(): Promise<Map<string, SessionSummary>> {
    index ??= (async () => {
      const out = new Map<string, SessionSummary>();
      if (!opts.sessionsDir) return out;
      let files: string[] = [];
      try {
        files = (await readdir(opts.sessionsDir)).filter((f) => f.endsWith(".json"));
      } catch {
        /* none saved yet */
      }
      for (const f of files) {
        try {
          const saved = JSON.parse(await readFile(path.join(opts.sessionsDir, f), "utf8")) as SavedSession;
          out.set(saved.id, { id: saved.id, title: saved.title, updated: saved.updated, surfaceSummaries: (saved.surfaces ?? []).map((snap) => surfaceSummary(snap, snap.nodes)) });
        } catch {
          /* unreadable file: skip it */
        }
      }
      return out;
    })();
    return index;
  }

  async function listSessions(): Promise<SessionSummary[]> {
    const out = new Map(await summaries());
    for (const s of sessions.values()) if (s.timeline.length) out.set(s.id, {
      id: s.id, title: s.title, updated: s.updated,
      surfaceSummaries: s.store.list().map((st) => surfaceSummary(st, st.nodes.values())),
      ...(s.busy ? { running: true } : {}),
    });
    return [...out.values()].sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async function dropSession(id: string): Promise<void> {
    if (sessions.get(id)?.busy) throw new Error("stop the running session before deleting it");
    sessions.delete(id);
    (await summaries()).delete(id);
    if (opts.sessionsDir) {
      await rm(sessionFile(id), { force: true });
      await rm(`${sessionFile(id)}.tmp`, { force: true });
    }
    if (opts.transcripts) await rm(path.join(opts.transcripts, `${safeId(id)}.jsonl`), { force: true });
  }

  /** Each turn's messages and raw tool calls, per session, for diagnosing model output. */
  async function record(sessionId: string, messages: Message[]): Promise<void> {
    if (!opts.transcripts) return;
    try {
      await mkdir(opts.transcripts, { recursive: true });
      const at = now();
      const lines = messages.map((m) => JSON.stringify({ at, role: m.role, content: m.content, toolCalls: m.toolCalls, isError: m.isError }));
      await appendFile(path.join(opts.transcripts, `${safeId(sessionId)}.jsonl`), lines.map((l) => `${l}\n`).join(""));
    } catch (err) {
      log(`transcript not written: ${(err as Error).message}`);
    }
  }

  /** Profile + plan for a provider/model; errors surface as a reason, never a guess. */
  async function planFor(providerId: string, model: string): Promise<{ plan?: ProjectionPlan; profile?: unknown; error?: string }> {
    const entry = provider(providerId);
    if (!entry?.available) return { error: `provider ${providerId} unavailable` };
    try {
      const profile = await resolveProfile(entry.id, entry.make(), model, opts.profiles, AbortSignal.timeout(8000));
      return { profile, plan: choosePlan(profile) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  // --- chat -------------------------------------------------------------------
  async function executeTurn(body: HostTurn, s: Session, ctrl: AbortController, controls: HostRunOptions, broadcast: boolean): Promise<RunResult> {
    const entry = provider(body.provider);
    if (!entry?.available) throw new Error(`provider ${body.provider} unavailable`);
    if (!body.model) throw new Error("model required");
    const reply: Extract<TimelineEntry, { kind: "assistant" }> = { kind: "assistant", text: "", surfaces: [], notes: [], status: "", at: now() };
    s.pending = reply;
    const emit = (e: AgentEvent) => {
      // The timeline mirrors what the client draws, so a reopened chat looks the same.
      if (e.type === "text_delta") reply.text += e.delta;
      else if (e.type === "surface" && !reply.surfaces.includes(e.snapshot.id)) reply.surfaces.push(e.snapshot.id);
      // Integration tools are recorded by name only: their output can be long or private.
      else if (e.type === "tool_end" && !e.name.startsWith("vak_")) (reply.used ??= []).push({ name: e.name, ok: !e.isError });
      else if (e.type === "tool_end" && (e.isError || e.result !== "ok")) reply.notes.push({ name: e.name, result: e.result });
      else if (e.type === "error") Object.assign(reply, { status: e.message, error: true });
      controls.emit?.(e);
      if (broadcast) for (const viewer of s.viewers) viewer(e);
    };

    if (body.action && typeof body.action === "object") {
      const { surface, source, data } = body.action;
      if (data && typeof data === "object") s.store.setData(String(surface), data);
      const result = s.store.submit(String(surface), String(source), "web");
      if (!result.action) {
        emit({ type: "error", message: `action rejected: ${JSON.stringify(result.errors)}` });
        emit({ type: "run_end", stop: "error" });
        return { stop: "error" };
      }
      s.timeline.push({ kind: "action", action: result.action.action, at: now() });
      if (s.external.has(result.action.surface)) {
        // Projected by an outside agent: hand the action to it (GET /api/actions).
        s.inbox.push(result.action);
        for (const wake of s.waiters) wake();
        emit({ type: "text_delta", delta: "Sent to the agent that projected this surface." });
        emit({ type: "run_end", stop: "delivered" });
        s.timeline.push({ ...reply, status: "delivered" });
        await save(s, broadcast);
        return { stop: "delivered" };
      }
      s.messages.push(actionMessage(result.action));
    } else if (body.continue === true) {
      // Engine feedback continues the current turn rather than starting one, so the history window keeps its results.
      if (!s.messages.length) {
        emit({ type: "error", message: "nothing to continue" });
        return { stop: "error" };
      }
      s.messages.push({ role: "user", content: "[engine] The user asked to continue. Carry on from the results above toward the original request; repeat a tool call only if its result is missing." });
    } else {
      const text = String(body.message ?? "").trim();
      if (!text) {
        emit({ type: "error", message: "empty message" });
        return { stop: "error" };
      }
      if (!s.timeline.length) s.title = titleOf(text);
      s.timeline.push({ kind: "user", text, at: now() });
      s.messages.push({ role: "user", content: text });
    }

    // The capability policy picks how to ask this model; explicit options still win.
    const planned = await planFor(entry.id, body.model);
    if (planned.plan) {
      const { generation, tier, examples, authoring, maxSteps, reasons } = planned.plan;
      emit({ type: "plan", generation, tier, examples, authoring, maxSteps, reasons });
    }

    const tools = controls.tools ?? (await opts.tools?.({ session: s.id })) ?? [];
    const started = Date.now();
    const from = s.messages.length - 1;
    const result = await runAgent({
      plan: planned.plan,
      provider: entry.make({ think: Boolean(body.think) }),
      model: body.model,
      store: s.store,
      messages: s.messages,
      emit,
      instructions: controls.instructions ?? instructions(),
      completion: controls.completion,
      validateCompletion: controls.validateCompletion,
      validateEdits: controls.validateEdits,
      maxSteps: controls.maxSteps,
      toolRounds: controls.toolRounds,
      maxTokens: controls.maxTokens,
      schemaMode: body.schemaMode === "strict" ? "strict" : "compact",
      // Grammar-constrained output cannot call other tools; integrations need tool calling.
      generation: tools.length || controls.completion === "response" ? "tools" : body.generation === "tools" || body.generation === "constrained" ? body.generation : "auto",
      tools,
      effort: body.effort === "low" || body.effort === "medium" || body.effort === "high" ? body.effort : undefined,
      history: typeof body.history === "number" && body.history > 0 ? body.history : undefined,
      signal: ctrl.signal,
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log(`[chat] ${entry.id}/${body.model} → ${result.stop} in ${secs}s`);
    if (!reply.error) reply.status = `${entry.id} · ${body.model} · ${secs}s${result.limit === "steps" ? " · step limit" : result.limit === "tools" ? " · tool budget" : ""}`;
    reply.stop = result.stop;
    if (result.limit) reply.limit = result.limit;
    // Each surface as this reply left it: a later reply that rewrites it in
    // place would otherwise leave no way back to what this one showed.
    const versions = reply.surfaces.flatMap((id) => s.store.snapshot(id) ?? []);
    if (versions.length) reply.versions = versions;
    s.timeline.push(reply);
    s.updated = now();
    await record(s.id, s.messages.slice(from));
    await save(s, broadcast);
    return result;
  }

  async function run(input: HostTurn, controls: HostRunOptions = {}): Promise<RunResult> {
    const s = await session(input.session);
    if (s.busy) throw new Error("session already running");
    const ctrl = new AbortController();
    const abort = () => ctrl.abort(controls.signal?.reason);
    if (controls.signal?.aborted) throw new Error("run cancelled");
    controls.signal?.addEventListener("abort", abort, { once: true });
    s.busy = ctrl;
    detached.set(s.id, ctrl);
    try { return await executeTurn(input, s, ctrl, controls, true); }
    finally {
      if (detached.get(s.id) === ctrl) detached.delete(s.id);
      s.pending = undefined;
      controls.signal?.removeEventListener("abort", abort);
      if (s.busy === ctrl) s.busy = undefined;
    }
  }

  async function view(id: string): Promise<SessionView> {
    const s = await session(id);
    return structuredClone({
      id: s.id, title: s.title, updated: s.updated, timeline: s.timeline, surfaces: s.store.list().map((st) => s.store.snapshot(st.id)!),
      ...(s.busy ? { running: true, ...(s.pending ? { pending: { text: s.pending.text, surfaces: s.pending.surfaces } } : {}) } : {}),
    });
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const entry = provider(body.provider);
    if (!entry?.available) return json(res, 400, { error: `provider ${body.provider} unavailable` });
    if (typeof body.model !== "string" || !body.model) return json(res, 400, { error: "model required" });
    const s = await session(String(body.session ?? "default"));
    // HTTP callers cannot take over an independently running session.
    if (detached.has(s.id) || opts.allowSessionMutation?.(s.id) === false) return json(res, 409, { error: "session is managed by another execution owner" });
    s.busy?.abort();
    const ctrl = new AbortController();
    s.busy = ctrl;
    // The window that started the turn may leave (another chat, a closed
    // window): the turn keeps running and its events go to the chat's viewers
    // (/api/events) instead. Stopping is explicit: POST /api/sessions/:id/stop.
    let attached = true, ended = false;
    res.on("close", () => { if (!res.writableFinished) attached = false; });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const emit = (e: AgentEvent) => {
      if (e.type === "run_end") ended = true;
      if (attached) res.write(encodeSse(e));
      else for (const viewer of s.viewers) viewer(e);
    };
    try { await executeTurn({ ...body, session: s.id } as HostTurn, s, ctrl, { emit }, false); }
    finally {
      if (s.busy === ctrl) s.busy = undefined;
      s.pending = undefined;
      res.end();
      // Viewers learn the chat changed (title, timeline) when the turn ends.
      if (!attached && !ended) for (const viewer of s.viewers) viewer({ type: "run_end", stop: ctrl.signal.aborted ? "aborted" : "error" });
    }
  }

  // --- calibration ------------------------------------------------------------
  async function handleCalibrate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const entry = provider(body.provider);
    if (!entry?.available || typeof body.model !== "string") return json(res, 400, { error: "provider/model required" });
    const p = entry.make();
    const profile = await resolveProfile(entry.id, p, body.model, opts.profiles);
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) ctrl.abort();
    });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const configs = calibrationConfigs(Boolean(p.capabilities?.constrainedOutput));
    send("start", { calls: configs.length * CALIBRATION_CASES.length, configs });
    try {
      const calibration = await calibrate({ provider: p, model: body.model, fingerprint: profile.facts.fingerprint, configs, signal: ctrl.signal, onCase: (o) => send("case", o) });
      opts.profiles.update(entry.id, body.model, { calibration });
      const plan = choosePlan({ ...profile, calibration });
      log(`[calibrate] ${entry.id}/${body.model}: ${calibration.results.map((r) => `${r.complete}/${r.runs}`).join(" ")}`);
      send("done", { calibration, plan });
    } catch (err) {
      send("error", { message: (err as Error).message });
    }
    res.end();
  }

  // --- outside agents ---------------------------------------------------------
  async function handleProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const sessionId = String(body.session ?? "default");
    if (detached.has(sessionId) || opts.allowSessionMutation?.(sessionId) === false) return json(res, 409, { error: "session is managed by another execution owner" });
    const s = await session(sessionId);
    const tool = String(body.tool ?? "vak_render");
    const diagnostics = s.store.apply(tool, body.args ?? {});
    const id = String((body.args as { surface?: unknown } | undefined)?.surface ?? "main");
    s.external.add(id);
    const snap = s.store.snapshot(id);
    if (snap && !s.timeline.some((t) => t.kind === "assistant" && t.surfaces.includes(id))) {
      if (!s.timeline.length) s.title = snap.title ?? id;
      s.timeline.push({ kind: "assistant", text: "", surfaces: [id], notes: [], status: "projected via /api/project", at: now() });
    }
    s.updated = now();
    await save(s);
    const event: AgentEvent = snap ? { type: "surface", snapshot: snap } : { type: "surface_removed", id };
    for (const v of s.viewers) v(event);
    const resolved = s.store.resolve(id);
    json(res, 200, {
      result: formatDiagnostics(diagnostics),
      diagnostics,
      viewers: s.viewers.size,
      surface: id,
      // What the user sees, so the caller can verify its own output.
      text: resolved ? projectText(resolved) : "",
      url: opts.viewerUrl?.(sessionId),
    });
  }

  async function handleActions(res: ServerResponse, url: URL): Promise<void> {
    const s = await session(url.searchParams.get("session") ?? "default");
    const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 0), 600) * 1000;
    const only = url.searchParams.get("surface");
    const matches = (a: VpsAction) => !only || a.surface === only;
    if (!s.inbox.some(matches) && timeout > 0) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          s.waiters.delete(wake);
          resolve();
        };
        // Wake only for actions this caller is waiting for.
        const wake = () => {
          if (s.inbox.some(matches)) finish();
        };
        const timer = setTimeout(finish, timeout);
        s.waiters.add(wake);
        res.on("close", finish);
      });
    }
    const taken = s.inbox.filter(matches);
    s.inbox = s.inbox.filter((a) => !matches(a));
    json(res, 200, { actions: taken });
  }

  async function handleEvents(res: ServerResponse, url: URL): Promise<void> {
    const s = await session(url.searchParams.get("session") ?? "default");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.flushHeaders();
    const send = (e: AgentEvent) => res.write(encodeSse(e));
    for (const st of s.store.list()) send({ type: "surface", snapshot: s.store.snapshot(st.id)! });
    s.viewers.add(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    res.on("close", () => {
      clearInterval(ping);
      s.viewers.delete(send);
    });
  }

  // --- access -----------------------------------------------------------------
  /**
   * Who may call. A loopback server is still reachable from every web page the
   * user has open: a page can POST to 127.0.0.1 with a text/plain body (no
   * preflight) and spend the user's keys, and a rebinding DNS name can make a
   * page same-origin with it. So the Host header must name an allowed host, a
   * browser's Origin must be this server or a listed one, and request bodies
   * must be JSON, which forces a preflight that unlisted origins fail.
   */
  function admit(req: IncomingMessage, res: ServerResponse): boolean {
    const host = req.headers.host ?? "";
    if (!(opts.hosts ?? LOOPBACK).includes(host.replace(/:\d+$/, ""))) {
      json(res, 403, { error: "host not allowed" });
      return false;
    }
    const origin = req.headers.origin;
    const listed = origin !== undefined && Boolean(opts.origins?.includes(origin));
    if (origin && !listed && !sameOrigin(origin, host)) {
      json(res, 403, { error: "origin not allowed" });
      return false;
    }
    if (listed) {
      res.setHeader("access-control-allow-origin", origin!);
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE");
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return false;
    }
    if ((req.method === "POST" || req.method === "PUT") && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      json(res, 415, { error: "send JSON (content-type: application/json)" });
      return false;
    }
    if (opts.token && !sameSecret(req.headers.authorization ?? "", `Bearer ${opts.token}`)) {
      json(res, 401, { error: "unauthorized" });
      return false;
    }
    return true;
  }

  return {
    run,
    view,
    remove: dropSession,
    approve,
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      if (!p.startsWith("/api/")) return false;
      if (!admit(req, res)) return true;
      const m = req.method;
      try {
        if (opts.routes && (await opts.routes(req, res, url))) return true;
        if (m === "GET" && p === "/api/providers") {
          json(res, 200, opts.providers().map(({ id, label, available, reason, defaultModel, local, keyVar }) => ({ id, label, available, reason: available ? undefined : reason, defaultModel, local, keyVar })));
        } else if (m === "GET" && p === "/api/models") {
          const entry = provider(url.searchParams.get("provider"));
          if (!entry?.available) json(res, 400, { error: "provider unavailable" });
          else {
            try {
              const models = (await entry.make({}).listModels?.(AbortSignal.timeout(8000))) ?? [];
              // A declared default is suggested; a local one only when it is installed,
              // else the first listed model.
              const local = Boolean(entry.local);
              const declared = local && entry.defaultModel && models.length && !models.includes(entry.defaultModel) ? undefined : entry.defaultModel;
              json(res, 200, { models, default: declared ?? (local ? models[0] : undefined) });
            } catch (err) {
              json(res, 502, { error: (err as Error).message, models: [], default: entry.defaultModel });
            }
          }
        } else if (m === "GET" && p === "/api/profile") {
          const out = await planFor(url.searchParams.get("provider") ?? "", url.searchParams.get("model") ?? "");
          const entry = provider(url.searchParams.get("provider"));
          const configs = entry?.available ? calibrationConfigs(Boolean(entry.make().capabilities?.constrainedOutput)) : [];
          json(res, out.error ? 502 : 200, { ...out, calibrationCalls: configs.length * CALIBRATION_CASES.length });
        } else if (m === "POST" && p === "/api/chat") await handleChat(req, res);
        else if (m === "POST" && p === "/api/calibrate") await handleCalibrate(req, res);
        else if (m === "POST" && p === "/api/project") await handleProject(req, res);
        else if (m === "GET" && p === "/api/actions") await handleActions(res, url);
        else if (m === "GET" && p === "/api/events") await handleEvents(res, url);
        else if (m === "GET" && p === "/api/sessions") json(res, 200, await listSessions());
        else if (m === "POST" && p.startsWith("/api/approvals/")) {
          const done = approvals.get(decodeURIComponent(p.slice("/api/approvals/".length)));
          const body = await readJson(req);
          if (!done) json(res, 404, { error: "no such request (answered or expired)" });
          else {
            done(body.decision === "allow" || body.decision === "allow-chat" ? body.decision : "deny");
            json(res, 200, { ok: true });
          }
        }
        else if (p.startsWith("/api/sessions/")) {
          const id = decodeURIComponent(p.slice("/api/sessions/".length));
          if (m !== "GET" && opts.allowSessionMutation?.(id) === false) { json(res, 409, { error: "session is managed by another execution owner" }); return true; }
          if (m === "POST" && id.endsWith("/stop")) {
            const busy = sessions.get(id.slice(0, -"/stop".length))?.busy;
            busy?.abort();
            json(res, 200, { stopped: Boolean(busy) });
          } else if (m === "DELETE") {
            if (sessions.get(id)?.busy) { json(res, 409, { error: "session already running" }); return true; }
            await dropSession(id);
            json(res, 200, { ok: true });
          } else if (m === "PUT") {
            // Rename: the only field a client may change.
            const body = await readJson(req);
            const s = await session(id);
            const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
            if (!title) json(res, 400, { error: "title required" });
            else {
              s.title = title;
              await save(s);
              json(res, 200, { id: s.id, title: s.title, updated: s.updated });
            }
          } else if (m === "GET") {
            json(res, 200, await view(id));
          } else json(res, 405, { error: "method not allowed" });
        } else if (m === "POST" && p === "/api/reset") {
          const body = await readJson(req);
          if (sessions.get(String(body.session))?.busy || opts.allowSessionMutation?.(String(body.session)) === false) { json(res, 409, { error: "session already running" }); return true; }
          await dropSession(String(body.session));
          json(res, 200, { ok: true });
        } else json(res, 404, { error: "not found" });
      } catch (err) {
        log(String((err as Error).stack ?? err));
        if (!res.headersSent) json(res, 500, { error: (err as Error).message });
        else res.end();
      }
      return true;
    },
  };
}

/** The newest VERSIONS_KEPT versions of each surface; older replies keep their text without the copy. */
const VERSIONS_KEPT = 10;
export function keepVersions(timeline: TimelineEntry[]): TimelineEntry[] {
  const seen = new Map<string, number>();
  for (let i = timeline.length - 1; i >= 0; i--) {
    const t = timeline[i]!;
    if (t.kind !== "assistant" || !t.versions) continue;
    const kept = t.versions.filter((v) => {
      const n = (seen.get(v.id) ?? 0) + 1;
      seen.set(v.id, n);
      return n <= VERSIONS_KEPT;
    });
    if (kept.length !== t.versions.length) {
      if (kept.length) t.versions = kept;
      else delete t.versions;
    }
  }
  return timeline;
}
