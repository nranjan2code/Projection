// The agent loop: stream a turn from any provider, project vak_* tool calls
// progressively into surfaces, run user tools, feed results back, repeat.

import {
  addUsage,
  type AgentEvent,
  basicCatalog,
  type Catalog,
  type CapabilityProfile,
  CONSTRAINED_INSTRUCTIONS,
  formatDiagnostics,
  namedComponents,
  narrow,
  walk,
  withTier,
  parseLenient,
  parsePartial,
  projectionResponseSchema,
  projectText,
  type SurfaceStore,
  SurfacePublisher,
  type Usage,
  systemPrompt,
  TOOL_REMOVE,
  TOOL_RENDER,
  TOOL_UPDATE,
  toolDefinitions,
  toWireSchema,
  ToolCallStream,
  type VpsAction,
} from "@vak/core";
import type { ProjectionPlan } from "./policy.ts";
import type { ChatRequest, Message, Provider, ToolCall, ToolSpec } from "./types.ts";

export interface AgentTool {
  spec: ToolSpec;
  /** `emit` lets a tool tell the client something mid-call (an approval request). */
  execute(args: Record<string, unknown>, ctx: { signal?: AbortSignal; emit?: (e: AgentEvent) => void; callId?: string }): Promise<string> | string;
}

export interface RunOptions {
  provider: Provider;
  model: string;
  store: SurfaceStore;
  /** Conversation so far; new assistant and tool messages are appended in place. */
  messages: Message[];
  emit: (event: AgentEvent) => void;
  catalog?: Catalog;
  /** Projection target; narrows the catalog and adds target notes to the prompt. */
  profile?: CapabilityProfile;
  /** Prepended to the generated projection instructions. */
  instructions?: string;
  tools?: AgentTool[];
  /** "strict" unions per component, or "compact" (smaller schemas). Tools generation only. */
  schemaMode?: "strict" | "compact";
  /**
   * How the model produces UI:
   * - "tools": native tool calling, with engine repair and diagnostics fed back
   * - "constrained": the answer is grammar-decoded against the catalog schema,
   *   so malformed projections cannot be produced (needs provider support)
   * - "auto" (default): tools. Measured on local models, grammar decoding
   *   guaranteed shape but composed thinner UIs; constrained is chosen
   *   explicitly or by a calibrated plan.
   */
  generation?: "auto" | "tools" | "constrained";
  /**
   * A plan from the capability policy (choosePlan). Sets generation, catalog
   * tier, worked examples and step/token bounds; explicit options still win.
   */
  plan?: ProjectionPlan;
  /**
   * How many recent turns the model sees on each step (a turn starts at a
   * user message: typed text or a [ui action]). Older messages stay in
   * `messages`; the surfaces still shown are described at the start of the
   * window so the model can keep updating them. Default: everything.
   */
  history?: number;
  /** Projection ends ordinary UI turns; response lets tool runs publish progress and continue. */
  completion?: "projection" | "response";
  maxSteps?: number;
  maxTokens?: number;
  effort?: ChatRequest["effort"];
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}

const VAK_TOOLS = new Set([TOOL_RENDER, TOOL_UPDATE, TOOL_REMOVE]);

interface ResolvedRun {
  catalog: Catalog;
  generation: "tools" | "constrained";
  examples: boolean;
  /** Tools generation only; constrained output always uses the flat schema. */
  authoring: "flat" | "inline";
  maxSteps: number;
  maxTokens?: number;
}

const lastRequest = (opts: RunOptions) => opts.messages.findLast((m) => m.role === "user" && !m.content.startsWith("[engine]"))?.content ?? "";

/** Component types on the surfaces still shown. */
function shownTypes(store: SurfaceStore | undefined): string[] {
  const types = new Set<string>();
  for (const s of store?.list() ?? []) {
    const root = store!.resolve(s.id)?.root;
    if (root) walk(root, (n) => types.add(n.type));
  }
  return [...types];
}

/** Everything a run uses, from explicit options, then the plan, then defaults. */
export function resolveRun(opts: RunOptions): ResolvedRun {
  let catalog = opts.catalog ?? basicCatalog;
  if (opts.profile) catalog = narrow(catalog, opts.profile);
  // A small model's core tier still offers a richer component the user asked
  // for by name (4B, Vakyartha: "show your memory as a graph view" became
  // cards, because graph was not in its vocabulary), and any already shown,
  // so a follow-up can update it.
  if (opts.plan) catalog = withTier(catalog, opts.plan.tier, [...namedComponents(catalog, lastRequest(opts), { aliases: true }), ...shownTypes(opts.store)]);
  const requested = opts.generation && opts.generation !== "auto" ? opts.generation : (opts.plan?.generation ?? opts.generation);
  if (opts.completion !== undefined && opts.completion !== "projection" && opts.completion !== "response") throw new Error("Unknown completion policy");
  if (opts.completion === "response" && requested === "constrained") throw new Error("Response completion requires tool generation");
  const generation = generationMode({ ...opts, generation: requested });
  return {
    catalog,
    generation,
    examples: opts.plan?.examples ?? false,
    authoring: generation === "tools" ? (opts.plan?.authoring ?? "flat") : "flat",
    maxSteps: opts.maxSteps ?? opts.plan?.maxSteps ?? (generation === "constrained" ? 3 : 6),
    maxTokens: opts.maxTokens ?? opts.plan?.maxTokens,
  };
}

export function buildSystem(opts: RunOptions, run: ResolvedRun = resolveRun(opts)): string {
  const parts = [opts.instructions, systemPrompt(run.catalog, opts.profile, { examples: run.examples, authoring: run.authoring })].filter(Boolean);
  // 4B rich-component runs substituted familiar layouts and lost fields even
  // with the full catalog present. When the user explicitly requests a catalog
  // component, put its actual contract last; no benchmark names or facts enter it.
  const requested = namedComponents(run.catalog, lastRequest(opts)).map((name) => [name, run.catalog.components[name]!] as const);
  if (requested.length) {
    parts.push("Requested components: use these exact types, with every supplied item and verbatim labels, captions and source. Do not replace them with other components.\n" + requested.map(([name, def]) => `type: ${name}. ${def.hint ?? ""} Props schema (supply values): ${JSON.stringify(toWireSchema(def.props))}`).join("\n"));
  }
  if (opts.completion === "response") parts.push("Publishing a surface is progress, not the end of this run. Continue any remaining requested tool work and outputs. Before finishing, compare the published surface IDs and component types with the request: sections or nodes within one surface are not separate surfaces. Finish with a short text response without tool calls when the requested work is ready for review, or explain what input or access is missing. Tool responses and a rendered interface alone are not proof of an external effect.");
  return parts.join("\n\n");
}

/** Turn a user interaction into the message the model sees next. */
export function actionMessage(action: VpsAction): Message {
  return { role: "user", content: `[ui action] ${JSON.stringify(action)}` };
}

/** A turn starts at a user message; engine feedback ([engine] ...) continues the current turn. */
const startsTurn = (m: Message) => m.role === "user" && !m.content.startsWith("[engine]");

/** Index of the first message in a window of the last `turns` turns (0: everything). */
export function historyStart(messages: Message[], turns?: number): number {
  if (turns === undefined || turns < 1) return 0;
  let seen = 0;
  for (let i = messages.length - 1; i > 0; i--) if (startsTurn(messages[i]!) && ++seen === turns) return i;
  return 0;
}

/**
 * What the model needs from the dropped turns: each surface still shown, as
 * its text view plus its data, so it can vak_update one by id. The text view,
 * not the stored flat nodes: replaying flat nodes to a small model pulls it
 * back toward flat authoring.
 */
export function shownSurfacesNote(store: SurfaceStore): string | undefined {
  const parts: string[] = [];
  for (const s of store.list()) {
    const resolved = store.resolve(s.id);
    if (!resolved) continue;
    parts.push(`Surface "${s.id}"${s.title ? ` (${s.title})` : ""} shows:\n${projectText(resolved)}\nIts data: ${JSON.stringify(s.data)}`);
  }
  if (!parts.length) return undefined;
  return `[earlier conversation omitted] These surfaces are still shown to the user; change one with vak_update and its surface id, or render a new one.\n\n${parts.join("\n\n")}`;
}

/**
 * The messages sent on each step: everything, or the recent window. The note
 * goes into the window's first message rather than a message of its own, so
 * the conversation never has two user messages in a row.
 */
function historyView(opts: RunOptions): () => Message[] {
  const start = historyStart(opts.messages, opts.history);
  if (start === 0) return () => opts.messages;
  const first = opts.messages[start]!;
  const note = shownSurfacesNote(opts.store);
  const head = note ? { ...first, content: `${note}\n\n${first.content}` } : first;
  return () => [head, ...opts.messages.slice(start + 1)];
}

let runCounter = 0;

/**
 * Show a finished call's surface if it improves on what the user sees. When
 * it is held back, the model is told, so it fixes the errors in place rather
 * than writing the surface again (each rewrite risks losing more).
 */
function show(publisher: SurfacePublisher, id: string, emit: RunOptions["emit"]): string {
  const r = publisher.settle(id);
  if (r.snapshot) emit({ type: "surface", snapshot: r.snapshot });
  else if (r.removed) emit({ type: "surface_removed", id });
  return r.held
    ? `\nNot shown: this version still has errors and shows less than the version the user sees, which stays on screen. Fix only the errors above with vak_update; everything else in "${id}" is kept.`
    : "";
}

/** Upper bound on one constrained answer, so a looping decode always ends. */
const CONSTRAINED_MAX_TOKENS = 6000;

export function generationMode(opts: Pick<RunOptions, "generation" | "provider" | "tools">): "tools" | "constrained" {
  const can = Boolean(opts.provider.capabilities?.constrainedOutput);
  const requested = opts.generation ?? "auto";
  if (requested === "constrained") {
    if (!can) throw new Error(`${opts.provider.id} cannot guarantee constrained output`);
    if (opts.tools?.length) throw new Error("constrained generation cannot be combined with user tools");
    return "constrained";
  }
  return "tools";
}

/**
 * Clients see surfaces through a publisher (see publish.ts): a retry that
 * would make a shown surface worse is held back, and whatever ends the run
 * (done, step limit, error, abort) first puts held surfaces back to what the
 * user sees, so the store, the saved session and every client agree.
 */
export async function runAgent(opts: RunOptions): Promise<{ stop: string }> {
  const publisher = new SurfacePublisher(opts.store);
  const emit = opts.emit;
  opts = {
    ...opts,
    emit: (event) => {
      if (event.type === "run_end") for (const snapshot of publisher.finish()) emit({ type: "surface", snapshot });
      emit(event);
    },
  };
  try {
    const run = resolveRun(opts);
    const view = historyView(opts);
    return run.generation === "constrained" ? await constrainedLoop(opts, run, view, publisher) : await toolsLoop(opts, run, view, publisher);
  } catch (err) {
    if (opts.signal?.aborted) {
      opts.emit({ type: "run_end", stop: "aborted" });
      return { stop: "aborted" };
    }
    opts.emit({ type: "error", message: (err as Error).message });
    opts.emit({ type: "run_end", stop: "error" });
    return { stop: "error" };
  }
}

/**
 * Constrained generation: each step's answer is `{render, reply}`, decoded
 * under the catalog's strict schema. The render streams into the store as it
 * arrives; the reply streams as text. Remaining diagnostics (structure the
 * grammar cannot express, like dangling child ids) go back for another step.
 */
async function constrainedLoop(opts: RunOptions, run: ResolvedRun, view: () => Message[], publisher: SurfacePublisher): Promise<{ stop: string }> {
  const responseSchema = projectionResponseSchema(run.catalog);
  const system = `${buildSystem(opts, run)}\n\n${CONSTRAINED_INSTRUCTIONS}`;
  const { emit, store } = opts;
  const runId = `run_${Date.now().toString(36)}_${++runCounter}`;
  emit({ type: "run_start", runId, provider: opts.provider.id, model: opts.model });
  let usage: Usage | undefined;

  for (let step = 0; step < run.maxSteps; step++) {
    const stream = new ToolCallStream(store, TOOL_RENDER, { select: (root) => (root as { render?: unknown } | undefined)?.render });
    const callId = `${runId}_${step}`;
    let started = false;
    let replySent = 0;
    let stop = "end";

    for await (const ev of opts.provider.stream({
      model: opts.model,
      system,
      messages: view(),
      responseSchema,
      // A grammar admits endless arrays; bound every constrained answer.
      maxTokens: run.maxTokens ?? CONSTRAINED_MAX_TOKENS,
      effort: opts.effort,
      extra: opts.extra,
      signal: opts.signal,
    })) {
      if (ev.type === "done") {
        stop = ev.stop;
        usage = addUsage(usage, ev.usage);
        continue;
      }
      if (ev.type !== "text") continue;
      const tick = stream.push(ev.delta);
      if (tick.surface && !started) {
        started = true;
        emit({ type: "tool_start", id: callId, name: TOOL_RENDER });
      }
      if (tick.changed && tick.surface) {
        const snap = publisher.streaming(tick.surface);
        if (snap) emit({ type: "surface", snapshot: snap });
      }
      // The reply only grows, so emit the new suffix.
      const reply = (parsePartial(stream.raw).value as { reply?: unknown } | undefined)?.reply;
      if (typeof reply === "string" && reply.length > replySent) {
        emit({ type: "text_delta", delta: reply.slice(replySent) });
        replySent = reply.length;
      }
    }

    opts.messages.push({ role: "assistant", content: stream.raw });
    const answer = parsePartial(stream.raw, { final: true }).value as { render?: unknown } | undefined;
    if (!answer?.render) {
      emit({ type: "run_end", stop, usage });
      return { stop };
    }
    const end = stream.end();
    const isError = end.diagnostics.some((d) => d.severity === "error");
    const result = formatDiagnostics(end.diagnostics) + (end.surface ? show(publisher, end.surface, emit) : "");
    emit({ type: "tool_end", id: callId, name: TOOL_RENDER, result, ...(isError ? { isError } : {}) });
    if (!isError) {
      emit({ type: "run_end", stop: "projected", usage });
      return { stop: "projected" };
    }
    opts.messages.push({ role: "user", content: `[engine] ${result}\nRender the surface again with these fixed.` });
  }
  emit({ type: "run_end", stop: "max_steps", usage });
  return { stop: "max_steps" };
}

async function toolsLoop(opts: RunOptions, run: ResolvedRun, view: () => Message[], publisher: SurfacePublisher): Promise<{ stop: string }> {
  const catalog = run.catalog;
  const vakSpecs: ToolSpec[] = toolDefinitions(catalog, { mode: opts.schemaMode ?? "compact", authoring: run.authoring }).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  const userTools = new Map((opts.tools ?? []).map((t) => [t.spec.name, t]));
  const tools = [...vakSpecs, ...(opts.tools ?? []).map((t) => t.spec)];
  const system = buildSystem(opts, run);
  const runId = `run_${Date.now().toString(36)}_${++runCounter}`;
  const { emit, store } = opts;
  const maxSteps = run.maxSteps;

  emit({ type: "run_start", runId, provider: opts.provider.id, model: opts.model });
  let lastStop = "end";
  let usage: Usage | undefined;

  for (let step = 0; step < maxSteps; step++) {
    let text = "";
    const calls: (ToolCall & { stream?: ToolCallStream })[] = [];
    const byId = new Map<string, (typeof calls)[number]>();
    let native: unknown;

    for await (const ev of opts.provider.stream({
      model: opts.model,
      system,
      messages: view(),
      tools,
      maxTokens: run.maxTokens,
      effort: opts.effort,
      extra: opts.extra,
      signal: opts.signal,
    })) {
      switch (ev.type) {
        case "text":
          text += ev.delta;
          emit({ type: "text_delta", delta: ev.delta });
          break;
        case "tool_start": {
          const call = { id: ev.id, name: ev.name, arguments: "", stream: VAK_TOOLS.has(ev.name) ? new ToolCallStream(store, ev.name) : undefined };
          calls.push(call);
          byId.set(ev.id, call);
          emit({ type: "tool_start", id: ev.id, name: ev.name });
          break;
        }
        case "tool_args": {
          const call = byId.get(ev.id);
          if (!call) break;
          call.arguments += ev.delta;
          const tick = call.stream?.push(ev.delta);
          if (tick?.changed && tick.surface) {
            const snap = publisher.streaming(tick.surface);
            if (snap) emit({ type: "surface", snapshot: snap });
          }
          break;
        }
        case "done":
          lastStop = ev.stop;
          native = ev.native;
          usage = addUsage(usage, ev.usage);
          break;
      }
    }

    opts.messages.push({
      role: "assistant",
      content: text,
      ...(calls.length ? { toolCalls: calls.map(({ id, name, arguments: a }) => ({ id, name, arguments: a })) } : {}),
      ...(native !== undefined ? { native: { provider: opts.provider.id, value: native } } : {}),
    });

    if (calls.length === 0) {
      emit({ type: "run_end", stop: lastStop, usage });
      return { stop: lastStop };
    }

    let allOk = true;
    for (const call of calls) {
      let result: string;
      let isError = false;
      if (call.stream) {
        const end = call.stream.end();
        isError = end.diagnostics.some((d) => d.severity === "error");
        result = formatDiagnostics(end.diagnostics) + (end.surface ? show(publisher, end.surface, emit) : "");
      } else {
        const tool = userTools.get(call.name);
        if (!tool) {
          result = `unknown tool ${call.name}`;
          isError = true;
        } else {
          try {
            let args: Record<string, unknown> = {};
            try {
              args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
            } catch {
              args = parseLenient(call.arguments) as Record<string, unknown>;
            }
            result = await tool.execute(args, { signal: opts.signal, emit, callId: call.id });
          } catch (err) {
            result = `error: ${(err as Error).message}`;
            isError = true;
          }
        }
      }
      allOk &&= !isError;
      opts.messages.push({ role: "tool", content: result, toolCallId: call.id, toolName: call.name, ...(isError ? { isError } : {}) });
      emit({ type: "tool_end", id: call.id, name: call.name, result, ...(isError ? { isError } : {}) });
    }

    // A clean projection with nothing else pending ends the turn: the UI
    // is the answer, and the user's next interaction starts a new run.
    const onlyProjection = calls.every((c) => VAK_TOOLS.has(c.name));
    if (allOk && onlyProjection && opts.completion !== "response") {
      emit({ type: "run_end", stop: "projected", usage });
      return { stop: "projected" };
    }
  }
  emit({ type: "run_end", stop: "max_steps", usage });
  return { stop: "max_steps" };
}
