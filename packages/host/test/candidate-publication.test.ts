import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurfaceSnapshot } from "@vak/core";
import { prepareCandidatePublication } from "../src/index.ts";

const at = "2026-10-30T00:00:00.000Z";
function candidate(): { candidateId: string; session: string; provider: string; model: string; result: { stop: string }; reply: string; baseVersions: { id: string; version: number }[]; surfaces: SurfaceSnapshot[] } {
  return { candidateId: "candidate-1", session: "session", provider: "local", model: "model", result: { stop: "end" }, reply: "Ready for review.", baseVersions: [], surfaces: [
    { id: "form", version: 1, data: { amount: 37.5 }, nodes: [{ id: "root", type: "form", props: { submit: "apply" }, children: ["amount"] }, { id: "amount", type: "input", props: { label: "Amount", bind: "/amount" } }] },
    { id: "metric", version: 1, data: { amount: 37.5 }, nodes: [{ id: "root", type: "stat", props: { label: "Amount", value: "{/amount}" } }] },
  ] };
}

test("canonical preparation preserves exact interactive snapshots and is detached from worker/canonical inputs", () => {
  const proposal = candidate(), original = structuredClone(proposal);
  const snapshot = prepareCandidatePublication({ candidate: proposal, message: "Show supplied amount", at });
  assert.deepEqual(proposal, original);
  assert.deepEqual(snapshot.surfaces, proposal.surfaces);
  assert.equal(snapshot.surfaces[0]!.data.amount, 37.5);
  assert.deepEqual(snapshot.timeline.map(entry => entry.kind), ["user", "assistant"]);
  snapshot.surfaces[0]!.data.amount = 0;
  assert.equal(proposal.surfaces[0]!.data.amount, 37.5);
  const base = prepareCandidatePublication({ candidate: candidate(), message: "Show supplied amount", at });
  const next = candidate(); next.baseVersions = base.surfaces.map(({ id, version }) => ({ id, version }));
  next.surfaces[0]!.version = 2; next.surfaces[0]!.data.amount = 42;
  const saved = prepareCandidatePublication({ candidate: next, base, message: "Change amount", at: "2026-10-30T00:01:00.000Z" });
  assert.equal(saved.surfaces[0]!.data.amount, 42);
  assert.equal(base.surfaces[0]!.data.amount, 37.5);
  assert.deepEqual(saved.surfaces[1], base.surfaces[1]);
});

test("canonical preparation rejects failed/stale/tampered snapshots without repairing facts", () => {
  const base = prepareCandidatePublication({ candidate: candidate(), message: "Show supplied amount", at });
  for (const stop of ["error", "max_steps", "cancelled", "unknown"]) {
    const value = candidate(); value.result.stop = stop;
    assert.throws(() => prepareCandidatePublication({ candidate: value, message: "Show amount", at }));
  }
  assert.throws(() => prepareCandidatePublication({ candidate: candidate(), base, message: "Change", at }), /stale/);
  const changed = candidate(); changed.baseVersions = base.surfaces.map(({ id, version }) => ({ id, version }));
  changed.surfaces[0]!.data.amount = 99;
  assert.throws(() => prepareCandidatePublication({ candidate: changed, base, message: "Change", at }), /newer/);
  const cases: unknown[] = [];
  const duplicate = candidate(); duplicate.surfaces[0]!.nodes.push(structuredClone(duplicate.surfaces[0]!.nodes[0]!)); cases.push(duplicate);
  const cycle = candidate(); cycle.surfaces[0]!.nodes[0]!.children = ["root"]; cases.push(cycle);
  const bad = candidate(); bad.surfaces[1]!.nodes[0]!.type = "unknown-component"; cases.push(bad);
  const missing = candidate(); missing.surfaces[1]!.data = {}; cases.push(missing);
  const nonfinite = candidate(); nonfinite.surfaces[1]!.data.amount = Number.NaN; cases.push(nonfinite);
  for (const value of cases) assert.throws(() => prepareCandidatePublication({ candidate: value, message: "Show amount", at }));
  assert.deepEqual(base.surfaces.map(surface => surface.data.amount), [37.5, 37.5]);
});
