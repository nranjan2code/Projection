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
  narrow,
  withTier,
  parseLenient,
  parsePartial,
  projectionResponseSchema,
  type SurfaceStore,
  type Usage,
  systemPrompt,
  TOOL_REMOVE,
  TOOL_RENDER,
  TOOL_UPDATE,
  toolDefinitions,
  ToolCallStream,
  type VpsAction,
} from "@vak/core";
import type { ProjectionPlan } from "./policy.ts";
import type { ChatRequest, Message, Provider, ToolCall, ToolSpec } from "./types.ts";

export interface AgentTool {
  spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: { signal?: AbortSignal }): Promise<string> | string;
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
  maxSteps: number;
  maxTokens?: number;
}

/** Everything a run uses, from explicit options, then the plan, then defaults. */
export function resolveRun(opts: RunOptions): ResolvedRun {
  let catalog = opts.catalog ?? basicCatalog;
  if (opts.profile) catalog = narrow(catalog, opts.profile);
  if (opts.plan) catalog = withTier(catalog, opts.plan.tier);
  const requested = opts.generation && opts.generation !== "auto" ? opts.generation : (opts.plan?.generation ?? opts.generation);
  const generation = generationMode({ ...opts, generation: requested });
  return {
    catalog,
    generation,
    examples: opts.plan?.examples ?? false,
    maxSteps: opts.maxSteps ?? opts.plan?.maxSteps ?? (generation === "constrained" ? 3 : 6),
    maxTokens: opts.maxTokens ?? opts.plan?.maxTokens,
  };
}

export function buildSystem(opts: RunOptions, run: ResolvedRun = resolveRun(opts)): string {
  const parts = [opts.instructions, systemPrompt(run.catalog, opts.profile, { examples: run.examples })].filter(Boolean);
  return parts.join("\n\n");
}

/** Turn a user interaction into the message the model sees next. */
export function actionMessage(action: VpsAction): Message {
  return { role: "user", content: `[ui action] ${JSON.stringify(action)}` };
}

let runCounter = 0;

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

export async function runAgent(opts: RunOptions): Promise<{ stop: string }> {
  try {
    const run = resolveRun(opts);
    return run.generation === "constrained" ? await constrainedLoop(opts, run) : await toolsLoop(opts, run);
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
async function constrainedLoop(opts: RunOptions, run: ResolvedRun): Promise<{ stop: string }> {
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
      messages: opts.messages,
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
        const snap = store.snapshot(tick.surface);
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
    const result = formatDiagnostics(end.diagnostics);
    const isError = end.diagnostics.some((d) => d.severity === "error");
    if (end.surface) {
      const snap = store.snapshot(end.surface);
      emit(snap ? { type: "surface", snapshot: snap } : { type: "surface_removed", id: end.surface });
    }
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

async function toolsLoop(opts: RunOptions, run: ResolvedRun): Promise<{ stop: string }> {
  const catalog = run.catalog;
  const vakSpecs: ToolSpec[] = toolDefinitions(catalog, { mode: opts.schemaMode ?? "compact" }).map((t) => ({
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
      messages: opts.messages,
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
            const snap = store.snapshot(tick.surface);
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
        result = formatDiagnostics(end.diagnostics);
        isError = end.diagnostics.some((d) => d.severity === "error");
        if (end.surface) {
          const snap = store.snapshot(end.surface);
          emit(snap ? { type: "surface", snapshot: snap } : { type: "surface_removed", id: end.surface });
        }
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
            result = await tool.execute(args, { signal: opts.signal });
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
    if (allOk && onlyProjection) {
      emit({ type: "run_end", stop: "projected", usage });
      return { stop: "projected" };
    }
  }
  emit({ type: "run_end", stop: "max_steps", usage });
  return { stop: "max_steps" };
}
