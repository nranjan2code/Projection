// Runs scenarios against a live model, records exactly what the model sent
// (cassettes), and scores each turn with the structural rubric.

import {
  addUsage,
  basicCatalog,
  type Catalog,
  type Diagnostic,
  parseLenient,
  projectText,
  SurfaceStore,
  TOOL_RENDER,
  type Usage,
  type VpsAction,
} from "@vak/core";
import { actionMessage, type Message, type ProjectionConfig, type ProjectionPlan, type Provider, runAgent } from "@vak/providers";
import { type CheckContext, type CheckResult, evaluate } from "./rubric.ts";
import { BENCH_VERSION, type Scenario, SCENARIOS } from "./scenarios.ts";
import { performAct } from "./simulate.ts";

/** One tool call exactly as the model produced it (arguments before any repair). */
export interface RecordedCall {
  tool: string;
  args: string;
}

export interface TurnRecord {
  action?: VpsAction;
  actError?: string;
  calls: RecordedCall[];
  surface?: string;
  checks: CheckResult[];
  ms: number;
  stop: string;
  usage?: Usage;
}

export interface RunRecord {
  benchVersion: number;
  scenario: string;
  run: number;
  config: ProjectionConfig;
  turns: TurnRecord[];
  passed: number;
  total: number;
  complete: boolean;
  /** Semantic grade in [0, 1], when a judge ran. */
  judge?: { score: number; reason: string };
  /** Replay score at record time; the replay gate must never go below it. */
  expected?: number;
  /** Set when an expected score was deliberately lowered, with the reason. */
  accepted?: { reason: string; from: number; at: string };
}

/** Implicit first check of every turn: a surface exists and the engine reported no errors. */
export const RENDERS_CLEANLY = "renders without errors";

export function scoreTurns(turns: TurnRecord[]): { passed: number; total: number; complete: boolean } {
  const all = turns.flatMap((t) => t.checks);
  const passed = all.filter((c) => c.pass).length;
  return { passed, total: all.length, complete: all.length > 0 && passed === all.length };
}

/** Context for checking a turn: the surface the turn produced (or kept showing). */
export function checkContext(store: SurfaceStore, surfaceId: string | undefined, before: CheckContext["before"]): CheckContext {
  const surface = surfaceId ? store.resolve(surfaceId) : undefined;
  return { surface, text: surface ? projectText(surface) : "", before };
}

export function snapshotOf(ctx: CheckContext): CheckContext["before"] {
  return { surface: ctx.surface?.id, version: ctx.surface?.version, text: ctx.text };
}

/** The calls the model made in messages appended after `from`. */
function recordedCalls(messages: Message[], from: number): RecordedCall[] {
  const calls: RecordedCall[] = [];
  for (const m of messages.slice(from)) {
    if (m.role !== "assistant") continue;
    if (m.toolCalls?.length) {
      for (const c of m.toolCalls) calls.push({ tool: c.name, args: c.arguments });
    } else if (m.content.trim().startsWith("{")) {
      // Constrained generation: the answer is {reply, render}.
      const render = (parseLenient(m.content) as { render?: unknown } | undefined)?.render;
      if (render) calls.push({ tool: TOOL_RENDER, args: JSON.stringify(render) });
    }
  }
  return calls;
}

export interface BenchOptions {
  provider: Provider;
  model: string;
  plan: ProjectionPlan;
  runs: number;
  scenarios?: Scenario[];
  catalog?: Catalog;
  instructions?: string;
  judge?: Judge;
  timeoutMs?: number;
  onRecord?: (r: RunRecord) => void;
  signal?: AbortSignal;
}

export type Judge = (scenario: Scenario, finalText: string) => Promise<{ score: number; reason: string; usage?: Usage }>;

export async function runScenario(s: Scenario, run: number, opts: BenchOptions): Promise<RunRecord> {
  const store = new SurfaceStore(opts.catalog ?? basicCatalog);
  const messages: Message[] = [];
  const turns: TurnRecord[] = [];
  let active: string | undefined;
  let before: CheckContext["before"];

  for (const turn of s.turns) {
    const rec: TurnRecord = { calls: [], checks: [], ms: 0, stop: "skipped" };
    turns.push(rec);
    if (turn.act) {
      const out = active ? performAct(store, active, turn.act) : { error: "nothing on screen to act on" };
      if ("error" in out) {
        rec.actError = out.error;
        rec.checks = [{ check: RENDERS_CLEANLY, pass: false }, ...turn.expect.map(() => ({ check: "(action failed)", pass: false }))];
        break;
      }
      rec.action = out.action;
      messages.push(actionMessage(out.action));
    } else {
      messages.push({ role: "user", content: turn.say ?? "" });
    }

    const from = messages.length;
    let touched: string | undefined;
    let lastDiagnosticError = false;
    const t0 = Date.now();
    const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 150_000), ...(opts.signal ? [opts.signal] : [])]);
    const out = await runAgent({
      provider: opts.provider,
      model: opts.model,
      store,
      messages,
      catalog: opts.catalog,
      plan: opts.plan,
      instructions: opts.instructions,
      signal,
      emit: (e) => {
        if (e.type === "surface") touched = e.snapshot.id;
        if (e.type === "tool_end") lastDiagnosticError = Boolean(e.isError);
        if (e.type === "run_end") rec.usage = addUsage(rec.usage, e.usage);
      },
    });
    rec.ms = Date.now() - t0;
    rec.stop = out.stop;
    rec.calls = recordedCalls(messages, from);
    active = touched ?? active;
    rec.surface = active;

    const ctx = checkContext(store, active, before);
    const clean = Boolean(ctx.surface) && !lastDiagnosticError && out.stop !== "error";
    rec.checks = [{ check: RENDERS_CLEANLY, pass: clean }, ...evaluate(turn.expect, ctx)];
    before = snapshotOf(ctx);
  }

  const score = scoreTurns(turns);
  const record: RunRecord = { benchVersion: BENCH_VERSION, scenario: s.id, run, config: { generation: opts.plan.generation, tier: opts.plan.tier, examples: opts.plan.examples }, turns, ...score };
  if (opts.judge && active) {
    const finalText = store.list().map((st) => projectText(store.resolve(st.id)!)).join("\n\n");
    try {
      const { score: judged, reason } = await opts.judge(s, finalText);
      record.judge = { score: judged, reason };
    } catch (err) {
      record.judge = { score: 0, reason: `judge failed: ${(err as Error).message}` };
    }
  }
  return record;
}

export async function runBench(opts: BenchOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const s of opts.scenarios ?? SCENARIOS) {
    for (let r = 0; r < opts.runs; r++) {
      opts.signal?.throwIfAborted();
      const rec = await runScenario(s, r, opts);
      records.push(rec);
      opts.onRecord?.(rec);
    }
  }
  return records;
}

export type { Diagnostic };
