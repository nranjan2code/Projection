// Source-backed tables keep facts and arithmetic out of UI authoring.
import type { JSONSchema } from "./schema.ts";
export type SourceCell = string | number | boolean | null;
export interface TableSource { columns: string[]; rows: SourceCell[][]; filename: string; sha256: string; prepared?: boolean; summary?: Readonly<Record<string, SourceCell>> }
export type TableSources = Readonly<Record<string, TableSource>>;
export type Calculation = { column: string } | { parameter: string } | { sum: string } | { op: "add" | "subtract" | "multiply" | "divide" | "lte"; args: Calculation[] };
const scalar = (v: unknown): v is SourceCell => v === null || ["string", "boolean"].includes(typeof v) || typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export function validateTableSources(sources: TableSources): void {
  if (Object.keys(sources).length > 4 || JSON.stringify(sources).length > 100000) throw new Error("Table sources exceed their bound");
  for (const [id, source] of Object.entries(sources)) {
    if (["__proto__", "constructor", "prototype"].includes(id) || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || !source.columns.length || source.columns.length > 32 || new Set(source.columns).size !== source.columns.length || source.columns.some((key) => !key || key.length > 120) || source.rows.length > 500 || source.rows.some((row) => row.length !== source.columns.length || row.some((value) => !scalar(value))) || !source.filename || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid bounded table source");
  }
}
export function sourceTableSchema(sources: TableSources): JSONSchema {
  const prepared = Object.values(sources).every((source) => source.prepared);
  const schema: JSONSchema = { type: "object", required: ["source"], additionalProperties: false, properties: {
    source: { type: "string", enum: Object.keys(sources), description: "Immutable selected dataset; columns/rows are compiled from it, never copied. Source metadata: " + JSON.stringify(Object.entries(sources).map(([id, value]) => ({ id, filename: value.filename, columns: value.columns, rows: value.rows.length }))) },
    derive: { type: "array", description: "Append computed columns. Each key names a new column; its expression is evaluated for each source row using {column: originalColumnName} and numeric operations.", maxItems: 16, items: { type: "object", required: ["key", "expression"], additionalProperties: false, properties: { key: { type: "string", minLength: 1, maxLength: 80 }, expression: { $ref: "#/$defs/vak_row_calculation" } } } },
    summary: { type: "array", maxItems: 16, description: "Named summary calculations. Display requested interpretation in text using {/sources/<source>/summary/<key>}; source filename/hash are at {/sources/<source>/filename} and {/sources/<source>/sha256}.", items: { type: "object", required: ["key", "expression"], additionalProperties: false, properties: { key: { type: "string", minLength: 1, maxLength: 80 }, expression: { $ref: "#/$defs/vak_summary_calculation" } } } },
    total: { type: "object", description: "Append a total row: label in the first column, sums in sumColumns, and otherCells text in every nonsummed remaining cell.", additionalProperties: false, required: ["label", "sumColumns", "otherCells"], properties: { label: { type: "string", maxLength: 120 }, sumColumns: { type: "array", maxItems: 16, items: { type: "string" } }, otherCells: { type: "string", maxLength: 120 } } },
    sortable: { type: "boolean" }, searchable: { type: "boolean" },
  } };
  if (prepared) for (const key of ["derive", "summary", "total"]) delete schema.properties![key];
  return schema;
}
export const calculationSchema: JSONSchema = { anyOf: [
  ...["column", "parameter", "sum"].map((key) => ({ type: "object" as const, required: [key], additionalProperties: false, properties: { [key]: { type: "string" as const, minLength: 1, maxLength: 120 } } })),
  { type: "object", required: ["op", "args"], additionalProperties: false, properties: { op: { type: "string", enum: ["add", "subtract", "multiply", "divide", "lte"] }, args: { type: "array", minItems: 2, maxItems: 2, items: { $ref: "#/$defs/vak_calculation" } } } },
] };
export function compileSourceTable(raw: Record<string, unknown>, sources: TableSources, parameters: Readonly<Record<string, SourceCell>>): { props: Record<string, unknown>; data: Record<string, unknown>; id: string } {
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
  const summary = { ...source.summary, ...Object.fromEntries(declarations(raw.summary).map((entry) => [entry.key, evaluate(entry.expression)])) };
  if (object(raw.total)) {
    const total = raw.total;
    if (typeof total.label !== "string" || typeof total.otherCells !== "string" || !Array.isArray(total.sumColumns) || total.sumColumns.some((key) => typeof key !== "string" || !columns.includes(key)) || total.sumColumns.includes(columns[0])) throw new Error("Invalid total row declaration");
    const totals = columns.map((key, index): SourceCell => index === 0 ? total.label as string : (total.sumColumns as string[]).includes(key) ? evaluate({ sum: key }) : total.otherCells as string);
    rows.push(totals);
  }
  return { id, props: { columns, rows, totals: false, ...(raw.sortable === undefined ? {} : { sortable: raw.sortable }), ...(raw.searchable === undefined ? {} : { searchable: raw.searchable }) }, data: { filename: source.filename, sha256: source.sha256, summary } };
}
