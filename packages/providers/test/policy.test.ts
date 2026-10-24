import assert from "node:assert/strict";
import { test } from "node:test";
import { CALIBRATION_VERSION, type Calibration } from "../src/calibration.ts";
import { choosePlan, type ModelProfile } from "../src/policy.ts";

const local = (parameters: number, extra: Partial<ModelProfile> = {}): ModelProfile => ({
  provider: "ollama",
  model: "m",
  facts: { tools: true, parameters, contextWindow: 262144, fingerprint: "sha-1", source: "test" },
  constrainedOutput: true,
  ...extra,
});

const calibration = (fingerprint: string): Calibration => ({
  version: CALIBRATION_VERSION,
  fingerprint,
  at: "2026-10-24T00:00:00Z",
  results: [
    { config: { generation: "constrained", tier: "core", examples: true }, runs: 8, valid: 7, complete: 1, medianMs: 9000 },
    { config: { generation: "tools", tier: "core", examples: true }, runs: 8, valid: 6, complete: 5, medianMs: 30000 },
    { config: { generation: "tools", tier: "extended", examples: false }, runs: 8, valid: 6, complete: 4, medianMs: 32000 },
  ],
});

test("declared only: small models get the core tier, examples and fewer steps", () => {
  const plan = choosePlan(local(0.85e9));
  assert.deepEqual([plan.generation, plan.tier, plan.examples, plan.maxSteps], ["tools", "core", true, 2]);
  assert.match(plan.reasons.join(" "), /not calibrated/);
});

test("declared only: unknown size (hosted) gets the full catalog", () => {
  const plan = choosePlan({ provider: "openai", model: "x", facts: { fingerprint: "x", source: "t" }, constrainedOutput: false });
  assert.deepEqual([plan.generation, plan.tier, plan.examples], ["tools", "extended", false]);
});

test("a small context window trims the prompt", () => {
  const plan = choosePlan(local(70e9, { facts: { tools: true, parameters: 70e9, contextWindow: 8192, fingerprint: "f", source: "t" } }));
  assert.deepEqual([plan.tier, plan.examples], ["core", false]);
});

test("calibrated: the configuration that completed most wins, with the numbers as the reason", () => {
  const plan = choosePlan(local(4.5e9, { calibration: calibration("sha-1") }));
  assert.deepEqual([plan.generation, plan.tier, plan.examples], ["tools", "core", true]);
  assert.match(plan.reasons[0]!, /tools\/core\/examples completed 5\/8 \(best of 3/);
});

test("calibration for other weights is ignored", () => {
  const plan = choosePlan(local(4.5e9, { calibration: calibration("sha-OLD") }));
  assert.match(plan.reasons[0]!, /stale/);
});

test("user tools rule out constrained configurations even if they measured best", () => {
  const cal = calibration("sha-1");
  cal.results[0]!.complete = 8;
  assert.equal(choosePlan(local(4.5e9, { calibration: cal })).generation, "constrained");
  assert.equal(choosePlan(local(4.5e9, { calibration: cal }), { userTools: true }).generation, "tools");
});

test("a model with neither tools nor constrained output is refused, not guessed", () => {
  const p: ModelProfile = { provider: "x", model: "y", facts: { tools: false, fingerprint: "f", source: "t" }, constrainedOutput: false };
  assert.throws(() => choosePlan(p), /neither tool calling nor constrained output/);
});
