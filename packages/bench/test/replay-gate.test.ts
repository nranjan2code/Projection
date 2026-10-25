// Regression gate: every recorded model output must score at least as well
// through today's engine as it did when recorded. Deterministic and free.
// Engine improvements raise scores; lock them in with `npm run bench -- replay --update`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { replay } from "../src/replay.ts";
import { basicCatalog } from "@vak/core";
import { BENCH_VERSION, SCENARIOS } from "../src/scenarios.ts";
import { readCassettes } from "../src/summary.ts";

const cassettes = readCassettes();
const current = cassettes.flatMap((c) => c.entries).filter((e) => e.benchVersion === BENCH_VERSION).length;

test(`replay gate has cassettes for bench v${BENCH_VERSION}`, { skip: current === 0 && `no cassettes at bench v${BENCH_VERSION} yet; re-record with: npm run bench -- run <provider:model> --save` }, () => {
  assert.ok(current > 0);
});

for (const { file, entries } of cassettes) {
  test(`replay gate: ${file}`, () => {
    const regressions: string[] = [];
    for (const entry of entries) {
      // v3 adds scenarios; the unchanged v2 scenarios must keep their protection.
      // A suite-version bump must not silently switch off historical recordings.
      if (entry.expected === undefined) continue;
      const now = replay(entry);
      const score = now.total ? now.passed / now.total : 0;
      if (score + 1e-9 < entry.expected) {
        regressions.push(`${entry.scenario}#${entry.run}: ${entry.expected.toFixed(2)} → ${score.toFixed(2)} (failing: ${now.failing.join("; ")})`);
      }
    }
    assert.deepEqual(regressions, [], `engine regressions on recorded model output:\n${regressions.join("\n")}`);
  });
}

// New rich payload checks need real model recordings, not just hand-written
// fixtures. Keep this mandatory so removing a slice cannot silently drop coverage.
test("every component and totals scenario has a current recorded replay score", () => {
  const entries = cassettes.flatMap((c) => c.entries);
  for (const scenario of SCENARIOS.filter((s) => s.turns.some((t) => t.expect.some((c) => c.kind === "prop")))) {
    const recorded = entries.filter((e) => e.benchVersion === BENCH_VERSION && e.scenario === scenario.id && e.expected !== undefined);
    assert.ok(recorded.some((e) => e.turns.length === scenario.turns.length && e.turns.every((t) => t.calls.length)), `missing recording: ${scenario.id}`);
  }
});

test("recorded totals arithmetic remains protected even when currency and margin formatting failed", () => {
  const entry = cassettes.flatMap((c) => c.entries).find((e) => e.scenario === "invoice-totals" && replay(e).views.some((v) => /Total \| 9 \| 65/.test(v)));
  assert.ok(entry, "need a real recording with computed units and revenue");
  const original = basicCatalog.components.table!;
  const broken = { ...basicCatalog, components: { ...basicCatalog.components, table: {
    ...original,
    finalize: (props: Record<string, unknown>) => {
      const out = original.finalize!(props);
      if (!out.totalsRow) return out;
      const columns = out.columns as { key: string }[];
      const rows = structuredClone(out.rows) as Record<string, unknown>[];
      rows.at(-1)![columns[1]!.key] = 999;
      rows.at(-1)![columns[2]!.key] = 999;
      return { ...out, rows };
    },
  } } };
  assert.equal(replay(entry, broken).passed, replay(entry).passed - 2);
});
