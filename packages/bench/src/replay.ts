// Replay: re-apply a recorded run's exact model output through the current
// engine and re-score it. Deterministic and free, so it can gate every commit.

import { basicCatalog, type Catalog, parseLenient, SurfaceStore } from "@vak/core";
import { evaluate } from "./rubric.ts";
import { checkContext, RENDERS_CLEANLY, type RunRecord, scoreTurns, snapshotOf, type TurnRecord } from "./runner.ts";
import { SCENARIOS } from "./scenarios.ts";
import { performAct } from "./simulate.ts";

export interface ReplayResult {
  scenario: string;
  run: number;
  passed: number;
  total: number;
  complete: boolean;
  /** Checks that fail on replay, for diagnosis. */
  failing: string[];
  /** What the user saw after each turn (text projection), for diagnosis. */
  views: string[];
  /** Engine errors per turn, per call, for diagnosis. */
  errors: string[][][];
}

export function replay(record: RunRecord, catalog: Catalog = basicCatalog): ReplayResult {
  const scenario = SCENARIOS.find((s) => s.id === record.scenario);
  if (!scenario) throw new Error(`unknown scenario ${record.scenario}`);
  const store = new SurfaceStore(catalog);
  const turns: TurnRecord[] = [];
  let active: string | undefined;
  let before: ReturnType<typeof snapshotOf>;
  const views: string[] = [];
  const errors: string[][][] = [];

  for (const [i, turn] of scenario.turns.entries()) {
    const recorded = record.turns[i];
    if (!recorded) break;
    const rec: TurnRecord = { calls: recorded.calls, checks: [], ms: 0, stop: recorded.stop };
    turns.push(rec);
    if (turn.act) {
      const out = active ? performAct(store, active, turn.act) : { error: "nothing on screen to act on" };
      if ("error" in out) {
        rec.checks = [{ check: RENDERS_CLEANLY, pass: false }, ...turn.expect.map(() => ({ check: "(action failed)", pass: false }))];
        break;
      }
    }
    let errored = false;
    const turnErrors: string[][] = [];
    errors.push(turnErrors);
    for (const call of recorded.calls) {
      let args: unknown;
      try {
        args = parseLenient(call.args);
      } catch {
        args = {};
      }
      const versions = new Map(store.list().map((st) => [st.id, st.version]));
      const diagnostics = store.apply(call.tool, args);
      // Like the live run: the turn's last projection decides cleanliness.
      errored = diagnostics.some((d) => d.severity === "error");
      turnErrors.push(diagnostics.filter((d) => d.severity === "error").map((d) => `${d.node ? `[${d.node}] ` : ""}${d.message}`));
      // The surface this call created or changed becomes the one on screen.
      const touched = store.list().find((st) => versions.get(st.id) !== st.version);
      if (touched) active = touched.id;
    }
    const ctx = checkContext(store, active, before);
    const clean = Boolean(ctx.surface) && !errored && recorded.stop !== "error";
    rec.checks = [{ check: RENDERS_CLEANLY, pass: clean }, ...evaluate(turn.expect, ctx)];
    views.push(ctx.text);
    before = snapshotOf(ctx);
  }
  const score = scoreTurns(turns);
  return {
    scenario: record.scenario,
    run: record.run,
    ...score,
    failing: turns.flatMap((t) => t.checks.filter((c) => !c.pass).map((c) => c.check)),
    views,
    errors,
  };
}
