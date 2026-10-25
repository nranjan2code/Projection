// Calibration: measure how well a model projects UI under each candidate
// configuration, on a fixed, versioned suite. The policy prefers measured
// results over declared facts.

import { addUsage, basicCatalog, type Catalog, type ResolvedNode, SurfaceStore, type Usage } from "@vak/core";
import { runAgent } from "./agent.ts";
import type { Message, Provider } from "./types.ts";

/** Bump whenever cases or rubrics change: older calibrations stop applying. */
export const CALIBRATION_VERSION = 1;

/** How the engine asks a model for UI. */
export interface ProjectionConfig {
  generation: "tools" | "constrained";
  /** Component vocabulary offered: "core" or everything ("extended"). */
  tier: "core" | "extended";
  /** Worked examples in the prompt. */
  examples: boolean;
  /** How the node tree is written (default "flat"). */
  authoring?: "flat" | "inline";
}

export const configKey = (c: ProjectionConfig) =>
  `${c.generation}/${c.tier}/${c.examples ? "examples" : "plain"}${c.authoring === "inline" ? "/inline" : ""}`;

type Counts = Map<string, number>;
const n = (c: Counts, t: string) => c.get(t) ?? 0;

export interface CalibrationCase {
  prompt: string;
  /** What a complete answer contains, in words. */
  rubric: string;
  complete: (counts: Counts) => boolean;
}

export const CALIBRATION_CASES: CalibrationCase[] = [
  {
    prompt: "Compare three hotels in Kyoto for a week in November and let me book one",
    rubric: "≥3 cards or a table, plus a way to act (button/form/select)",
    complete: (c) => (n(c, "card") >= 3 || n(c, "table") >= 1) && n(c, "button") + n(c, "form") + n(c, "select") >= 1,
  },
  {
    prompt: "Show a Q3 sales dashboard: KPIs, a monthly revenue chart and top 5 products",
    rubric: "≥2 stats and a chart",
    complete: (c) => n(c, "stat") >= 2 && n(c, "chart") >= 1,
  },
  {
    prompt: "Plan a 5-day beginner workout routine, one tab per day",
    rubric: "tabs, or ≥5 sections/cards",
    complete: (c) => n(c, "tabs") >= 1 || n(c, "section") + n(c, "card") >= 5,
  },
  {
    prompt: "Make a newsletter signup form with name, email, topics and frequency",
    rubric: "≥2 inputs, a select or checkbox, and a form or button",
    complete: (c) => n(c, "input") >= 2 && n(c, "select") + n(c, "checkbox") >= 1 && n(c, "form") + n(c, "button") >= 1,
  },
];

export function countTypes(node: ResolvedNode | null, into: Counts = new Map()): Counts {
  if (!node) return into;
  into.set(node.type, n(into, node.type) + 1);
  for (const c of node.children) countTypes(c, into);
  return into;
}

export interface ConfigResult {
  config: ProjectionConfig;
  runs: number;
  /** Ended with a surface and no engine errors. */
  valid: number;
  /** Valid and contains what was asked (case rubric). */
  complete: number;
  medianMs: number;
  usage?: Usage;
}

export interface Calibration {
  version: number;
  /** Model fingerprint at calibration time; a different fingerprint invalidates it. */
  fingerprint: string;
  at: string;
  results: ConfigResult[];
}

export interface CaseOutcome {
  config: ProjectionConfig;
  prompt: string;
  valid: boolean;
  complete: boolean;
  ms: number;
  stop: string;
}

export interface CalibrateOptions {
  provider: Provider;
  model: string;
  fingerprint: string;
  configs: ProjectionConfig[];
  runsPerCase?: number;
  catalog?: Catalog;
  /** Per-run cap, so one stuck generation cannot stall calibration. */
  timeoutMs?: number;
  onCase?: (outcome: CaseOutcome) => void;
  signal?: AbortSignal;
}

export async function calibrate(opts: CalibrateOptions): Promise<Calibration> {
  const results: ConfigResult[] = [];
  for (const config of opts.configs) {
    const times: number[] = [];
    let valid = 0, complete = 0, runs = 0;
    let usage: Usage | undefined;
    for (const c of CALIBRATION_CASES) {
      for (let r = 0; r < (opts.runsPerCase ?? 1); r++) {
        opts.signal?.throwIfAborted();
        const store = new SurfaceStore(opts.catalog ?? basicCatalog);
        const messages: Message[] = [{ role: "user", content: c.prompt }];
        let lastError: boolean | undefined;
        const t0 = Date.now();
        const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 120_000), ...(opts.signal ? [opts.signal] : [])]);
        const out = await runAgent({
          provider: opts.provider,
          model: opts.model,
          store,
          messages,
          catalog: opts.catalog,
          plan: { ...config, maxSteps: 3, maxTokens: 6000, reasons: [] },
          signal,
          emit: (e) => {
            if (e.type === "tool_end") lastError = Boolean(e.isError);
            if (e.type === "run_end") usage = addUsage(usage, e.usage);
          },
        });
        const ms = Date.now() - t0;
        const surface = store.list()[0];
        const isValid = Boolean(surface) && lastError === false && out.stop !== "error";
        const isComplete = isValid && c.complete(countTypes(store.resolve(surface!.id)!.root));
        runs++;
        if (isValid) valid++;
        if (isComplete) complete++;
        times.push(ms);
        opts.onCase?.({ config, prompt: c.prompt, valid: isValid, complete: isComplete, ms, stop: out.stop });
      }
    }
    times.sort((a, b) => a - b);
    results.push({ config, runs, valid, complete, medianMs: times[Math.floor(times.length / 2)] ?? 0, usage });
  }
  return { version: CALIBRATION_VERSION, fingerprint: opts.fingerprint, at: new Date().toISOString(), results };
}
