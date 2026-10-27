// Source-backed tables keep facts and arithmetic out of UI authoring.
import type { JSONSchema } from "./schema.ts";
export type SourceCell = string | number | boolean | null;
export interface TableSource { columns: string[]; rows: SourceCell[][]; filename: string; sha256: string; totalLabel?: string; totalRow?: boolean; context?: ReadonlyArray<{ filename: string; sha256: string; content: string }>; notices?: readonly string[]; prepared?: boolean; explanation?: string; summary?: Readonly<Record<string, unknown>> }
export type TableSources = Readonly<Record<string, TableSource>>;
export type Calculation = { column: string } | { parameter: string } | { sum: string } | { op: "add" | "subtract" | "multiply" | "divide" | "lte"; args: Calculation[] };
const scalar = (v: unknown): v is SourceCell => v === null || ["string", "boolean"].includes(typeof v) || typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export function validateTableSources(sources: TableSources): void {
  if (Object.keys(sources).length > 4 || JSON.stringify(sources).length > 100000) throw new Error("Table sources exceed their bound");
  for (const [id, source] of Object.entries(sources)) {
    if (source.totalLabel !== undefined && (typeof source.totalLabel !== "string" || !source.totalLabel || source.totalLabel.length > 120)) throw new Error("Invalid declared total label");
    if (source.context !== undefined && (!Array.isArray(source.context) || source.context.length > 4 || source.context.some((context) => typeof context.filename !== "string" || !context.filename || context.filename.length > 120 || typeof context.content !== "string" || context.content.length > 16000 || !/^[a-f0-9]{64}$/.test(context.sha256)))) throw new Error("Invalid source context");
    if (source.notices !== undefined && (!Array.isArray(source.notices) || source.notices.length > 8 || source.notices.some((notice) => typeof notice !== "string" || notice.length > 120))) throw new Error("Invalid source notices");
    if (["__proto__", "constructor", "prototype"].includes(id) || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || !source.columns.length || source.columns.length > 32 || new Set(source.columns).size !== source.columns.length || source.columns.some((key) => typeof key !== "string" || !key || key.length > 120) || source.rows.length > 500 || source.rows.some((row) => row.length !== source.columns.length || row.some((value) => !scalar(value))) || typeof source.filename !== "string" || !source.filename || source.filename.length > 120 || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid bounded table source");
  }
}
export function sourceTableSchema(sources: TableSources): JSONSchema {
  const prepared = Object.values(sources).every((source) => source.prepared);
  const labels = [...new Set(Object.values(sources).flatMap((source) => source.totalLabel ? [source.totalLabel] : []))];
  const schema: JSONSchema = { type: "object", required: ["source"], additionalProperties: false, properties: {
    source: { type: "string", enum: Object.keys(sources), description: "Immutable selected dataset; columns/rows are compiled from it, never copied. Source metadata: " + JSON.stringify(Object.entries(sources).map(([id, value]) => ({ id, filename: value.filename, columns: value.columns, rows: value.rows.length }))) },
    derive: { type: "array", description: "Append computed columns. Each key names a new column; its expression is evaluated for each source row using {column: originalColumnName} and numeric operations.", maxItems: 16, items: { type: "object", required: ["key", "expression"], additionalProperties: false, properties: { key: { type: "string", minLength: 1, maxLength: 80 }, expression: { $ref: "#/$defs/vak_row_calculation" } } } },
    summary: { type: "array", maxItems: 16, description: "Named summary calculations. Display requested interpretation in text using {/sources/<source>/summary/<key>}; source filename/hash are at {/sources/<source>/filename} and {/sources/<source>/sha256}.", items: { type: "object", required: ["key", "expression"], additionalProperties: false, properties: { key: { type: "string", minLength: 1, maxLength: 80 }, expression: { $ref: "#/$defs/vak_summary_calculation" } } } },
    comparisons: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, required: ["parameter", "relation"], properties: { column: { type: "string", description: "optional when total.sumColumns selects one column; that total is used automatically" }, parameter: { type: "string" }, relation: { type: "string", enum: ["at_most", "at_least"] }, label: { type: "string", maxLength: 120 } } } },
    total: { type: "object", description: "Append a total row: label in the first column, sums in sumColumns, and otherCells text in every nonsummed remaining cell.", additionalProperties: false, required: ["label", "sumColumns", "otherCells"], properties: { label: { type: "string", maxLength: 120, ...(labels.length ? { enum: labels } : {}) }, sumColumns: { type: "array", maxItems: 16, items: { type: "string" } }, otherCells: { type: "string", maxLength: 120 } } },
    sortable: { type: "boolean" }, searchable: { type: "boolean" },
  } };
  if (prepared) for (const key of ["derive", "summary", "total", "comparisons"]) delete schema.properties![key];
  return schema;
}
export const calculationSchema: JSONSchema = { anyOf: [
  ...["column", "parameter", "sum"].map((key) => ({ type: "object" as const, required: [key], additionalProperties: false, properties: { [key]: { type: "string" as const, minLength: 1, maxLength: 120 } } })),
  { type: "object", required: ["op", "args"], additionalProperties: false, properties: { op: { type: "string", enum: ["add", "subtract", "multiply", "divide", "lte"] }, args: { type: "array", minItems: 2, maxItems: 2, items: { $ref: "#/$defs/vak_calculation" } } } },
] };
export function compileSourceTable(raw: Record<string, unknown>, sources: TableSources, parameters: Readonly<Record<string, SourceCell>>): { props: { columns: string[]; rows: SourceCell[][]; totals: boolean; totalsRow: boolean; sortable?: boolean; searchable?: boolean }; data: { filename: string; sha256: string; summary: Record<string, unknown>; explanation: string }; id: string } {
  if (raw.sortable !== undefined && typeof raw.sortable !== "boolean" || raw.searchable !== undefined && typeof raw.searchable !== "boolean") throw new Error("Source interaction settings must be boolean");
  const id = String(raw.source), source = sources[id];
  if (!source) throw new Error("Unknown selected table source");
  const columns = [...source.columns], rows = source.rows.map((row) => [...row]);
  let operations = 0;
  const evaluate = (expr: unknown, row?: SourceCell[], depth = 0): SourceCell => {
    if (++operations > 100000 || depth > 8 || !object(expr)) throw new Error("Calculation exceeds its bounds");
    if (typeof expr.column === "string" && Object.keys(expr).length === 1) {
      const index = columns.indexOf(expr.column); if (!row || index < 0) throw new Error(`Row calculation needs one of these column names: ${JSON.stringify(columns)}; received ${JSON.stringify(expr.column)}`); return row[index]!;
    }
    if (typeof expr.parameter === "string" && Object.keys(expr).length === 1) {
      if (!Object.hasOwn(parameters, expr.parameter)) throw new Error(`Calculation parameter must be one of ${JSON.stringify(Object.keys(parameters))}`); return parameters[expr.parameter]!;
    }
    if (typeof expr.sum === "string" && Object.keys(expr).length === 1) {
      const index = columns.indexOf(expr.sum); if (row || index < 0) throw new Error(`Summary sum needs one of these columns: ${JSON.stringify(columns)}; received ${JSON.stringify(expr.sum)}`);
      const sum = rows.reduce((sum, item) => { const value = item[index]; if (typeof value !== "number") throw new Error("Cannot sum nonnumeric source values"); return sum + value; }, 0);
      if (!Number.isFinite(sum)) throw new Error("Nonfinite source total"); return sum;
    }
    if (!Array.isArray(expr.args) || expr.args.length !== 2 || Object.keys(expr).some((key) => !["op", "args"].includes(key))) throw new Error("Invalid typed calculation");
    const [a, b] = expr.args.map((arg) => evaluate(arg, row, depth + 1));
    if (typeof a !== "number" || typeof b !== "number") throw new Error("Calculation operands must be numbers");
    if (expr.op === "lte") return a <= b;
    const result = expr.op === "add" ? a + b : expr.op === "subtract" ? a - b : expr.op === "multiply" ? a * b : expr.op === "divide" && b !== 0 ? a / b : NaN;
    if (!Number.isFinite(result)) throw new Error("Invalid or nonfinite calculation result"); return result;
  };
  const declarations = (value: unknown) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 16 || value.some((entry) => !object(entry) || typeof entry.key !== "string" || ["__proto__", "constructor", "prototype"].includes(entry.key) || !/^[A-Za-z_][\w-]{0,79}$/.test(entry.key))) throw new Error("Invalid calculation declarations");
    const seen = new Set<string>();
    return value.map((entry) => { if (seen.has(entry.key)) throw new Error("Duplicate calculation key"); seen.add(entry.key); return entry as { key: string; expression: Calculation }; });
  };
  for (const derived of declarations(raw.derive)) {
    if (columns.includes(derived.key)) throw new Error("A calculation cannot replace a source column");
    const values = rows.map((row) => evaluate(derived.expression, row)); columns.push(derived.key); rows.forEach((row, index) => row.push(values[index]!));
  }
  const summary: Record<string, unknown> = { ...source.summary, ...Object.fromEntries(declarations(raw.summary).map((entry) => [entry.key, evaluate(entry.expression)])) };
  const comparisonResults: Record<string, SourceCell>[] = [];
  const descriptions: string[] = [];
  if (raw.comparisons !== undefined) {
    if (!Array.isArray(raw.comparisons) || raw.comparisons.length > 16) throw new Error("Invalid source comparisons");
    for (const comparison of raw.comparisons) {
      if (!object(comparison)) throw new Error("Invalid typed source comparison");
      const totalColumns = object(raw.total) && Array.isArray(raw.total.sumColumns) ? raw.total.sumColumns : [];
      const column = comparison.column ?? (totalColumns.length === 1 ? totalColumns[0] : undefined);
      if (typeof column !== "string" || totalColumns.length && !totalColumns.includes(column)) throw new Error("Comparison must name a declared total column (omit column when exactly one total is selected)");
      if (typeof comparison.parameter !== "string" || !["at_most", "at_least"].includes(String(comparison.relation))) throw new Error("Invalid typed source comparison");
      const limit = parameters[comparison.parameter], total = evaluate({ sum: column });
      if (typeof limit !== "number" || typeof total !== "number") throw new Error("A comparison needs a numeric caller parameter and column total");
      const within = comparison.relation === "at_most" ? total <= limit : total >= limit;
      const remaining = comparison.relation === "at_most" ? limit - total : total - limit;
      const name = comparison.parameter.split("/").filter(Boolean).at(-1)!.replaceAll("_", " ");
      const label = typeof comparison.label === "string" && comparison.label ? comparison.label : `Total (${column})`;
      descriptions.push(`${label}: ${total}. ${comparison.relation === "at_most" ? "Available" : "Required"} ${name}: ${limit}. ${comparison.relation === "at_most" ? "Remaining" : "Excess"} ${name}: ${remaining}. ${comparison.relation === "at_most" ? "Within" : "Meets"} ${name}: ${within ? "yes" : "no"}.`);
      comparisonResults.push({ column, parameter: comparison.parameter, total, limit, remaining, within, relation: String(comparison.relation) });
    }
  }
  if (comparisonResults.length) summary.comparisons = comparisonResults;
  if (object(raw.total)) {
    const total = raw.total;
    if (source.totalLabel && total.label !== source.totalLabel) throw new Error("Total label must match the caller declaration");
    if (typeof total.label !== "string" || typeof total.otherCells !== "string" || !Array.isArray(total.sumColumns) || total.sumColumns.some((key) => typeof key !== "string" || !columns.includes(key)) || total.sumColumns.includes(columns[0])) throw new Error("Invalid total row declaration");
    const totals = columns.map((key, index): SourceCell => index === 0 ? total.label as string : (total.sumColumns as string[]).includes(key) ? evaluate({ sum: key }) : total.otherCells as string);
    rows.push(totals);
  }
  const evidence = source.prepared ? [] : [
    ...(source.notices?.length ? [source.notices.join(" · ")] : []),
    `Source snapshot: ${source.filename}`,
    ...(source.context ?? []).map((context) => `Context snapshot: ${context.filename}\n${context.content}`),
  ];
  return { id, props: { columns, rows, totals: false, totalsRow: Boolean(raw.total) || source.totalRow === true, ...(raw.sortable === undefined ? {} : { sortable: raw.sortable as boolean }), ...(raw.searchable === undefined ? {} : { searchable: raw.searchable as boolean }) }, data: { filename: source.filename, sha256: source.sha256, summary, explanation: [...descriptions, ...evidence].filter(Boolean).join("\n\n") || source.explanation || "" } };
}
