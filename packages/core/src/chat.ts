// Shared by chat projectors (Telegram, Slack, Discord): the bound fields of a
// form in reading order, reading a typed answer into a field's value, and
// tables and charts as plain rows of text. Each projector only maps these to
// its platform's markup.

import type { ResolvedNode } from "./surface.ts";
import { isRequired, runChecks } from "./checks.ts";

export interface Choice {
  label: string;
  value: unknown;
}

export interface FormField {
  key: string;
  bindPath: string;
  type: string;
  label: string;
  required: boolean;
  checks: unknown;
  kind?: string;
  choices?: Choice[];
  multiple?: boolean;
  range?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}

const INPUT_TYPES = new Set(["input", "textarea", "select", "checkbox", "date"]);

function choicesOf(n: ResolvedNode): Choice[] | undefined {
  if (n.type === "checkbox") return [{ label: "Yes", value: true }, { label: "No", value: false }];
  if (n.type !== "select" || !Array.isArray(n.props.options)) return undefined;
  return n.props.options.map((o) =>
    o && typeof o === "object" ? { label: String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value), value: (o as Record<string, unknown>).value } : { label: String(o), value: o },
  );
}

/** The bound fields inside `scope`, in reading order. */
export function formFields(scope: ResolvedNode): FormField[] {
  const fields: FormField[] = [];
  const visit = (n: ResolvedNode) => {
    if (INPUT_TYPES.has(n.type) && n.bindPath) {
      fields.push({
        key: n.key,
        bindPath: n.bindPath,
        type: n.type,
        label: String(n.props.label ?? n.id),
        required: isRequired(n.props.checks),
        checks: n.props.checks,
        kind: typeof n.props.kind === "string" ? n.props.kind : undefined,
        choices: choicesOf(n),
        multiple: Boolean(n.props.multiple),
        range: Boolean(n.props.range),
        placeholder: typeof n.props.placeholder === "string" ? n.props.placeholder : undefined,
        ...(typeof n.props.min === "number" ? { min: n.props.min } : {}),
        ...(typeof n.props.max === "number" ? { max: n.props.max } : {}),
      });
    }
    n.children.forEach(visit);
  };
  visit(scope);
  return fields;
}

/**
 * A typed answer → the field's value, or the error to show. Empty answers
 * are `{ value: undefined }` for optional fields. Choice fields take a
 * choice label. The field's named checks run on the result.
 */
export function readField(field: FormField, text: string): { value: unknown } | { error: string } {
  const t = text.trim();
  if (t === "") return field.required ? { error: runChecks("", field.checks)[0] ?? "This field is required" } : { value: undefined };
  let value: unknown;
  if (field.choices) {
    const choice = field.choices.find((c) => c.label === t);
    if (!choice) return { error: `Please choose one of: ${field.choices.map((c) => c.label).join(", ")}` };
    value = choice.value;
  } else if (field.type === "date" && field.range) {
    const m = /^(\d{4}-\d{2}-\d{2})\s*(?:to|–|-{1,2}|→)\s*(\d{4}-\d{2}-\d{2})$/i.exec(t);
    if (!m) return { error: "Please send two dates like 2026-11-10 to 2026-11-17" };
    value = [m[1], m[2]];
  } else if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { error: "Please send a date like 2026-11-10" };
    value = t;
  } else if (field.kind === "number" || field.kind === "range" || field.kind === "rating") {
    const n = Number(t.replace(/\s*(stars?|★+)$/i, ""));
    const lo = field.min ?? (field.kind === "rating" ? 1 : undefined), hi = field.max ?? (field.kind === "rating" ? 5 : undefined);
    if (!Number.isFinite(n)) return { error: "Please send a number" };
    if ((lo !== undefined && n < lo) || (hi !== undefined && n > hi)) return { error: `Please send a number from ${lo ?? "…"} to ${hi ?? "…"}` };
    value = n;
  } else if (field.kind === "time") {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(t);
    let h = m ? Number(m[1]) : NaN;
    if (m?.[3]?.toLowerCase() === "p" && h < 12) h += 12;
    if (m?.[3]?.toLowerCase() === "a" && h === 12) h = 0;
    if (!m || h > 23 || Number(m[2] ?? 0) > 59) return { error: "Please send a time like 18:30" };
    value = `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
  } else value = t;
  const fails = runChecks(value, field.checks);
  return fails.length ? { error: fails.join("; ") } : { value };
}

export interface TextTable {
  headers: string[];
  align: ("start" | "center" | "end")[];
  rows: string[][];
}

const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A table node's props as text cells (columns already resolved to {key, label} by the catalog). */
export function tableText(props: Record<string, unknown>, maxColumns = Infinity): TextTable {
  const cols = ((Array.isArray(props.columns) ? props.columns : []) as Record<string, unknown>[]).slice(0, maxColumns);
  const rows = (Array.isArray(props.rows) ? props.rows : []).map((r) =>
    cols.map((c, i) => str(Array.isArray(r) ? r[i] : r && typeof r === "object" ? (r as Record<string, unknown>)[str(c.key)] : r)),
  );
  return {
    headers: cols.map((c) => str(c.label ?? c.key)),
    align: cols.map((c) => (c.align === "end" ? "end" : c.align === "center" ? "center" : "start")),
    rows,
  };
}

/** A chart's data as a table, for targets that cannot draw (a pie shows each share). */
export function chartText(props: Record<string, unknown>): TextTable {
  const labels = (Array.isArray(props.labels) ? props.labels : []).map(str);
  const series = (Array.isArray(props.series) ? props.series : []) as { name?: string; values?: number[] }[];
  if (props.kind === "scatter") {
    return {
      headers: [...(series.length > 1 ? [""] : []), "x", "y"],
      align: [...(series.length > 1 ? ["start" as const] : []), "end", "end"],
      rows: series.flatMap((s, si) => (s.values ?? []).map((v, i) => [...(series.length > 1 ? [s.name ?? `Series ${si + 1}`] : []), str((s as { x?: number[] }).x?.[i] ?? labels[i] ?? i + 1), str(v)])),
    };
  }
  if (props.kind === "pie" && series[0]?.values) {
    const values = series[0].values;
    const total = values.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
    return {
      headers: ["", series[0].name ?? "Value", "Share"],
      align: ["start", "end", "end"],
      rows: values.map((v, i) => [labels[i] ?? String(i + 1), str(v), `${Math.round((Number(v) / total) * 100)}%`]),
    };
  }
  return {
    headers: ["", ...series.map((s, i) => s.name ?? `Series ${i + 1}`)],
    align: ["start", ...series.map(() => "end" as const)],
    rows: labels.map((l, i) => [l, ...series.map((s) => str(s.values?.[i] ?? ""))]),
  };
}
