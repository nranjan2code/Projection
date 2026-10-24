// vak benchmark CLI.
//
//   node scripts/bench.ts run  <provider:model> [--runs N] [--only id,id] [--category c]
//                              [--plan auto|tools/core/examples|...] [--judge provider:model] [--save]
//   node scripts/bench.ts gate <provider:model> [--runs N]     live run vs stored baseline
//   node scripts/bench.ts replay [--update]                    recorded outputs through today's engine
//   node scripts/bench.ts analyze <provider:model> [--show scenario-id]
//                              failing checks by frequency and category; --show prints what the
//                              user saw each turn and the model's raw calls
//   node scripts/bench.ts report <provider:model> [--url http://127.0.0.1:5177]
//                              project the stored baseline into the playground (session "bench")
//
// --save writes the baseline (packages/bench/data/baselines) and the cassette of
// raw model output (packages/bench/data/cassettes) that `npm test` replays.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import {
  appendCassette,
  BENCH_VERSION,
  type Baseline,
  fmtInterval,
  modelJudge,
  readBaseline,
  readCassettes,
  replay,
  runBench,
  type RunRecord,
  SCENARIOS,
  significantlyWorse,
  startCassette,
  summarize,
  type Summary,
  writeBaseline,
  writeCassette,
} from "../packages/bench/src/index.ts";
import { addUsage, type Usage } from "../packages/core/src/index.ts";
import { choosePlan, loadEnvFile, ProfileCache, type ProjectionPlan, providersFromEnv, resolveProfile } from "../packages/providers/src/index.ts";

const repo = new URL("..", import.meta.url).pathname;
// Report failures as one line (no stack/source echo) with a failing exit code.
const fail = (err: unknown) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
loadEnvFile(`${repo}.env`);
const [command = "run", target = "", ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? undefined : (rest[i + 1] && !rest[i + 1]!.startsWith("--") ? rest[i + 1] : "true");
};

function commit(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString().trim() ? "-dirty" : "";
    return sha + dirty;
  } catch {
    return "unknown";
  }
}

function split(spec: string): [string, string] {
  const i = spec.indexOf(":");
  if (i < 0) throw new Error(`expected provider:model, got "${spec}"`);
  return [spec.slice(0, i), spec.slice(i + 1)];
}

function makeProvider(id: string) {
  const entry = providersFromEnv().find((p) => p.id === id);
  if (!entry?.available) throw new Error(`provider ${id} unavailable${entry?.reason ? ` (${entry.reason})` : ""}`);
  return entry.make();
}

function printSummary(title: string, s: Summary): void {
  console.log(`\n${title}`);
  console.log(`  complete  ${fmtInterval(s.complete)}   (runs where every check passed, n=${s.runs})`);
  console.log(`  score     ${fmtInterval(s.score)}   (mean share of checks passed)`);
  if (s.judge) console.log(`  judge     ${fmtInterval(s.judge)}   (semantic grade, 1-5 mapped to 0-100%)`);
  console.log(`  median    ${(s.medianMs / 1000).toFixed(1)}s per scenario`);
  if (s.usage) console.log(`  tokens    in ${s.usage.input ?? "?"} (cached ${s.usage.cachedInput ?? 0}) · out ${s.usage.output ?? "?"}`);
  for (const [cat, c] of Object.entries(s.byCategory)) {
    console.log(`  ${cat.padEnd(12)} complete ${fmtInterval(c.complete).padEnd(18)} score ${fmtInterval(c.score)}`);
  }
}

async function live(
  spec: string,
  runs: number,
  persist?: (r: RunRecord, ctx: { provider: string; model: string; plan: ProjectionPlan; fingerprint: string; planned: number; records: RunRecord[] }) => void,
): Promise<{ records: RunRecord[]; summary: Summary; plan: ProjectionPlan; fingerprint: string; provider: string; model: string }> {
  const [providerId, model] = split(spec);
  const provider = makeProvider(providerId);
  const profile = await resolveProfile(providerId, provider, model, new ProfileCache(`${repo}.vak/models.json`));
  const planFlag = flag("plan");
  let plan = choosePlan(profile);
  if (planFlag && planFlag !== "auto") {
    const [generation, tier, examples] = planFlag.split("/");
    plan = { ...plan, generation: generation as ProjectionPlan["generation"], tier: tier as ProjectionPlan["tier"], examples: examples === "examples", reasons: [`--plan ${planFlag}`] };
  }
  console.log(`${spec} · plan ${plan.generation}/${plan.tier}/${plan.examples ? "examples" : "plain"} — ${plan.reasons.join("; ")}`);

  const only = flag("only")?.split(",");
  const category = flag("category");
  const scenarios = SCENARIOS.filter((s) => (!only || only.includes(s.id)) && (!category || s.category === category));
  let judgeUsage: Usage | undefined;
  const judgeSpec = flag("judge");
  const judge = judgeSpec
    ? (() => {
        const [jp, jm] = split(judgeSpec);
        return modelJudge(makeProvider(jp), jm, (u) => (judgeUsage = addUsage(judgeUsage, u)));
      })()
    : undefined;
  console.log(`${scenarios.length} scenarios × ${runs} runs${judge ? ` · judge ${judgeSpec}` : ""}\n`);

  const done: RunRecord[] = [];
  const records = await runBench({
    provider,
    model,
    plan,
    runs,
    scenarios,
    judge,
    onRecord: (r) => {
      done.push(r);
      persist?.(r, { provider: providerId, model, plan, fingerprint: profile.facts.fingerprint, planned: scenarios.length * runs, records: done });
      const ms = r.turns.reduce((a, t) => a + t.ms, 0);
      const failing = r.turns.flatMap((t) => t.checks.filter((c) => !c.pass).map((c) => c.check));
      console.log(
        `${r.complete ? "✔" : "✖"} ${r.scenario.padEnd(22)} #${r.run} ${r.passed}/${r.total} ${(ms / 1000).toFixed(1)}s` +
          (r.judge ? ` judge ${(r.judge.score * 4 + 1).toFixed(0)}/5` : "") +
          (failing.length ? `  ✗ ${failing.join("; ")}` : ""),
      );
    },
  });
  const summary = summarize(records);
  if (judgeUsage) console.log(`\njudge tokens: in ${judgeUsage.input ?? "?"} · out ${judgeUsage.output ?? "?"}`);
  return { records, summary, plan, fingerprint: profile.facts.fingerprint, provider: providerId, model };
}

/** Every live run's records go here as they finish; a stopped run loses nothing. */
function resultsFile(kind: string): string {
  mkdirSync(`${repo}packages/bench/data/results`, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${repo}packages/bench/data/results/${stamp}_${kind}_${target.replace(/[^\w.-]+/g, "_")}.jsonl`;
}

if (command === "run") {
  const runs = Number(flag("runs") ?? 1);
  const save = Boolean(flag("save"));
  const resultFile = resultsFile("run");
  console.log(`recording to ${resultFile}${save ? " (and the cassette + baseline)" : ""}`);
  if (save) startCassette(...split(target));
  const out = await live(target, runs, (r, ctx) => {
    appendFileSync(resultFile, JSON.stringify(r) + "\n");
    if (!save) return;
    // Expected replay score is measured now, through this engine, so the gate compares like with like.
    const rp = replay(r);
    appendCassette(ctx.provider, ctx.model, { ...r, expected: rp.total ? rp.passed / rp.total : 0 });
    writeBaseline({
      benchVersion: BENCH_VERSION,
      planned: ctx.planned,
      finished: ctx.records.length,
      provider: ctx.provider,
      model: ctx.model,
      fingerprint: ctx.fingerprint,
      config: { generation: ctx.plan.generation, tier: ctx.plan.tier, examples: ctx.plan.examples },
      commit: commit(),
      at: new Date().toISOString(),
      summary: summarize(ctx.records),
    });
  });
  printSummary(`${target} · bench v${BENCH_VERSION}`, out.summary);
  console.log(`\nresults: ${resultFile}${save ? `\nsaved baseline and cassette for ${target}` : ""}`);
} else if (command === "gate") {
  const [providerId, model] = split(target);
  const baseline = readBaseline(providerId, model);
  if (!baseline) throw new Error(`no baseline for ${target}; record one with: run ${target} --runs 2 --save`);
  if (baseline.benchVersion !== BENCH_VERSION) throw new Error(`baseline is bench v${baseline.benchVersion}, suite is v${BENCH_VERSION}: re-record it`);
  if (baseline.finished < baseline.planned) {
    throw new Error(`baseline for ${target} is partial (${baseline.finished}/${baseline.planned} runs); finish it with: run ${target} --runs N --save`);
  }
  const resultFile = resultsFile("gate");
  console.log(`recording to ${resultFile}`);
  const out = await live(target, Number(flag("runs") ?? 2), (r) => appendFileSync(resultFile, JSON.stringify(r) + "\n"));
  printSummary("baseline", baseline.summary);
  printSummary("now", out.summary);
  const failures: string[] = [];
  if (significantlyWorse(out.summary.complete, baseline.summary.complete)) failures.push("complete rate");
  if (significantlyWorse(out.summary.score, baseline.summary.score)) failures.push("check score");
  for (const [cat, c] of Object.entries(out.summary.byCategory)) {
    const b = baseline.summary.byCategory[cat];
    if (b && significantlyWorse(c.score, b.score)) failures.push(`${cat} score`);
  }
  if (failures.length) {
    console.error(`\n✖ significant regression: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\n✔ no significant regression against the baseline");
} else if (command === "replay") {
  const update = Boolean(flag("update") ?? (target === "--update" ? "true" : undefined));
  let regressions = 0, improvements = 0;
  for (const { file, entries } of readCassettes()) {
    const updated = entries.map((e) => {
      const rp = replay(e);
      const now = rp.total ? rp.passed / rp.total : 0;
      if (e.expected !== undefined && now < e.expected - 1e-9) {
        regressions++;
        console.log(`✖ ${file} ${e.scenario}#${e.run}: ${e.expected.toFixed(2)} → ${now.toFixed(2)}  failing: ${rp.failing.join("; ")}`);
      } else if (e.expected !== undefined && now > e.expected + 1e-9) {
        improvements++;
        console.log(`▲ ${file} ${e.scenario}#${e.run}: ${e.expected.toFixed(2)} → ${now.toFixed(2)}`);
      }
      return { ...e, expected: now };
    });
    if (update && regressions === 0) {
      const { provider, model } = entries[0]!;
      writeCassette(provider, model, updated);
    }
  }
  console.log(`\nreplay: ${regressions} regressions, ${improvements} improvements${update ? (regressions ? " (not updated: fix regressions first)" : " (expected scores updated)") : ""}`);
  if (regressions) process.exit(1);
} else if (command === "analyze") {
  const [providerId, model] = split(target);
  const entries = readCassettes().flatMap((c) => c.entries).filter((e) => e.provider === providerId && e.model === model);
  if (!entries.length) throw new Error(`no cassette for ${target}`);
  const show = flag("show");
  if (show) {
    for (const e of entries.filter((x) => x.scenario === show)) {
      const rp = replay(e);
      console.log(`\n=== ${e.scenario} #${e.run}: ${rp.passed}/${rp.total}  failing: ${rp.failing.join("; ") || "none"}`);
      e.turns.forEach((t, i) => {
        const turn = SCENARIOS.find((s) => s.id === e.scenario)!.turns[i]!;
        console.log(`\n--- turn ${i + 1}: ${turn.say ?? `[${turn.act?.target}] ${t.action ? JSON.stringify(t.action) : t.actError ?? ""}`}`);
        t.calls.forEach((c, k) => {
          console.log(`model → ${c.tool} ${c.args.length > 1500 ? `${c.args.slice(0, 1500)}… (${c.args.length} chars)` : c.args}`);
          const errs = rp.errors[i]?.[k] ?? [];
          if (errs.length) console.log(`  engine errors: ${errs.join(" | ")}`);
        });
        console.log(`user sees:\n${rp.views[i] ?? "(nothing)"}`);
      });
    }
  } else {
    const freq = new Map<string, number>();
    const byCat = new Map<string, Map<string, number>>();
    for (const e of entries) {
      const cat = SCENARIOS.find((s) => s.id === e.scenario)?.category ?? "?";
      for (const f of replay(e).failing) {
        freq.set(f, (freq.get(f) ?? 0) + 1);
        const m = byCat.get(cat) ?? new Map<string, number>();
        m.set(f, (m.get(f) ?? 0) + 1);
        byCat.set(cat, m);
      }
    }
    console.log(`${entries.length} runs; failing checks by frequency:`);
    for (const [f, n] of [...freq].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${f}`);
    for (const [cat, m] of byCat) console.log(`\n${cat}: ${[...m].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${n}× ${f}`).join(" · ")}`);
    console.log("\nper scenario:");
    for (const e of entries) {
      const rp = replay(e);
      console.log(`${rp.complete ? "✔" : "✖"} ${e.scenario.padEnd(22)} ${rp.passed}/${rp.total}${rp.failing.length ? `  ✗ ${rp.failing.join("; ")}` : ""}`);
    }
  }
} else if (command === "report") {
  const [providerId, model] = split(target);
  const b = readBaseline(providerId, model);
  if (!b) throw new Error(`no baseline for ${target}`);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ci = (i: { value: number; lo: number; hi: number }) => `${pct(i.value)} (${pct(i.lo)}–${pct(i.hi)})`;
  const s = b.summary;
  if (b.finished < b.planned) console.log(`note: partial baseline (${b.finished}/${b.planned} runs)`);
  // --compare <results.jsonl>: a later live run shown beside the baseline.
  const compareFile = flag("compare");
  const cmp = compareFile
    ? summarize(readFileSync(compareFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunRecord))
    : undefined;
  const categories = Object.entries(s.byCategory);
  const delta = (now: number, was: number) => `${now >= was ? "+" : ""}${Math.round((now - was) * 100)} pts`;
  const scenarioRows = Object.entries(s.byScenario).map(([id, r]) => {
    const c = cmp?.byScenario[id];
    return {
      scenario: id,
      category: SCENARIOS.find((x) => x.id === id)?.category ?? "",
      baseline: `${r.complete}/${r.runs} · ${pct(r.score)}`,
      ...(cmp ? { latest: c ? `${c.complete}/${c.runs} · ${pct(c.score)}` : "—", change: c ? (c.complete > r.complete ? "▲ now complete" : c.complete < r.complete ? "▼ regressed" : c.score > r.score ? "▲ score" : c.score < r.score ? "▼ score" : "=") : "" } : {}),
    };
  });
  const kpi = (label: string, base: { value: number; lo: number; hi: number }, now?: { value: number; lo: number; hi: number }) => ({
    label,
    value: now ? `${pct(base.value)} → ${pct(now.value)}` : pct(base.value),
    delta: now ? `${delta(now.value, base.value)} · now ${pct(now.lo)}–${pct(now.hi)}` : `95% CI ${pct(base.lo)}–${pct(base.hi)}`,
    ...(now ? { trend: now.value > base.value ? "up" : now.value < base.value ? "down" : "flat" } : {}),
  });
  const render = {
    surface: `bench-${providerId}-${model}`.replace(/[^\w-]/g, "_"),
    title: `Benchmark · ${providerId} / ${model}${cmp ? " · baseline vs latest" : ""}`,
    nodes: [
      { id: "root", type: "stack", children: ["meta", "kpis", "split", "scenarios"] },
      { id: "meta", type: "text", props: { variant: "caption", content: `${b.finished < b.planned ? `PARTIAL ${b.finished}/${b.planned} runs · ` : ""}bench v${b.benchVersion} · plan ${b.config.generation}/${b.config.tier}/${b.config.examples ? "examples" : "plain"} · baseline commit ${b.commit} · ${b.at.slice(0, 16).replace("T", " ")} · intervals are 95%${cmp ? ` · latest: ${compareFile!.split("/").pop()}` : ""}` } },
      { id: "kpis", type: "grid", props: { columns: 4, minItemWidth: "sm" }, children: ["k1", "k2", "k3", "k4"] },
      { id: "k1", type: "stat", props: kpi("Complete", s.complete, cmp?.complete) },
      { id: "k2", type: "stat", props: kpi("Check score", s.score, cmp?.score) },
      { id: "k3", type: "stat", props: { label: "Runs", value: cmp ? `${s.runs} · ${cmp.runs}` : s.runs, delta: `${Object.keys(s.byScenario).length} scenarios` } },
      { id: "k4", type: "stat", props: { label: "Median per scenario", value: `${(s.medianMs / 1000).toFixed(1)}s${cmp ? ` → ${(cmp.medianMs / 1000).toFixed(1)}s` : ""}`, delta: s.usage ? `${s.usage.input} in · ${s.usage.output} out tokens` : "" } },
      { id: "split", type: "grid", props: { columns: 2, minItemWidth: "lg" }, children: ["catTable", "catChart"] },
      {
        id: "catTable",
        type: "table",
        props: {
          columns: cmp ? ["Category", "Baseline complete", "Latest complete", "Score change"] : ["Category", "Runs", "Complete", "Score"],
          rows: categories.map(([cat, c]) => {
            const n = cmp?.byCategory[cat];
            return cmp
              ? { category: cat, baselineComplete: ci(c.complete), latestComplete: n ? ci(n.complete) : "—", scoreChange: n ? delta(n.score.value, c.score.value) : "—" }
              : { category: cat, runs: c.runs, complete: ci(c.complete), score: ci(c.score) };
          }),
        },
      },
      {
        id: "catChart",
        type: "chart",
        props: {
          kind: "bar",
          labels: categories.map(([c]) => c),
          series: cmp
            ? [
                { name: "baseline complete %", values: categories.map(([, c]) => Math.round(c.complete.value * 100)) },
                { name: "latest complete %", values: categories.map(([cat]) => Math.round((cmp.byCategory[cat]?.complete.value ?? 0) * 100)) },
              ]
            : [
                { name: "complete %", values: categories.map(([, c]) => Math.round(c.complete.value * 100)) },
                { name: "score %", values: categories.map(([, c]) => Math.round(c.score.value * 100)) },
              ],
        },
      },
      { id: "scenarios", type: "section", props: { title: "Scenarios", description: "complete runs / runs · mean share of checks passed" }, children: ["scenTable"] },
      { id: "scenTable", type: "table", props: { columns: cmp ? ["Scenario", "Category", "Baseline", "Latest", "Change"] : ["Scenario", "Category", "Baseline"], rows: scenarioRows } },
    ],
  };
  const url = flag("url") ?? "http://127.0.0.1:5177";
  const res = await fetch(`${url}/api/project`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "bench", tool: "vak_render", args: render }) });
  console.log(await res.text(), `→ ${url}/?session=bench`);
} else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
