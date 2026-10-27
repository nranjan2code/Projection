// Gate the actual source-backed path, separately from free-form graph authoring.
import { mkdir, writeFile } from "node:fs/promises";
import { basicCatalog, SurfaceStore } from "../packages/core/src/index.ts";
import { runAgent } from "../packages/providers/src/agent.ts";
import { ollama } from "../packages/providers/src/ollama.ts";
if (!process.argv.includes("--run-local")) throw new Error("Use --run-local for the free primary local source contract check");
const results = [];
for (const values of [[12, 17], [3, 2], [100, 70]]) {
  const rows = values.map((value, index) => [`record_${index + 1}`, value]);
  const actual = ollama(), store = new SurfaceStore(basicCatalog);
  let requests = 0;
  const provider = { ...actual, async *stream(request: Parameters<typeof actual.stream>[0]) { requests++; yield* actual.stream(request); } };
  const started = Date.now();
  const diagnostics: string[] = [];
  const result = await runAgent({ provider, model: "qwen3.5:4b-mlx", store, surfaceSubmission: true, completion: "response", maxSteps: 4, maxTokens: 1400, signal: AbortSignal.timeout(60000),
    messages: [{ role: "user", content: "Show the selected snapshot exactly as one interactive source report. No criteria, additional columns, calculations, summaries or total row are requested." }],
    tableSources: { selected: { filename: "selected.csv", sha256: "a".repeat(64), columns: ["id", "value"], rows } },
    validateCompletion: ({ surfaces }) => surfaces.length === 1 && JSON.stringify(surfaces[0]!.nodes.find((node) => node.type === "table")?.props?.rows) === JSON.stringify(rows) ? [] : ["Show precisely the selected source records, with no extra calculations, rows or criteria."],
    emit: (event) => { if (event.type === "tool_end" || event.type === "error") diagnostics.push(event.type === "error" ? event.message : event.result); },
  });
  results.push({ values, pass: result.stop === "end", requests, seconds: (Date.now() - started) / 1000, stop: result.stop, diagnostics, surfaces: store.list().map((surface) => store.snapshot(surface.id)) });
  console.log(JSON.stringify(results.at(-1)));
}
await mkdir(".vak/contracts", { recursive: true });
const at = new Date().toISOString(), receipt = `.vak/contracts/source-provider-${at.replaceAll(":", "-")}.json`;
await writeFile(receipt, JSON.stringify({ model: "qwen3.5:4b-mlx", at, results }, null, 2), { flag: "wx" });
console.log(`Contract receipt: ${receipt}`);
if (results.some((result) => !result.pass)) process.exitCode = 1;
