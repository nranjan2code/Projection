// Regression gate: every recorded model output must score at least as well
// through today's engine as it did when recorded. Deterministic and free.
// Engine improvements raise scores; lock them in with `npm run bench -- replay --update`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { replay } from "../src/replay.ts";
import { BENCH_VERSION } from "../src/scenarios.ts";
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
      if (entry.benchVersion !== BENCH_VERSION || entry.expected === undefined) continue;
      const now = replay(entry);
      const score = now.total ? now.passed / now.total : 0;
      if (score + 1e-9 < entry.expected) {
        regressions.push(`${entry.scenario}#${entry.run}: ${entry.expected.toFixed(2)} → ${score.toFixed(2)} (failing: ${now.failing.join("; ")})`);
      }
    }
    assert.deepEqual(regressions, [], `engine regressions on recorded model output:\n${regressions.join("\n")}`);
  });
}
