import assert from "node:assert/strict";
import { test } from "node:test";
import type { Provider, ProviderEvent } from "@vak/providers";
import { replay } from "../src/replay.ts";
import { runScenario } from "../src/runner.ts";
import { SCENARIOS } from "../src/scenarios.ts";
import { meanInterval, significantlyWorse, wilson } from "../src/stats.ts";

test("wilson interval matches known values and stays in [0, 1]", () => {
  const w = wilson(8, 10);
  assert.ok(Math.abs(w.lo - 0.4902) < 1e-3 && Math.abs(w.hi - 0.9433) < 1e-3, JSON.stringify(w));
  const zero = wilson(0, 5);
  assert.equal(zero.lo, 0);
  assert.ok(zero.hi > 0.4 && zero.hi < 0.5);
  assert.equal(wilson(5, 5).hi, 1);
});

test("mean interval and the significance rule", () => {
  const m = meanInterval([0.5, 0.7, 0.6, 0.8]);
  assert.ok(m.lo < 0.65 && m.hi > 0.65);
  assert.equal(significantlyWorse(wilson(1, 20), wilson(18, 20)), true);
  assert.equal(significantlyWorse(wilson(14, 20), wilson(16, 20)), false, "noise is not a regression");
});

test("scenario set: ~30, unique ids, every category, multi-turn flows act on the UI", () => {
  assert.ok(SCENARIOS.length >= 30, `${SCENARIOS.length}`);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  assert.deepEqual(new Set(SCENARIOS.map((s) => s.category)), new Set(["comparison", "dashboard", "form", "planning", "information", "interaction"]));
  assert.ok(SCENARIOS.filter((s) => s.turns.length > 1).length >= 8);
  assert.ok(SCENARIOS.some((s) => s.turns.some((t) => t.act)));
});

/** A provider that answers each request with the next scripted tool call. */
function scripted(responses: { name: string; args: unknown }[]): Provider {
  let i = 0;
  return {
    id: "scripted",
    async *stream(): AsyncGenerator<ProviderEvent> {
      const r = responses[i++];
      if (!r) {
        yield { type: "text", delta: "done" };
        yield { type: "done", stop: "end" };
        return;
      }
      const args = JSON.stringify(r.args);
      yield { type: "tool_start", id: `c${i}`, name: r.name };
      for (let k = 0; k < args.length; k += 13) yield { type: "tool_args", id: `c${i}`, delta: args.slice(k, k + 13) };
      yield { type: "tool_end", id: `c${i}` };
      yield { type: "done", stop: "tool_use" };
    },
  };
}

const plan = { generation: "tools" as const, tier: "extended" as const, examples: false, maxSteps: 3, reasons: [] };

test("a multi-turn run: form filled and submitted, confirmation checked, and replay reproduces the score", async () => {
  const scenario = SCENARIOS.find((s) => s.id === "beta-signup-flow")!;
  const provider = scripted([
    {
      name: "vak_render",
      args: {
        surface: "beta",
        nodes: [
          { id: "root", type: "form", props: { submit: "join" }, children: ["name", "email"] },
          { id: "name", type: "input", props: { label: "Name", bind: "/f/name", checks: ["required"] } },
          { id: "email", type: "input", props: { label: "Email", bind: "/f/email", kind: "email", checks: ["required", "email"] } },
        ],
      },
    },
    { name: "vak_render", args: { surface: "beta", nodes: [{ id: "root", type: "alert", props: { tone: "success", title: "Thanks, you're in!" } }] } },
  ]);
  const record = await runScenario(scenario, 0, { provider, model: "m", plan, runs: 1 });
  assert.equal(record.turns[1]!.action?.action, "join");
  assert.deepEqual(record.turns[1]!.action?.data, { name: "Alex Doe", email: "alex@example.com" });
  assert.equal(record.complete, true, JSON.stringify(record.turns.map((t) => t.checks)));
  const again = replay(record);
  assert.deepEqual([again.passed, again.total, again.complete], [record.passed, record.total, record.complete]);
});

test("an incomplete run is scored as such, and replay agrees", async () => {
  const scenario = SCENARIOS.find((s) => s.id === "sales-q3")!;
  const provider = scripted([{ name: "vak_render", args: { surface: "s", nodes: [{ id: "root", type: "stat", props: { label: "Revenue", value: "$1M" } }] } }]);
  const record = await runScenario(scenario, 0, { provider, model: "m", plan, runs: 1 });
  assert.equal(record.complete, false);
  assert.ok(record.passed >= 1 && record.passed < record.total);
  assert.deepEqual([replay(record).passed, replay(record).total], [record.passed, record.total]);
});
