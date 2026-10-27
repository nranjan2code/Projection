// Frozen real-provider contract: one record collection, several views and a
// local field edit. Expected values are checked independently, not precomputed
// in the authoring request or runtime schemas.
import { mkdir, writeFile } from "node:fs/promises";
import { basicCatalog, SurfaceStore, walk, type ResolvedNode, type JSONSchema } from "../packages/core/src/index.ts";
import { runAgent } from "../packages/providers/src/agent.ts";
import { ollama } from "../packages/providers/src/ollama.ts";
if (!process.argv.includes("--run-local")) throw new Error("Use --run-local for the free local record-view check");
const dataSchema: JSONSchema = { type: "object", additionalProperties: false, required: ["records"], properties: { records: { type: "array", minItems: 2, maxItems: 2, items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "number" } } } } } };
const results = [];
const tableOnly = process.argv.includes("--table-only");
for (const values of [[12, 17], [3, 2], [100, 70]]) {
  const records = values.map((value, i) => ({ label: `Record ${i + 1}`, value }));
  const actual = ollama(), store = new SurfaceStore(basicCatalog);
  const messages = [{ role: "user" as const, content: tableOnly ? `Show exactly one table using data.records=${JSON.stringify(records)}. Its rows must map to these records with fields label and value, not copy a separate array. No calculation or other view.` : `Create exactly one surface using data.records=${JSON.stringify(records)}. A form edits the first record's value, initially the supplied number, and submits review. Include a table, bar chart and total stat. All three views must use record mappings to this same collection: table rows {records:'{/records}',fields:['label','value']}; chart series {records:'{/records}',label:'label',fields:['value']}; stat value {records:'{/records}',field:'value',aggregate:'sum'}. Use structural children for the form input. Do not author separate result arrays or labels. Editing that input must update all views locally without an agent call.` }];
  let requests = 0; const diagnostics: string[] = [];
  const provider = { ...actual, async *stream(request: Parameters<typeof actual.stream>[0]) { requests++; yield* actual.stream(request); } };
  const started = Date.now();
  const result = await runAgent({ provider, model: "qwen3.5:4b-mlx", store, messages, dataSchema, surfaceCount: 1, catalog: { ...basicCatalog, components: Object.fromEntries((tableOnly ? ["table"] : ["stack", "form", "input", "text", "table", "chart", "stat"]).map(type => [type, basicCatalog.components[type]!])) }, surfaceSubmission: true, completion: "response", maxSteps: 2, maxTokens: 2400, signal: AbortSignal.timeout(60000), emit: e => { if (e.type === "tool_end") diagnostics.push(e.result); else if (e.type === "error") diagnostics.push(e.message); } });
  const check = (expected: number[]) => {
    const nodes: ResolvedNode[] = []; const surface = store.list()[0]; const root = surface && store.resolve(surface.id)?.root;
    if (root) walk(root, n => nodes.push(n));
    const table = nodes.find(n => n.type === "table"), chart = nodes.find(n => n.type === "chart"), metric = nodes.find(n => n.type === "stat");
    const tablePass = store.list().length === 1 && JSON.stringify(table?.props.rows) === JSON.stringify(records.map((r, i) => [r.label, expected[i]]));
    return tablePass && (tableOnly || JSON.stringify(chart?.props.series) === JSON.stringify([{ name: "value", values: expected }]) && JSON.stringify(chart?.props.labels) === JSON.stringify(records.map(r => r.label)) && metric?.props.value === expected.reduce((a, b) => a + b, 0));
  };
  let pass = result.stop === "end" && check(values); const issues = [];
  if (!pass) issues.push("Initial shared values or views failed");
  const snapshots = store.list().map(s => store.snapshot(s.id)!);
  if (pass && tableOnly) {
    store.setValue(store.list()[0]!.id, "/records/0/value", values[0]! + 1);
    pass = check([values[0]! + 1, values[1]!]);
    if (!pass) issues.push("Record edit failed to update mapped table");
  } else if (pass) {
    const s = store.list()[0]!, nodes: ResolvedNode[] = []; walk(store.resolve(s.id)!.root!, n => nodes.push(n));
    const input = nodes.find(n => n.type === "input" && n.bindPath === "/records/0/value"), form = nodes.find(n => n.type === "form");
    if (!input || !form || input.props.value !== values[0]) { pass = false; issues.push("Editable input/form missing"); }
    else {
      store.setValue(s.id, input.bindPath!, values[0]! + 1);
      const submitted = store.submit(s.id, form.key);
      if (!check([values[0]! + 1, values[1]!]) || submitted.action?.data.value !== values[0]! + 1) { pass = false; issues.push("Local edit or submitted value diverged across views"); }
    }
  }
  results.push({ values, result, pass, issues, requests, seconds: (Date.now() - started) / 1000, messages, diagnostics, surfaces: snapshots });
  console.log(JSON.stringify({ values, pass, issues, requests, stop: result.stop }));
}
const at = new Date().toISOString(), file = `.vak/contracts/record-view-${at.replaceAll(":", "-")}.json`;
await mkdir(".vak/contracts", { recursive: true }); await writeFile(file, JSON.stringify({ at, model: "qwen3.5:4b-mlx", dataSchema, tableOnly, results }, null, 2), { flag: "wx" });
console.log(`Contract receipt: ${file}`);
if (results.some(r => !r.pass)) process.exitCode = 1;
