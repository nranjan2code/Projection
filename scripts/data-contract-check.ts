// Small real-provider boundary: typed data and a compatible table binding.
// --immutable-source encodes original caller records, never computed answers.
import { mkdir, writeFile } from "node:fs/promises";
import { basicCatalog, SurfaceStore, type JSONSchema } from "../packages/core/src/index.ts";
import { runAgent } from "../packages/providers/src/agent.ts";
import { ollama } from "../packages/providers/src/ollama.ts";
if (!process.argv.includes("--run-local")) throw new Error("Use --run-local for the free local data-binding contract check");
const dataSchema: JSONSchema = { type: "object", additionalProperties: false, required: ["rows"], properties: { rows: { type: "array", minItems: 2, maxItems: 2, items: { type: "array", minItems: 2, maxItems: 2, items: { type: ["string", "number"] } } } } };
const results = [];
const immutableSource = process.argv.includes("--immutable-source");
for (const values of [[12, 17], [3, 2], [100, 70]]) {
  const rows = values.map((v, i) => [`record_${i + 1}`, v]);
  const contract = structuredClone(dataSchema);
  if (immutableSource) contract.properties!.rows = { ...contract.properties!.rows, const: rows };
  const actual = ollama(), store = new SurfaceStore(basicCatalog), messages = [{ role: "user" as const, content: `Show exactly one interactive table of these records: ${JSON.stringify(rows)}. Store them in the declared data object and bind table rows to that data. No calculations, extra rows or other views.` }];
  let requests = 0; const diagnostics: string[] = [];
  const provider = { ...actual, async *stream(request: Parameters<typeof actual.stream>[0]) { requests++; yield* actual.stream(request); } };
  const started = Date.now();
  const result = await runAgent({ provider, model: "qwen3.5:4b-mlx", store, messages, dataSchema: contract, surfaceCount: 1, catalog: { ...basicCatalog, components: { table: basicCatalog.components.table! } }, surfaceSubmission: true, completion: "response", maxSteps: 2, maxTokens: 1200, signal: AbortSignal.timeout(60000), validateCompletion: ({ surfaces, resolved }) => {
    const s = surfaces[0], r = resolved[0]?.root;
    return surfaces.length === 1 && r?.type === "table" && JSON.stringify(s?.data.rows) === JSON.stringify(rows) && JSON.stringify(r.props.rows) === JSON.stringify(rows) && ["{/rows}", "{rows}"].includes(String(s?.nodes[0]?.props?.rows)) ? [] : ["Preserve the original records in data and visibly bind exactly one table to them, without extra rows or calculations."];
  }, emit: e => { if (e.type === "tool_end") diagnostics.push(e.result); else if (e.type === "error") diagnostics.push(e.message); } });
  results.push({ values, pass: result.stop === "end", result, requests, seconds: (Date.now() - started) / 1000, messages, diagnostics, surfaces: store.list().map(s => store.snapshot(s.id)) });
  console.log(JSON.stringify({ values, pass: results.at(-1)!.pass, requests, stop: result.stop }));
}
const at = new Date().toISOString(), file = `.vak/contracts/data-binding-${at.replaceAll(":", "-")}.json`;
await mkdir(".vak/contracts", { recursive: true });
await writeFile(file, JSON.stringify({ at, model: "qwen3.5:4b-mlx", dataSchema, immutableSource, results }, null, 2), { flag: "wx" });
console.log(`Contract receipt: ${file}`);
if (results.some(r => !r.pass)) process.exitCode = 1;
