// Quality check on any model through the real agent loop.
// Usage: node scripts/eval.ts [provider:model] [runsPerPrompt] [auto|tools|constrained]
//   e.g. ollama:qwen3.5:4b-mlx · openai:<model id>   (keys come from .env)
// Env: VAK_DUMP=path writes raw model output of incomplete runs as JSONL.
//      VAK_CASES=n runs only the first n prompts (keeps paid-API checks small).
//
// Two measures per run:
//   valid    — the final surface has no engine errors
//   complete — the surface contains what the prompt asked for (rubric below)

import { appendFileSync, writeFileSync } from "node:fs";
import { addUsage, basicCatalog, SurfaceStore, type AgentEvent, type ResolvedNode, type Usage } from "../packages/core/src/index.ts";
import { loadEnvFile, providersFromEnv, runAgent, type Message } from "../packages/providers/src/index.ts";

loadEnvFile(new URL("../.env", import.meta.url).pathname);
const target = process.argv[2] ?? "ollama:qwen3.5:0.8b-mlx";
const sep = target.indexOf(":");
const providerId = target.slice(0, sep);
const model = target.slice(sep + 1);
const entry = providersFromEnv().find((p) => p.id === providerId);
if (!entry?.available) throw new Error(`provider "${providerId}" unavailable${entry?.reason ? ` (${entry.reason})` : ""}`);
const provider = entry.make();
const runs = Number(process.argv[3] ?? 2);
const generation = (process.argv[4] ?? "auto") as "auto" | "tools" | "constrained";
let usage: Usage | undefined;
const dump = process.env.VAK_DUMP;
if (dump) writeFileSync(dump, "");

type Counts = Map<string, number>;
const n = (c: Counts, t: string) => c.get(t) ?? 0;

const CASES: { prompt: string; rubric: string; ok: (c: Counts) => boolean }[] = [
  {
    prompt: "Compare three hotels in Kyoto for a week in November and let me book one",
    rubric: "≥3 cards or a table, plus a way to act (button/form/select)",
    ok: (c) => (n(c, "card") >= 3 || n(c, "table") >= 1) && n(c, "button") + n(c, "form") + n(c, "select") >= 1,
  },
  {
    prompt: "Show a Q3 sales dashboard: KPIs, a monthly revenue chart and top 5 products",
    rubric: "≥2 stats and a chart",
    ok: (c) => n(c, "stat") >= 2 && n(c, "chart") >= 1,
  },
  {
    prompt: "Plan a 5-day beginner workout routine, one tab per day",
    rubric: "tabs, or ≥5 sections/cards",
    ok: (c) => n(c, "tabs") >= 1 || n(c, "section") + n(c, "card") >= 5,
  },
  {
    prompt: "Make a newsletter signup form with name, email, topics and frequency",
    rubric: "≥2 inputs, a select or checkbox, and a form or button",
    ok: (c) => n(c, "input") >= 2 && n(c, "select") + n(c, "checkbox") >= 1 && n(c, "form") + n(c, "button") >= 1,
  },
];

function count(node: ResolvedNode | null, into: Counts = new Map()): Counts {
  if (!node) return into;
  into.set(node.type, n(into, node.type) + 1);
  for (const c of node.children) count(c, into);
  return into;
}

let valid = 0, complete = 0, total = 0;
const seconds: number[] = [];
const errorLines: string[] = [];

const cases = CASES.slice(0, Number(process.env.VAK_CASES ?? CASES.length));
for (const { prompt, rubric, ok } of cases) {
  for (let r = 0; r < runs; r++) {
    const store = new SurfaceStore(basicCatalog);
    const messages: Message[] = [{ role: "user", content: prompt }];
    const results: string[] = [];
    const t0 = Date.now();
    const out = await runAgent({
      provider, model, store, messages, generation, maxSteps: 3, maxTokens: 6000, signal: AbortSignal.timeout(120_000),
      emit: (e: AgentEvent) => {
        if (e.type === "tool_end") {
          results.push(e.result.split("\n")[0]!);
          for (const line of e.result.split("\n").slice(1)) if (line.includes("error")) errorLines.push(line.replace(/\[[^\]]*\]/, "[…]"));
        }
        if (e.type === "error") errorLines.push(`PROVIDER: ${e.message.slice(0, 200)}`);
        if (e.type === "run_end") usage = addUsage(usage, e.usage);
      },
    });
    const secs = (Date.now() - t0) / 1000;
    seconds.push(secs);
    const surface = store.list()[0];
    const counts = surface ? count(store.resolve(surface.id)!.root) : new Map<string, number>();
    const isValid = Boolean(surface) && !results.at(-1)?.includes("error");
    const isComplete = isValid && ok(counts);
    total++;
    if (isValid) valid++;
    if (isComplete) complete++;
    const kinds = [...counts].map(([k, v]) => `${k}×${v}`).join(" ") || "(no surface)";
    console.log(`${isComplete ? "✔" : isValid ? "~" : "✖"} ${secs.toFixed(1)}s ${out.stop} ${prompt.slice(0, 28)}… → ${kinds}${isValid && !isComplete ? `  [missing: ${rubric}]` : ""}`);
    if (dump && !isComplete) {
      const raw = messages.filter((m) => m.role === "assistant").map((m) => m.content || JSON.stringify(m.toolCalls));
      appendFileSync(dump, JSON.stringify({ prompt, raw, results }) + "\n");
    }
  }
}

const freq = new Map<string, number>();
for (const l of errorLines) freq.set(l, (freq.get(l) ?? 0) + 1);
if (freq.size) {
  console.log("\nerror kinds:");
  for (const [l, c] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${String(c).padStart(3)}  ${l}`);
}
seconds.sort((a, b) => a - b);
console.log(`\n${target} · ${generation}: valid ${valid}/${total} · complete ${complete}/${total} · median ${seconds[Math.floor(seconds.length / 2)]!.toFixed(1)}s`);
if (usage) console.log(`tokens: input ${usage.input ?? "?"} (cached ${usage.cachedInput ?? 0}) · output ${usage.output ?? "?"}`);
