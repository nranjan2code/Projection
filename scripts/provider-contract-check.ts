// Real primary-provider contract gate. This is not an outcome benchmark.
import { mkdir, writeFile } from "node:fs/promises";
import { basicCatalog, SurfaceStore } from "../packages/core/src/index.ts";
import { runAgent } from "../packages/providers/src/agent.ts";
import { ollama } from "../packages/providers/src/ollama.ts";
if (!process.argv.includes("--run-local")) throw new Error("Use --run-local for the free primary local provider contract check");
const model = "qwen3.5:4b-mlx";
const results = [];
for (const values of [[12, 17], [3, 2], [100, 70]]) {
  const actual = ollama(), store = new SurfaceStore(basicCatalog);
  let requests = 0;
  const provider = { ...actual, async *stream(request: Parameters<typeof actual.stream>[0]) { requests++; yield* actual.stream(request); } };
  const messages = [{ role: "user" as const, content: `Create exactly two text surfaces, one per value: ${JSON.stringify(values)}. Store each original number in data.value and visibly display it. No arithmetic or extra information.` }];
  const diagnostics: string[] = [];
  const started = Date.now();
  const result = await runAgent({ provider, model, store, catalog: { ...basicCatalog, components: { text: basicCatalog.components.text! } },
    messages,
    surfaceSubmission: true, completion: "response", maxSteps: 2, maxTokens: 1200, signal: AbortSignal.timeout(60000),
    validateCompletion: ({ surfaces, resolved }) => surfaces.length === values.length && values.every((value) => surfaces.some((surface, index) => surface.data.value === value && String(resolved[index]?.root?.props.content).split(/[^\d.-]+/).includes(String(value)))) ? [] : ["Each original numeric value must be stored in data.value and visible on its own text surface."], emit: (event) => { if (event.type === "tool_end" || event.type === "error") diagnostics.push(event.type === "error" ? event.message : event.result); },
  });
  results.push({ values, pass: result.stop === "end", requests, seconds: (Date.now() - started) / 1000, stop: result.stop, diagnostics, messages, surfaces: store.list().map((surface) => store.snapshot(surface.id)) });
  console.log(JSON.stringify({ values, pass: result.stop === "end", requests, stop: result.stop, diagnostics }));
}
await mkdir(".vak/contracts", { recursive: true });
const at = new Date().toISOString();
const receipt = `.vak/contracts/primary-provider-${at.replaceAll(":", "-")}.json`;
const report = JSON.stringify({ model, at, results }, null, 2);
await writeFile(receipt, report, { flag: "wx" });
await writeFile(".vak/contracts/primary-provider.json", report);
console.log(`Contract receipt: ${receipt}`);
if (results.some((result) => !result.pass)) process.exitCode = 1;
