// Where a turn's time goes, for one model: prompt size, time to the first
// token, how long the UI takes to stream, retries. Free with local Ollama:
//   node scripts/profile-turn.ts [provider:model] ["request"]

import { loadEnvFile } from "@vak/providers";
import { createVak } from "@vak/kit";

loadEnvFile(new URL("../.env", import.meta.url).pathname);
const model = process.argv[2] ?? "ollama:qwen3.5:4b-mlx";
const requests = process.argv[3] ? [process.argv[3]] : ["Show a Q3 sales dashboard: KPIs, a monthly revenue chart and top 5 products", "Now add a table of the 3 weakest regions"];
const t0 = { at: 0 };
let marks: [string, number][] = [];
const mark = (what: string) => marks.push([what, Date.now() - t0.at]);
const vak = createVak({
  model,
  onEvent: (e) => {
    if (e.type === "plan") mark(`plan ${e.generation}/${e.tier}/${e.examples ? "examples" : "plain"}`);
    if (e.type === "text_delta" && !marks.some(([w]) => w === "first text")) mark("first text");
    if (e.type === "tool_start") mark(`tool start ${e.name}`);
    if (e.type === "surface" && !marks.some(([w]) => w === "first surface")) mark("first surface");
    if (e.type === "tool_end") mark(`tool end ${e.name}${e.isError ? " (error, retry)" : ""}`);
    if (e.type === "run_end") mark(`run end (${e.stop})${e.usage ? ` · ${e.usage.input ?? "?"} tokens in, ${e.usage.output ?? "?"} out${e.usage.output ? ` (${((e.usage.output / (Date.now() - t0.at)) * 1000).toFixed(0)} tok/s overall)` : ""}` : ""}`);
  },
});
for (const q of requests) {
  marks = [];
  t0.at = Date.now();
  const r = await vak.ask(q);
  const sys = vak.messages.length;
  console.log(`\n${q}\n${"-".repeat(Math.min(q.length, 72))}`);
  for (const [w, ms] of marks) console.log(`${(ms / 1000).toFixed(1).padStart(6)}s  ${w}`);
  console.log(`surfaces: ${r.surfaces.map((s) => s.id).join(", ")} · messages so far: ${sys}`);
}
