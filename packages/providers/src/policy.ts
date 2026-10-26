// Policy: a model profile (declared facts + calibration) in, a projection
// plan out — with the reason for every choice. Pure and deterministic.

import { CALIBRATION_VERSION, type Calibration, type ConfigResult, configKey, type ProjectionConfig } from "./calibration.ts";
import type { ModelFacts } from "./types.ts";

export interface ModelProfile {
  provider: string;
  model: string;
  facts: ModelFacts;
  /** The provider can grammar-constrain responses for this model. */
  constrainedOutput: boolean;
  calibration?: Calibration;
}

export interface ProjectionPlan extends ProjectionConfig {
  maxSteps: number;
  maxTokens?: number;
  /** The longest integration result the model sees, from its context window. */
  toolResultChars?: number;
  /** Why each choice was made, for display. */
  reasons: string[];
}

/** A calibration counts only for the suite version and model weights it measured. */
export function calibrationApplies(profile: ModelProfile): boolean {
  const c = profile.calibration;
  return Boolean(c && c.version === CALIBRATION_VERSION && c.fingerprint === profile.facts.fingerprint);
}

/** Size classes for declared-only planning. Hosted models publish no size: treated as large. */
export const SMALL_MODEL = 2e9;
export const MEDIUM_MODEL = 15e9;
/** Below this context, worked examples and the extended catalog cost too much prompt. */
export const SMALL_CONTEXT = 16_000;

const rate = (r: ConfigResult, k: "valid" | "complete") => (r.runs ? r[k] / r.runs : 0);

export function choosePlan(profile: ModelProfile, ctx: { userTools?: boolean } = {}): ProjectionPlan {
  const plan = chooseConfig(profile, ctx);
  const ctxWindow = profile.facts.contextWindow;
  if (ctxWindow === undefined) return plan;
  // Several results stay in view while the model answers: each gets at most an
  // eighth of the window (about four characters a token).
  const toolResultChars = Math.floor((ctxWindow * CHARS_PER_TOKEN) / RESULTS_IN_VIEW);
  return { ...plan, toolResultChars, reasons: [...plan.reasons, `${ctxWindow}-token context: tool results up to ${toolResultChars} characters`] };
}

const CHARS_PER_TOKEN = 4;
const RESULTS_IN_VIEW = 8;

function chooseConfig(profile: ModelProfile, ctx: { userTools?: boolean }): ProjectionPlan {
  const reasons: string[] = [];
  const canTools = profile.facts.tools !== false;
  const canConstrained = profile.constrainedOutput && !ctx.userTools;
  if (!canTools && !canConstrained) {
    throw new Error(`${profile.provider}/${profile.model} supports neither tool calling nor constrained output`);
  }
  if (ctx.userTools && !canTools) throw new Error(`${profile.model} cannot call tools, and this run has user tools`);
  const possible = (c: ProjectionConfig) => (c.generation === "tools" ? canTools : canConstrained);

  const declared = declaredPlan(profile, canTools);

  // 1. Measured: the best configuration this model was calibrated on. A few
  // calibration cases are noisy, so it replaces the declared plan only when it
  // is clearly better (its 95% interval above the declared one's), or when the
  // declared configuration was not measured or cannot run here.
  if (calibrationApplies(profile)) {
    const ranked = profile.calibration!.results
      .filter((r) => r.runs > 0 && possible(r.config))
      .sort((a, b) => rate(b, "complete") - rate(a, "complete") || rate(b, "valid") - rate(a, "valid") || a.medianMs - b.medianMs);
    const best = ranked[0];
    if (best) {
      const at = profile.calibration!.at.slice(0, 10);
      const mine = ranked.find((r) => configKey(r.config) === configKey(declared));
      if (mine && mine !== best && wilson(best.complete, best.runs).lo <= wilson(mine.complete, mine.runs).hi) {
        reasons.push(
          `calibrated ${at}: ${configKey(best.config)} completed ${best.complete}/${best.runs}, ${configKey(mine.config)} ${mine.complete}/${mine.runs}; not a clear difference, keeping the declared plan`,
          ...declared.reasons,
        );
        return { ...declared, reasons };
      }
      reasons.push(
        `calibrated ${at}: ${configKey(best.config)} completed ${best.complete}/${best.runs}` +
          (ranked.length > 1 ? ` (best of ${ranked.length} configurations)` : ""),
      );
      const weak = rate(best, "complete") < 0.5;
      return { ...best.config, maxSteps: weak ? 2 : 4, maxTokens: 6000, reasons };
    }
    reasons.push("calibration has no usable configuration for this run; using declared facts");
  } else if (profile.calibration) {
    reasons.push("calibration is stale (model or suite changed); using declared facts");
  } else {
    reasons.push("not calibrated; using declared facts");
  }
  return { ...declared, reasons: [...reasons, ...declared.reasons] };
}

/** 95% Wilson score interval for k successes in n trials. */
function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** The plan from declared facts alone. */
function declaredPlan(profile: ModelProfile, canTools: boolean): ProjectionPlan {
  const reasons: string[] = [];
  // 2. Declared facts only.
  // Tools first: on calibrated local models, grammar decoding guaranteed shape
  // but produced thinner UIs than tool calling.
  const generation = canTools ? "tools" : "constrained";
  reasons.push(canTools ? "tool calling available" : "no tool calling; constrained output");
  const params = profile.facts.parameters;
  const ctxWindow = profile.facts.contextWindow;
  let tier: ProjectionConfig["tier"] = "extended";
  let examples = false;
  let maxSteps = 4;
  if (params !== undefined && params < SMALL_MODEL) {
    tier = "core";
    examples = true;
    maxSteps = 2;
    reasons.push(`${(params / 1e9).toFixed(1)}B parameters: core components, worked examples, 2 steps`);
  } else if (params !== undefined && params < MEDIUM_MODEL) {
    tier = "core";
    examples = true;
    reasons.push(`${(params / 1e9).toFixed(1)}B parameters: core components, worked examples`);
  } else {
    reasons.push(params === undefined ? "size not published: full catalog" : `${(params / 1e9).toFixed(0)}B parameters: full catalog`);
  }
  if (ctxWindow !== undefined && ctxWindow < SMALL_CONTEXT) {
    tier = "core";
    examples = false;
    reasons.push(`${ctxWindow}-token context: core components, no examples`);
  }
  // Inline children cannot leave a referenced child undefined. Bench v2 A/B on
  // the 4B model: +14 points mean check score, paired 95% CI [+3, +26].
  const authoring = generation === "tools" ? "inline" : "flat";
  if (authoring === "inline") reasons.push("children written inline");
  return { generation, tier, examples, authoring, maxSteps, maxTokens: 6000, reasons };
}
