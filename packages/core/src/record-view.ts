// Views select fields from one bound record collection. Projectors receive
// their ordinary rows/series/scalar shape; no second persistent data owner.
import type { JSONSchema } from "./schema.ts";

const binding: JSONSchema = { type: "string", pattern: "^\\{/?[^{}]*\\}$", description: "Reference the authoritative record collection, e.g. {/records}" };
const field: JSONSchema = { type: "string", minLength: 1, maxLength: 120 };
export function recordViewSchema(kind: "table" | "chart" | "metric"): JSONSchema {
  return { type: "object", additionalProperties: false, required: ["records", ...(kind === "metric" ? ["field", "aggregate"] : ["fields"]), ...(kind === "chart" ? ["label"] : [])], properties: {
    records: { anyOf: [{ type: "array", maxItems: 500, items: { type: "object" } }, binding], wire: binding },
    ...(kind === "metric" ? { field, aggregate: { type: "string", enum: ["sum", "mean", "min", "max", "count"] } as JSONSchema } : { fields: { type: "array", minItems: 1, maxItems: 32, items: field } as JSONSchema }),
    ...(kind === "chart" ? { label: field, x: field } : {}),
  } };
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export function isRecordView(v: unknown): v is Record<string, unknown> { return object(v) && Object.hasOwn(v, "records"); }

export function projectRecords(value: Record<string, unknown>, kind: "table" | "chart" | "metric"): Record<string, unknown> {
  const rows = value.records;
  if (!Array.isArray(rows) || rows.length > 500 || rows.some(row => !object(row))) throw new Error("A record view requires a bound collection of at most 500 records");
  const records = rows as Record<string, unknown>[];
  const read = (row: Record<string, unknown>, key: string): unknown => Object.hasOwn(row, key) ? row[key] : undefined;
  const numeric = (key: string) => records.map((row, index) => {
    const v = read(row, key);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Record ${index + 1} field ${JSON.stringify(key)} needs a finite number; missing data is not zero`);
    return v;
  });
  if (kind === "metric") {
    const key = String(value.field), aggregate = String(value.aggregate);
    if (aggregate === "count") return { value: records.filter(row => read(row, key) !== undefined && read(row, key) !== null).length };
    const values = numeric(key);
    if (!values.length) throw new Error("An empty numeric collection has no metric value");
    const sum = values.reduce((a, b) => a + b, 0);
    const result = aggregate === "sum" ? sum : aggregate === "mean" ? sum / values.length : aggregate === "min" ? Math.min(...values) : aggregate === "max" ? Math.max(...values) : NaN;
    if (!Number.isFinite(result)) throw new Error("Invalid or nonfinite metric aggregation");
    return { value: result };
  }
  const fields = value.fields;
  if (!Array.isArray(fields) || !fields.length || fields.length > 32 || fields.some(key => typeof key !== "string") || new Set(fields).size !== fields.length) throw new Error("A record view needs distinct field names");
  if (kind === "table") return { rows: records.map((row, i) => fields.map(key => {
    const v = read(row, key);
    if (v === undefined) throw new Error(`Record ${i + 1} has no field ${JSON.stringify(key)}; supply a value or explicit null`);
    if (v !== null && !["string", "number", "boolean"].includes(typeof v) || typeof v === "number" && !Number.isFinite(v)) throw new Error("Table record fields must be finite scalar values or null");
    return v;
  })) };
  const label = String(value.label);
  const labels = records.map((row, i) => {
    const v = read(row, label);
    if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v))) throw new Error(`Record ${i + 1} needs a category/time label at ${JSON.stringify(label)}`);
    return String(v);
  });
  return { labels, series: fields.map(key => ({ name: key, values: numeric(key), ...(value.x !== undefined ? { x: numeric(String(value.x)) } : {}) })) };
}

export function finalizeRecordView(props: Record<string, unknown>, key: "rows" | "series" | "value"): Record<string, unknown> {
  const view = props[key];
  if (!isRecordView(view)) return props;
  try {
    if (key === "series" && props.labels !== undefined) throw new Error("A record chart obtains labels from its label field; do not author a second labels list");
    if (key === "rows" && (!Array.isArray(props.columns) || props.columns.length !== (view.fields as unknown[])?.length)) throw new Error("Table columns must match the mapped fields in order");
    return { ...props, ...projectRecords(view, key === "rows" ? "table" : key === "series" ? "chart" : "metric") };
  } catch (error) { return { ...props, $error: (error as Error).message }; }
}
