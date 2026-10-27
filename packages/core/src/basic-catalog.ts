// Starter component set. Props are semantic (tone, size, priority), never pixels,
// so every projector can interpret them for its surface.
//
// Repair knowledge is declared here, beside what it repairs, so the engine
// stays generic:
// - component `aliases`: other names models use (HTML tags, other UI kits)
// - property `aliases` / `enumAliases`: other spellings of props and values
// - property `namesComponent`: a value outside the enum that names another component retypes the node
// - schema `default`: a sensible value for a required prop the model omitted
// - `defaults`: props derivable from other props (an input's label from its bind)
// - `normalize`: shape fixes for component-specific data (chart series)

import { defineCatalog, type ItemField } from "./catalog.ts";
import { cell, type Row, totalsRow } from "./interact.ts";
import { coerce, type JSONSchema } from "./schema.ts";

type Extra = Pick<JSONSchema, "aliases" | "enumAliases" | "namesComponent" | "description" | "default" | "format" | "literal">;

const str = (extra: Extra = {}): JSONSchema => ({ type: "string", ...extra });
const oneOf = (values: string[], extra: Extra = {}): JSONSchema => ({ type: "string", enum: values, ...extra });
const bool = (extra: Extra = {}): JSONSchema => ({ type: "boolean", ...extra });
const num = (extra: Extra = {}): JSONSchema => ({ type: "number", ...extra });
const props = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
});

/** A string standing for data: only a `{/path}` binding, so JSON-looking strings are parsed instead. */
const binding: JSONSchema = { type: "string", pattern: "^\\{/?[^{}]*\\}$", description: "{/path}" };
/** A list prop: the list itself, or a binding to one in the data model. */
const listOr = (list: JSONSchema, extra: Extra = {}): JSONSchema => ({ anyOf: [list, binding], ...extra });
/** Prose the engine treats as markdown (inline HTML is converted). */
const md = (extra: Extra = {}): JSONSchema => str({ description: "markdown", format: "markdown", ...extra });

const tone = oneOf(["neutral", "info", "success", "warning", "danger"], {
  aliases: ["variant", "status", "severity", "color"],
  enumAliases: { error: "danger", critical: "danger", negative: "danger", warn: "warning", ok: "success", positive: "success", default: "neutral" },
});
const gap = oneOf(["sm", "md", "lg"], { aliases: ["spacing"], enumAliases: { small: "sm", medium: "md", large: "lg", xs: "sm", xl: "lg" } });
const checks: JSONSchema = { type: "array", items: { type: "string" }, aliases: ["validation", "validate", "rules"] };

// Shared property shapes for inputs.
const fieldLabel = str({ aliases: ["title", "text", "caption"] });
const fieldBind = str({ description: "/path", aliases: ["path", "key", "field", "model", "name"] });
const placeholder = str({ aliases: ["hint"] });

/** "/form/firstName" → "First name", "email_address" → "Email address". */
function humanize(raw: string): string {
  const words = raw
    .replace(/^.*\//, "")
    .split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** An input's label and bind path are each derivable from the other (or the node id). */
function fieldDefaults(p: Record<string, unknown>, { id }: { id: string }): Record<string, unknown> {
  const label = typeof p.label === "string" && p.label ? p.label : undefined;
  const bind = typeof p.bind === "string" && p.bind ? p.bind : `/form/${slug(label ?? id) || id}`;
  return { bind, label: label ?? humanize(bind) };
}

/** A button's visible label and its action name are each derivable from the other. */
function buttonDefaults(p: Record<string, unknown>, { id }: { id: string }): Record<string, unknown> {
  const label = typeof p.label === "string" && p.label ? p.label : humanize(typeof p.action === "string" && p.action ? p.action : id);
  return { label, action: typeof p.action === "string" && p.action ? p.action : slug(label) || id };
}

const words = (s: string) => s.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean).map((w) => w.toLowerCase());
const flat = (s: string) => words(s).join("");

/**
 * Table columns given as plain strings may be row keys ("units") or display
 * labels ("Units sold"); the rows decide. Each string column is matched to a
 * row key: same normalized text, then one side's words containing the other's,
 * then position when column and key counts line up. Output is always
 * [{key, label}] so projectors never guess.
 */
/**
 * Items written as bare strings ("2026: Founded", "Pune, India") become
 * objects with that text in `field` (a small model lists text before it
 * remembers the item shape).
 */
function itemObjects(v: unknown, field = "title"): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((it) => {
    if (typeof it !== "string") return it;
    const m = field === "title" ? /^\s*([^:—–-]{1,24}?)\s*[:—–-]\s+(.+)$/.exec(it) : null;
    return m && /\d/.test(m[1]!) ? { date: m[1]!.trim(), title: m[2]!.trim() } : { [field]: it };
  });
}

function finalizeTable(p: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(p.columns)) return p;
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const first = rows.find((r) => r && typeof r === "object" && !Array.isArray(r)) as Record<string, unknown> | undefined;
  const keys = first ? Object.keys(first) : [];
  const taken = new Set<string>();
  const columns = p.columns.map((c) => (c && typeof c === "object" ? { ...(c as object) } : { label: String(c) })) as Record<string, unknown>[];
  const pick = (test: (label: string, key: string) => boolean) => {
    for (const col of columns) {
      if (col.key !== undefined || typeof col.label !== "string") continue;
      const key = keys.find((k) => !taken.has(k) && test(col.label as string, k));
      if (key !== undefined) {
        col.key = key;
        taken.add(key);
      }
    }
  };
  if (keys.length) {
    pick((label, key) => flat(label) === flat(key));
    pick((label, key) => {
      const l = words(label), k = words(key);
      return k.every((w) => l.includes(w)) || l.every((w) => k.includes(w));
    });
    const open = columns.filter((c) => c.key === undefined);
    const free = keys.filter((k) => !taken.has(k));
    if (open.length && open.length === free.length) open.forEach((c, i) => (c.key = free[i]));
  }
  // Arrays-of-arrays rows, or nothing matched: the column's own text is the key.
  for (const col of columns) if (col.key === undefined) col.key = col.label;
  for (const col of columns) if (col.label === undefined) col.label = col.key;
  if (p.totals !== true) return { ...p, columns };
  // Computed, never trusted from the model: a total row it wrote itself is
  // replaced (small models add up wrong), and every projector shows the result.
  const cols = columns as { key: string }[];
  const labelled = (r: unknown) => cols.some((c, i) => /^(grand\s+)?totals?\b/i.test(String(cell(r, c, i) ?? "")));
  const body = rows.length && labelled(rows.at(-1)) ? rows.slice(0, -1) : rows;
  const total = totalsRow(body as Row[], cols);
  return total ? { ...p, columns, rows: [...body, total], totalsRow: true } : { ...p, columns, rows: body };
}

const numeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/** A point as [x, y] or {x, y}. */
const xy = (v: unknown): [number, number] | undefined => {
  const o = v as Record<string, unknown>;
  const pair = Array.isArray(v) && v.length === 2 ? v : o && typeof o === "object" && "x" in o && "y" in o ? [o.x, o.y] : undefined;
  return pair && numeric(pair[0]) && numeric(pair[1]) ? [Number(pair[0]), Number(pair[1])] : undefined;
};

/**
 * Scatter points written as [x, y] pairs or {x, y} records, as a bare list
 * (one series) or as a series' values, become values plus their x. Without
 * this a pair list reads as many two-value series.
 */
function scatterPoints(p: Record<string, unknown>): Record<string, unknown> {
  const s = p.series;
  if (p.kind !== "scatter" || !Array.isArray(s) || !s.length) return p;
  const split = (pts: unknown[]) => {
    const ok = pts.map(xy);
    return ok.every(Boolean) ? { x: ok.map((q) => q![0]), values: ok.map((q) => q![1]) } : undefined;
  };
  const whole = split(s);
  if (whole) return { ...p, series: [whole] };
  const series = s.map((it) => {
    const o = it as Record<string, unknown>;
    const pts = o && typeof o === "object" ? (["values", "data", "points"].map((k) => o[k]).find(Array.isArray) as unknown[] | undefined) : undefined;
    const sp = pts && pts.length && pts.every((v) => !numeric(v)) ? split(pts) : undefined;
    return sp ? { ...(typeof o.name === "string" ? { name: o.name } : {}), ...sp } : it;
  });
  return { ...p, series };
}

/** Canonicalize the series shorthands the schema accepts into [{name?, values}]. */
function normalizeChart(p: Record<string, unknown>): Record<string, unknown> {
  p = scatterPoints(p);
  const s = p.series;
  if (!Array.isArray(s) || s.length === 0) return p;
  if (s.every(numeric)) return { ...p, series: [{ values: s.map(Number) }] };
  if (s.every((v) => Array.isArray(v))) return { ...p, series: (s as unknown[][]).map((values) => ({ values: values.map(Number) })) };
  // A series of annotations ("Peak Day": ["N/A", ..., "Fri peak"]) beside real
  // ones (4B, bench web-analytics) has nothing to plot: it is dropped rather
  // than failing the whole chart.
  const values = (x: unknown) => (x && typeof x === "object" && Array.isArray((x as { values?: unknown }).values) ? ((x as { values: unknown[] }).values) : undefined);
  const plottable = (x: unknown) => !values(x) || values(x)!.some(numeric);
  if (s.some(plottable) && !s.every(plottable)) return { ...p, series: s.filter(plottable) };
  return p;
}

/**
 * Series bound to records, `{/distances/daily_km}` with [{day, km}, ...] (4B,
 * running stats): the rows of a table, not series. Each field that holds a
 * number in every row that has it is a series named after the field, and a
 * text field labels the points when the chart has no labels. A row without
 * the field is a gap (null), which the resolved-props check reports, so the
 * model fills it rather than the chart silently dropping the point. After
 * bindings resolve, so the shorthands normalizeChart reads apply here too.
 * A record of numbers is one series, a point per key.
 */
function finalizeChart(p: Record<string, unknown>): Record<string, unknown> {
  const s = p.series;
  const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
  // `{/data/expense_totals}` with {"Rent/Mortgage": 750, "Utilities": 180, ...}
  // (4B, budget tracker): one series, a point per key, labelled by the keys
  // when the chart has no labels of its own.
  if (record(s) && Object.keys(s).length && Object.values(s).every(numeric)) {
    const labels = Array.isArray(p.labels) && p.labels.length ? p.labels : Object.keys(s);
    return { ...p, series: [{ values: Object.values(s).map(Number) }], labels };
  }
  const hasValues = (r: Record<string, unknown>) => ["values", "data", "points", "y"].some((k) => Array.isArray(r[k]));
  if (!Array.isArray(s) || !s.length || !s.every(record) || s.some(hasValues)) return normalizeChart(p);
  const keys = [...new Set(s.flatMap((r) => Object.keys(r)))];
  const numbers = keys.filter((k) => s.some((r) => r[k] !== undefined) && s.every((r) => r[k] === undefined || numeric(r[k])));
  if (!numbers.length) return p;
  const label = keys.find((k) => !numbers.includes(k) && s.every((r) => typeof r[k] === "string"));
  const series = numbers.map((k) => ({ name: k, values: s.map((r) => (r[k] === undefined ? null : Number(r[k]))) }));
  const labels = Array.isArray(p.labels) && p.labels.length ? p.labels : label ? s.map((r) => r[label]) : p.labels;
  return { ...p, series, ...(labels !== undefined ? { labels } : {}) };
}

const graphNode = props({
  id: str({ aliases: ["key", "slug"] }),
  label: str({ aliases: ["name", "title", "text"] }),
  group: str({ aliases: ["type", "entityType", "category", "kind", "role"] }),
  note: { type: ["string", "array"], aliases: ["observations", "description", "details", "notes"] },
});
const graphEdge = props(
  {
    from: str({ aliases: ["source", "src", "start", "parent", "fromId"] }),
    to: str({ aliases: ["target", "dst", "end", "child", "toId"] }),
    label: str({ aliases: ["relation", "relationType", "type", "kind", "name"] }),
  },
  ["from", "to"],
);

const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/**
 * Edges written as text ("Alice -> Acme: works at", "A → B") become
 * {from, to, label}: a small model lists relations as sentences before it
 * remembers the edge shape.
 */
function edgeObjects(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((e) => {
    if (typeof e !== "string") return e;
    const m = /^\s*(.+?)\s*(?:-+>|→|=>|—>)\s*(.+?)\s*(?::\s*(.+))?$/.exec(e);
    return m ? { from: m[1], to: m[2], ...(m[3] ? { label: m[3].trim() } : {}) } : e;
  });
}

/**
 * Canonical nodes [{id, label, group?, note?}] and edges [{from, to, label?}]
 * whose ends are node ids. Models name an edge's ends by a node's id or by its
 * label (the memory server's relations use entity names), so both resolve.
 * Items reached through a binding skip prop coercion, so they are coerced here
 * against the same item schemas (the memory server's own keys bind directly). An
 * end that names no node becomes one: models often list only the relations,
 * and a dropped edge would lose content the user asked for. A node without an
 * id is known by its label.
 */
function finalizeGraph(p: Record<string, unknown>): Record<string, unknown> {
  const rawNodes = Array.isArray(p.nodes) ? p.nodes : [];
  const nodes: Record<string, unknown>[] = [];
  const byKey = new Map<string, string>();
  const add = (n: Record<string, unknown>) => {
    const label = text(n.label) || text(n.id);
    const id = text(n.id) || label;
    if (!id || byKey.has(id)) return;
    // Observations arrive as a list (memory server); the note is one line.
    const note = Array.isArray(n.note) ? n.note.map(text).filter(Boolean).join("; ") : text(n.note);
    nodes.push({ id, label: label || id, ...(text(n.group) ? { group: text(n.group) } : {}), ...(note ? { note } : {}) });
    byKey.set(id, id);
    if (label && !byKey.has(label.toLowerCase())) byKey.set(label.toLowerCase(), id);
  };
  for (const n of rawNodes) add(typeof n === "string" || typeof n === "number" ? { label: String(n) } : n && typeof n === "object" ? (coerce(graphNode, n) as Record<string, unknown>) : {});
  const end = (v: unknown) => {
    const t = text(v);
    if (!t) return undefined;
    const known = byKey.get(t) ?? byKey.get(t.toLowerCase());
    if (known) return known;
    add({ label: t });
    return t;
  };
  const edges: Record<string, unknown>[] = [];
  for (const e of (edgeObjects(Array.isArray(p.edges) ? p.edges : []) as unknown[])) {
    if (!e || typeof e !== "object") continue;
    const r = coerce(graphEdge, e) as Record<string, unknown>;
    const from = end(r.from), to = end(r.to);
    if (from && to) edges.push({ from, to, ...(text(r.label) ? { label: text(r.label) } : {}) });
  }
  return { ...p, nodes, edges };
}

// --- everyday components: item shapes and canonical forms -------------------

const calendarEvent = props(
  {
    title: str({ aliases: ["name", "event", "label", "summary", "meal", "class", "what"] }),
    date: str({ description: "YYYY-MM-DD", aliases: ["day", "on", "when"] }),
    start: str({ description: "HH:MM", aliases: ["time", "from", "startTime", "begin"] }),
    end: str({ description: "HH:MM", aliases: ["to", "until", "endTime", "finish"] }),
    note: str({ aliases: ["description", "details", "location", "where", "body"] }),
    tone,
  },
  ["title"],
);
const boardCard = props(
  {
    id: str({ aliases: ["key"] }),
    title: str({ aliases: ["name", "label", "text", "task", "role", "company"] }),
    column: str({ aliases: ["status", "stage", "lane", "list", "state", "columnId"] }),
    note: str({ aliases: ["description", "details", "body", "subtitle"] }),
    tag: str({ aliases: ["label", "category", "priority", "assignee", "owner"] }),
  },
  // Not required: a {column} fragment must stay a record to rejoin its card.
);
const compareOption = props(
  {
    name: str({ aliases: ["title", "label", "option", "product"] }),
    price: { type: ["string", "number"], aliases: ["cost"] },
    pros: { type: "array", items: { type: "string" }, aliases: ["advantages", "good", "strengths", "upsides", "plus"] },
    cons: { type: "array", items: { type: "string" }, aliases: ["disadvantages", "bad", "weaknesses", "downsides", "minus"] },
    specs: { type: "object", aliases: ["features", "attributes", "details", "properties"] },
    note: md({ aliases: ["description", "summary", "verdict", "body"] }),
    best: bool({ aliases: ["recommended", "winner", "pick"] }),
  },
  ["name"],
);
const ganttTask = props(
  {
    title: str({ aliases: ["name", "task", "label", "phase"] }),
    start: str({ description: "YYYY-MM-DD", aliases: ["from", "begin", "startDate"] }),
    end: str({ description: "YYYY-MM-DD", aliases: ["to", "finish", "endDate", "due"] }),
    progress: { type: ["number", "string"], aliases: ["done", "percent", "complete"] },
    group: str({ aliases: ["team", "stream", "category", "owner", "lane"] }),
  },
  ["title", "start"],
);

type Rec = Record<string, unknown>;
const records = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? { title: x } : x && typeof x === "object" ? (x as Record<string, unknown>) : undefined)).filter((x): x is Record<string, unknown> => x !== undefined);
const coerceAll = (schema: JSONSchema, v: unknown) => records(v).map((r) => coerce(schema, r) as Record<string, unknown>);
const iso = (v: unknown): string | undefined => {
  const t = text(v);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  const d = t ? new Date(t) : undefined;
  return d && !Number.isNaN(d.getTime()) && /\d{4}/.test(t) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : undefined;
};
/** "9am", "9:30 PM", "14:05" → "HH:MM". */
const clock = (v: unknown): string | undefined => {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(text(v));
  if (!m) return undefined;
  let h = Number(m[1]);
  if (m[3]?.toLowerCase() === "p" && h < 12) h += 12;
  if (m[3]?.toLowerCase() === "a" && h === 12) h = 0;
  return h < 24 ? `${String(h).padStart(2, "0")}:${m[2] ?? "00"}` : undefined;
};
const number = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(text(v).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) && text(v) !== "" ? n : undefined;
};

/**
 * Events with ISO dates and HH:MM times, sorted. A time written into the date
 * ("2026-11-02 18:00") or as "6pm" is split out; an event whose date cannot
 * be read keeps its text so nothing the model sent is lost.
 */
function finalizeCalendar(p: Record<string, unknown>): Record<string, unknown> {
  const events = coerceAll(calendarEvent, p.events).map((e) => {
    const raw = text(e.date);
    const timeInDate = /[T\s](\d{1,2}:\d{2}\s*(?:[ap]m)?)$/i.exec(raw)?.[1];
    const date = iso(raw);
    const start = clock(e.start) ?? clock(timeInDate);
    const end = clock(e.end);
    const keep: Record<string, unknown> = ({ title: text(e.title) || "Event", ...(date ? { date } : raw ? { when: raw } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}), ...(text(e.note) ? { note: text(e.note) } : {}), ...(e.tone ? { tone: e.tone } : {}) });
    return keep;
  });
  events.sort((a, b) => `${text(a.date) || "9"}${text(a.start)}`.localeCompare(`${text(b.date) || "9"}${text(b.start)}`));
  const date = iso(p.date) ?? text(events.find((e) => e.date)?.date);
  return { ...p, events, ...(date ? { date } : {}) };
}

/**
 * Columns as [{id, title}] and every card in a column. A card naming a column
 * the model never listed adds it (dropping the card loses content); a card
 * with no column joins the first. Columns default to the cards' own stages.
 */
function finalizeBoard(p: Record<string, unknown>): Record<string, unknown> {
  const cols: { id: string; title: string }[] = [];
  const byKey = new Map<string, string>();
  const addCol = (id: string, title = id) => {
    if (!id || byKey.has(id.toLowerCase())) return byKey.get(id.toLowerCase());
    cols.push({ id, title });
    byKey.set(id.toLowerCase(), id);
    byKey.set(title.toLowerCase(), id);
    return id;
  };
  for (const c of Array.isArray(p.columns) ? p.columns : []) {
    if (typeof c === "string") addCol(c);
    else if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      addCol(text(o.id) || text(o.title), text(o.title) || text(o.id));
    }
  }
  // A card split in two ({title}, {column}) is one card: a record holding only
  // a stage joins the card before it that has none.
  const parts = coerceAll(boardCard, p.cards);
  const merged: Rec[] = [];
  for (const c of parts) {
    const prev = merged.at(-1);
    if (prev && !text(c.title) && text(c.column) && !text(prev.column)) merged[merged.length - 1] = { ...prev, column: c.column };
    else merged.push(c);
  }
  const cards = merged.map((c, i) => {
    const col = text(c.column);
    const column = (col && (byKey.get(col.toLowerCase()) ?? addCol(col))) || cols[0]?.id || addCol("To do")!;
    return { ...c, id: text(c.id) || `c${i + 1}`, title: text(c.title) || `Card ${i + 1}`, column };
  });
  if (!cols.length) addCol("To do");
  return { ...p, columns: cols, cards };
}

/** Numbers for value and max ("$420", "60%"); a rating defaults to 5 stars, others to 100. */
function finalizeProgress(p: Record<string, unknown>): Record<string, unknown> {
  const pct = typeof p.value === "string" && p.value.trim().endsWith("%");
  const value = number(p.value) ?? 0;
  const max = number(p.max) ?? (p.kind === "rating" ? 5 : pct || value <= 100 ? 100 : value);
  const unit = text(p.unit) || (typeof p.value === "string" ? /^[^\d.+-]+/.exec(p.value.trim())?.[0]?.trim() : undefined);
  return { ...p, value, max: max > 0 ? max : 100, ...(unit ? { unit } : {}) };
}

/** Each option's lists as strings and specs as text; the best is marked on the option itself. */
function finalizeCompare(p: Record<string, unknown>): Record<string, unknown> {
  const best = text(p.best).toLowerCase();
  const list = (v: unknown) => (Array.isArray(v) ? v : [v]).flatMap((x) => text(x).split(/\s*[;\n]\s*/)).filter(Boolean);
  const options = coerceAll(compareOption, p.options).map((o): Rec => {
    const name = text(o.name) || text(o.title);
    const specs = o.specs && typeof o.specs === "object" && !Array.isArray(o.specs) ? Object.fromEntries(Object.entries(o.specs as object).map(([k, v]) => [k, text(v) || (typeof v === "boolean" ? (v ? "Yes" : "No") : "")])) : undefined;
    return { ...o, name, pros: list(o.pros), cons: list(o.cons), ...(specs ? { specs } : {}), ...(o.price !== undefined ? { price: text(o.price) } : {}), best: o.best === true || (best !== "" && name.toLowerCase() === best) };
  });
  // No pick marked, but one option's own text calls it the pick ("note": "Best pick").
  if (!options.some((o) => o.best)) {
    const said = options.filter((o) => /\b(best (pick|choice|option|buy)|recommended|our pick|top pick|winner)\b/i.test(`${text(o.note)} ${o.name}`));
    if (said.length === 1) said[0]!.best = true;
  }
  return { ...p, options };
}

/** Seconds from 90, "90", "10m", "1h 30m", "1:30", "01:00:00". */
export function seconds(v: unknown): number | undefined {
  if (typeof v === "number") return v > 0 ? v : undefined;
  const t = text(v).toLowerCase();
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) return t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
  let total = 0, found = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g)) {
    found = true;
    total += Number(m[1]) * (m[2]!.startsWith("h") ? 3600 : m[2]!.startsWith("m") ? 60 : 1);
  }
  return found && total > 0 ? total : undefined;
}

function finalizeTimer(p: Record<string, unknown>): Record<string, unknown> {
  const duration = seconds(p.duration);
  const until = text(p.until) && !Number.isNaN(new Date(text(p.until)).getTime()) ? text(p.until) : undefined;
  const { duration: _d, until: _u, ...rest } = p;
  return { ...rest, ...(duration ? { duration } : {}), ...(until ? { until } : {}) };
}

/**
 * Nested [{label, children}] from nested records ({name, items}, {title,
 * children}), path strings ("src/app/main.ts") or "  indented" outline lines.
 */
function finalizeTree(p: Record<string, unknown>): Record<string, unknown> {
  type T = { label: string; note?: string; children: T[] };
  const kidsKeys = ["children", "items", "nodes", "sub", "files", "entries", "sections"];
  const fromRecord = (o: Record<string, unknown>): T => {
    const label = text(o.label) || text(o.name) || text(o.title) || text(o.text) || text(o.path) || "Item";
    const kids = kidsKeys.map((k) => o[k]).find(Array.isArray) as unknown[] | undefined;
    return { label, ...(text(o.note ?? o.description) ? { note: text(o.note ?? o.description) } : {}), children: kids ? build(kids) : [] };
  };
  const build = (list: unknown[]): T[] => {
    const out: T[] = [];
    const at = (path: string[], into: T[]) => {
      let level = into;
      for (const part of path) {
        let node = level.find((n) => n.label === part && n.children);
        if (!node) level.push((node = { label: part, children: [] }));
        level = node.children;
      }
    };
    const strings = list.filter((x): x is string => typeof x === "string");
    const indented = strings.some((x) => /^\s+\S/.test(x));
    const stack: { depth: number; kids: T[] }[] = [{ depth: -1, kids: out }];
    for (const x of list) {
      if (typeof x === "string" && indented) {
        const depth = /^\s*/.exec(x)![0].length;
        while (stack.length > 1 && stack.at(-1)!.depth >= depth) stack.pop();
        const node: T = { label: x.trim().replace(/^[-*•]\s*/, ""), children: [] };
        stack.at(-1)!.kids.push(node);
        stack.push({ depth, kids: node.children });
      } else if (typeof x === "string") at(x.split(/\s*[/\\>›]\s*/).filter(Boolean), out);
      else if (x && typeof x === "object") out.push(fromRecord(x as Record<string, unknown>));
    }
    return out;
  };
  const items = Array.isArray(p.items) ? p.items : p.items && typeof p.items === "object" ? Object.entries(p.items as object).map(([k, v]) => (Array.isArray(v) ? { label: k, children: v } : v && typeof v === "object" ? { label: k, ...(v as object) } : { label: k, note: text(v) })) : [];
  return { ...p, items: build(items) };
}

/** Tasks with ISO start and end (end defaults to start: a milestone), progress 0-100, in start order. */
function finalizeGantt(p: Record<string, unknown>): Record<string, unknown> {
  const tasks = coerceAll(ganttTask, p.tasks).map((t) => {
    const start = iso(t.start);
    const end = iso(t.end) ?? start;
    const pr = number(t.progress);
    return { ...t, title: text(t.title) || "Task", ...(start ? { start } : {}), ...(end ? { end: end < (start ?? end) ? start : end } : {}), ...(pr !== undefined ? { progress: Math.max(0, Math.min(100, pr <= 1 && String(t.progress).includes(".") ? pr * 100 : pr)) } : {}) };
  });
  tasks.sort((a, b) => text(a.start).localeCompare(text(b.start)));
  return { ...p, tasks };
}

/**
 * An item of a list whose template the model never sent: a card titled by its
 * name-like field, the other text fields as labelled lines, and its lists as
 * bullet lists, so every field the model sent is shown.
 */
function itemTemplate(fields: ItemField[]): Record<string, unknown> {
  if (fields.length === 1 && fields[0]!.name === ".") return { type: "text", props: { content: "{.}" } };
  const texts = fields.filter((f) => f.kind === "text");
  const title = texts.find((f) => /^(name|title|label|heading)$/i.test(f.name)) ?? texts[0];
  const lines = texts.filter((f) => f !== title).map((f) => `**${f.label}:** {${f.name}}`);
  // An item without the list shows neither the list nor its label.
  const lists = fields.filter((f) => f.kind === "list").flatMap((f) => [
    { type: "text", props: { content: f.label, variant: "caption", visibleIf: `{${f.name}}` } },
    { type: "list", props: { items: `{${f.name}}`, visibleIf: `{${f.name}}` } },
  ]);
  return {
    type: "card",
    props: { ...(title ? { title: `{${title.name}}` } : {}), ...(lines.length ? { body: lines.join("\n\n") } : {}) },
    ...(lists.length ? { children: lists } : {}),
  };
}

export const basicCatalog = defineCatalog(
  "vak.basic",
  {
    // --- layout -----------------------------------------------------------
    stack: {
      description: "Lays children out in a line.",
      props: props({
        direction: oneOf(["vertical", "horizontal"], {
          aliases: ["orientation", "flexDirection", "layout"],
          enumAliases: { row: "horizontal", column: "vertical", col: "vertical", h: "horizontal", v: "vertical", x: "horizontal", y: "vertical" },
        }),
        gap,
        align: oneOf(["start", "center", "end", "stretch"], { aliases: ["alignItems"], enumAliases: { left: "start", top: "start", right: "end", bottom: "end", middle: "center", "flex-start": "start", "flex-end": "end" } }),
        wrap: bool(),
      }),
      children: true,
      aliases: [
        "div", "container", "box", "view", "column", "col", "vstack", "page", "layout", "wrapper", "body", "main", "flex",
        { name: "row", props: { direction: "horizontal" } },
        { name: "hstack", props: { direction: "horizontal" } },
        { name: "toolbar", props: { direction: "horizontal", wrap: true } },
        { name: "buttongroup", props: { direction: "horizontal", wrap: true } },
      ],
    },
    grid: {
      description: "Adaptive grid: as many columns as fit, collapsing to one on narrow screens.",
      props: props({
        columns: { type: ["integer", "string"], description: "max columns 1-6, or \"auto\"", aliases: ["cols", "columnCount"] },
        minItemWidth: oneOf(["sm", "md", "lg"], { aliases: ["minWidth", "itemWidth", "size"], enumAliases: { small: "sm", medium: "md", large: "lg" } }),
        gap,
        searchable: bool({ aliases: ["filterable", "filter", "search"] }),
      }),
      children: true,
      hint: "children may set span for bento layouts",
      aliases: ["columns", "cards", "cardgrid", "dashboard", "bento", "masonry"],
    },
    split: {
      tier: "extended",
      description: "Two panes side by side (primary first), stacking on narrow screens.",
      props: props({
        ratio: oneOf(["1:1", "2:1", "1:2", "3:1", "1:3"], { enumAliases: { "50/50": "1:1", "2/1": "2:1", "1/2": "1:2", "3/1": "3:1", "1/3": "1:3" } }),
        gap,
      }),
      children: true,
      aliases: ["sidebar", "twocolumn", "twocol", "splitview", "panes"],
    },
    section: {
      description: "Titled group of content.",
      props: props({ title: str({ aliases: ["heading", "header", "name", "label"] }), description: md({ aliases: ["subtitle", "text", "summary"] }) }),
      children: true,
      aliases: ["panel", "group", "fieldset", "header", "footer", "region", "tab", "tabpanel"],
    },
    tabs: {
      description: "Tabbed panels; each child is a panel and its props.title is the tab label.",
      props: props({}),
      children: true,
      aliases: ["tabgroup", "tabview", "tabset"],
    },
    // --- content ----------------------------------------------------------
    card: {
      description: "Card with optional media, title, body and child content (e.g. buttons).",
      props: props({
        title: str({ aliases: ["heading", "header", "name"] }),
        subtitle: str({ aliases: ["subheading", "subheader", "caption"] }),
        body: md({ aliases: ["text", "content", "description", "summary"] }),
        image: str({ description: "url", aliases: ["imageUrl", "img", "src", "thumbnail", "photo"] }),
        badge: str({ aliases: ["tag", "chip", "label"] }),
        tone,
      }),
      children: true,
      aliases: ["tile", "item", "product", "listing"],
    },
    text: {
      description: "Markdown text.",
      props: props(
        {
          content: md({ aliases: ["text", "markdown", "body", "value"] }),
          variant: oneOf(["body", "heading", "subheading", "caption", "code"], {
            aliases: ["style", "size", "kind"],
            enumAliases: { h1: "heading", h2: "heading", title: "heading", h3: "subheading", subtitle: "subheading", small: "caption", muted: "caption", paragraph: "body", p: "body", mono: "code" },
          }),
        },
        ["content"],
      ),
      aliases: [
        "paragraph", "p", "span", "markdown", "description", "copy",
        { name: "heading", props: { variant: "heading" } },
        { name: "h1", props: { variant: "heading" } },
        { name: "h2", props: { variant: "heading" } },
        { name: "title", props: { variant: "heading" } },
        { name: "h3", props: { variant: "subheading" } },
        { name: "subheading", props: { variant: "subheading" } },
        { name: "subtitle", props: { variant: "subheading" } },
        { name: "caption", props: { variant: "caption" } },
        { name: "label", props: { variant: "caption" } },
      ],
    },
    stat: {
      description: "Single KPI.",
      props: props(
        {
          label: str({ aliases: ["name", "title", "metric", "caption"] }),
          value: { type: ["string", "number"], aliases: ["amount", "number", "count", "total", "figure"] },
          delta: str({ description: "e.g. +12%", aliases: ["change", "diff", "trendValue", "growth"] }),
          trend: oneOf(["up", "down", "flat"], { aliases: ["direction"], enumAliases: { increase: "up", positive: "up", decrease: "down", negative: "down", neutral: "flat", none: "flat" } }),
          tone,
        },
        ["label", "value"],
      ),
      aliases: ["kpi", "metric", "statistic", "number", "scorecard"],
    },
    table: {
      description: "Data table.",
      props: props(
        {
          columns: {
            type: "array",
            description: "column keys or header labels, or {key, label, align}",
            aliases: ["headers", "fields", "cols"],
            items: {
              anyOf: [
                { type: "string" },
                props(
                  {
                    key: str({ aliases: ["field", "name", "id", "accessor", "dataKey"] }),
                    label: str({ aliases: ["title", "header", "name", "text"] }),
                    align: oneOf(["start", "end", "center"], { enumAliases: { left: "start", right: "end", middle: "center" } }),
                  },
                  ["key"],
                ),
              ],
            },
          },
          // Complete report a867394a hid row facts inside props/children.
          // Model authoring uses scalar cells; ingestion retains original raw
          // material rather than coercing malformed records into lossy cells.
          rows: { ...listOr({ type: "array" }, { description: "array of row objects, or \"{/path}\"", aliases: ["data", "items", "records"] }), wire: listOr({ type: "array", items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } } }, { description: "positional row arrays: each cell corresponds to the column at the same index; no object keys, wrappers or nested UI nodes; use null for a missing value" }) },
          // Projectors sort, filter and page on their own (see interact.ts);
          // these only switch a default off or on.
          sortable: bool({ aliases: ["sort", "sorting"] }),
          searchable: bool({ aliases: ["filterable", "filter", "search"] }),
          pageSize: { type: "integer", minimum: 0, aliases: ["perPage", "pagination", "rowsPerPage", "page_size"] },
          totals: bool({ description: "replaces the last total row with computed sums for numeric columns; use false for a caller-specified summary row with custom labels or non-summed cells", aliases: ["total", "showTotals", "summary", "sum"] }),
        },
        ["columns", "rows"],
      ),
      hint: "Author rows as positional scalar cell arrays in column order, or bind rows to data of that shape. Do not leave rows empty when displaying supplied records. props.totals: true computes numeric column sums and replaces a supplied last total row; use it only for a requested total. For a requested custom summary row, keep that row and set totals: false",
      finalize: finalizeTable,
      aliases: ["datatable", "grid_table", "spreadsheet", "datagrid"],
    },
    list: {
      description: "Simple list of text items.",
      // The 4B model listed a recipe's ingredients as one card each (bench
      // recipe, gates of 2026-10-25): an enumeration of short items is a list.
      hint: "for ingredients, items and steps; ordered: true for steps",
      props: props({
        items: listOr({ type: "array", items: { type: "string" } }, { aliases: ["list", "entries", "bullets", "values", "points"] }),
        ordered: bool({ aliases: ["numbered"] }),
        searchable: bool({ aliases: ["filterable", "filter", "search"] }),
      }),
      aliases: ["ul", "bullets", "checklist", "bulletlist", { name: "ol", props: { ordered: true } }, { name: "numberedlist", props: { ordered: true } }],
    },
    chart: {
      description: "Chart.",
      hint: "kind: bar, stacked (parts of each total), line, area, pie, scatter (x/y points), heatmap (dated values or a grid), radar (scores on axes)",
      props: props(
        {
          kind: oneOf(["bar", "stacked", "line", "area", "pie", "scatter", "heatmap", "radar"], {
            default: "bar",
            aliases: ["chartType", "variant"],
            enumAliases: { column: "bar", columns: "bar", barchart: "bar", histogram: "bar", linechart: "line", trend: "line", areachart: "area", piechart: "pie", donut: "pie", doughnut: "pie", stackedbar: "stacked", stackedbars: "stacked", stackedcolumn: "stacked", stack: "stacked", scatterplot: "scatter", bubble: "scatter", points: "scatter", xy: "scatter", heat: "heatmap", habit: "heatmap", habits: "heatmap", calendarheatmap: "heatmap", matrix: "heatmap", spider: "radar", web: "radar", polar: "radar" },
          }),
          labels: listOr({ type: "array", items: { type: "string" } }, { aliases: ["categories", "xAxis", "x", "keys"] }),
          series: {
            description: "[{name, values}], or shorthand: a list of numbers (one series) or of number lists",
            aliases: ["datasets", "data", "values"],
            anyOf: [
              {
                type: "array",
                items: props(
                  { name: str({ aliases: ["label", "title"] }), values: { type: "array", items: { type: "number" }, aliases: ["data", "points", "y"] }, x: { type: "array", items: { type: "number" }, description: "scatter: x of each value", aliases: ["xs", "xValues"] } },
                  ["values"],
                ),
              },
              { type: "array", items: { type: "number" } },
              { type: "array", items: { type: "array", items: { type: "number" } } },
              binding,
            ],
          },
        },
        ["kind", "series"],
      ),
      normalize: normalizeChart,
      finalize: finalizeChart,
      aliases: [
        "plot",
        { name: "barchart", props: { kind: "bar" } },
        { name: "linechart", props: { kind: "line" } },
        { name: "areachart", props: { kind: "area" } },
        { name: "piechart", props: { kind: "pie" } },
        { name: "donutchart", props: { kind: "pie" } },
        { name: "stackedbarchart", props: { kind: "stacked" } },
        { name: "scatterplot", props: { kind: "scatter" } },
        { name: "scatterchart", props: { kind: "scatter" } },
        { name: "heatmap", props: { kind: "heatmap" } },
        { name: "habittracker", props: { kind: "heatmap" } },
        { name: "radarchart", props: { kind: "radar" } },
        { name: "spiderchart", props: { kind: "radar" } },
      ],
    },
    alert: {
      description: "Callout message.",
      props: props({ title: str({ aliases: ["heading", "header"] }), body: md({ aliases: ["text", "content", "message", "description"] }), tone }),
      aliases: ["callout", "notice", "banner", "message", "note", "notification", "toast"],
    },
    image: {
      tier: "extended",
      description: "Image.",
      props: props({ src: str({ description: "url", aliases: ["url", "href", "source", "image"] }), alt: str({ aliases: ["caption", "title", "description"] }) }, ["src"]),
      aliases: ["img", "picture", "photo", "figure"],
    },
    media: {
      description: "An image, audio recording or video with its description and optional transcript. Audio/video have local playback controls.",
      hint: "Use a supplied asset URI; never invent a generated file or autoplay it. Describe the asset; a transcript is optional. Playback does not call the model.",
      props: props({ kind: oneOf(["image", "audio", "video"]), src: str({ description: "Supplied public URL or app-resolved asset URI", aliases: ["url", "source"] }), title: str(), description: str(), transcript: str(), alt: str() }, ["kind", "src"]),
      aliases: [{ name: "audio", props: { kind: "audio" } }, { name: "video", props: { kind: "video" } }],
    },
    divider: { description: "Separator line.", props: props({}), tier: "extended", aliases: ["hr", "separator", "rule"] },
    // Richer components (web draws them; other targets get them lowered to
    // lists, text and images by lower.ts). Extended tier: small models keep
    // the shorter vocabulary they are measured on.
    timeline: {
      tier: "extended",
      description: "Events in time order.",
      hint: "for histories, itineraries by time and changelogs; process states belong in steps",
      // 4B component runs repeatedly emitted timeline items with done/current/
      // todo states. Those states are meaningful steps, not dates to discard.
      retype: [{ type: "steps", when: props({ items: { type: "array", minItems: 1, items: props({ status: str() }, ["status"]) } }, ["items"]) }],
      props: props(
        {
          items: listOr(
            { type: "array", items: props({ date: str({ aliases: ["time", "when", "year", "at", "day"] }), title: str({ aliases: ["event", "label", "name", "heading"] }), description: md({ aliases: ["body", "details", "text", "content"] }) }, ["title"]) },
            { aliases: ["events", "entries", "milestones", "history"] },
          ),
        },
        ["items"],
      ),
      normalize: (p) => ({ ...p, items: itemObjects(p.items) }),
      aliases: ["history", "chronology", "events"],
    },
    steps: {
      tier: "extended",
      description: "Steps of a process with their state.",
      hint: "use steps for process state, timeline for dates; props.items is an array of {title, status}; keep every supplied step and its state in order",
      props: props(
        {
          items: listOr(
            { type: "array", items: props({ title: str({ aliases: ["label", "name", "step", "heading"] }), description: md({ aliases: ["body", "details", "text"] }), status: oneOf(["done", "current", "todo", "skipped", "failed"], { enumAliases: { complete: "done", completed: "done", finished: "done", active: "current", "in-progress": "current", in_progress: "current", pending: "todo", upcoming: "todo", next: "todo", error: "failed" } }) }, ["title"]) },
            { aliases: ["stages", "steps", "phases", "entries"] },
          ),
        },
        ["items"],
      ),
      normalize: (p) => ({ ...p, items: itemObjects(p.items) }),
      aliases: ["stepper", "wizard", "process", "checklist_steps"],
    },
    code: {
      tier: "extended",
      description: "A block of code or terminal commands, with copy.",
      hint: "copy supplied source verbatim, including punctuation; backticks, dollar signs and braces need no JSON escaping; do not add ANSI or markdown fences",
      // The 4B component bench emitted JS `${name}` and retried on an
      // unbound-placeholder error. Code braces are source, not UI bindings.
      props: props({ code: str({ literal: true, description: "literal source code; braces are preserved", aliases: ["content", "text", "source", "value", "snippet"] }), language: str({ aliases: ["lang", "syntax"] }), title: str({ aliases: ["filename", "file", "label", "caption"] }) }, ["code"]),
      aliases: ["codeblock", "snippet", "pre", "terminal", "shell"],
    },
    map: {
      tier: "extended",
      description: "Places with addresses; each opens in a map.",
      hint: "props.places is an array of {name, address}; include every supplied place in order; lat/lon only when known",
      props: props(
        {
          places: listOr(
            { type: "array", items: props({ name: str({ aliases: ["title", "label"] }), address: str({ aliases: ["location", "addr"] }), lat: { type: "number", aliases: ["latitude"] }, lon: { type: "number", aliases: ["lng", "long", "longitude"] }, note: str({ aliases: ["description", "details"] }) }) },
            { aliases: ["locations", "markers", "pins", "items", "points"] },
          ),
        },
        ["places"],
      ),
      // "British Museum, Great Russell Street, London" (4B, bench london-places):
      // a place written as text is its name, then its address.
      normalize: (p) => ({
        ...p,
        places: Array.isArray(p.places)
          ? p.places.map((pl) => {
              const m = typeof pl === "string" ? /^\s*([^,]+?)\s*,\s*(.+?)\s*$/.exec(pl) : null;
              return m ? { name: m[1], address: m[2] } : (itemObjects([pl], "name") as unknown[])[0];
            })
          : p.places,
      }),
      aliases: ["places", "locations", "mapview"],
    },
    graph: {
      tier: "extended",
      description: "Things and how they connect: nodes joined by labelled edges.",
      hint: "for relationships, knowledge graphs, org charts, dependencies and flows; props.nodes is [{id, label, group}], props.edges is [{from, to, label}] naming node ids; numbers over categories belong in chart",
      // "graph" was a chart alias, and models still say it for one: a node
      // with series is a chart.
      retype: [{ type: "chart", when: props({}, ["series"]) }],
      props: props(
        {
          nodes: listOr(
            {
              type: "array",
              items: {
                anyOf: [
                  { type: "string" },
                  graphNode,
                ],
              },
            },
            { aliases: ["entities", "vertices", "items", "people", "members"] },
          ),
          edges: listOr(
            {
              type: "array",
              items: {
                anyOf: [
                  { type: "string" },
                  graphEdge,
                ],
              },
            },
            { aliases: ["links", "relations", "relationships", "connections"] },
          ),
          directed: bool({ description: "default true", aliases: ["arrows", "isDirected"] }),
        },
        ["nodes"],
      ),
      normalize: (p) => (p.edges === undefined ? p : { ...p, edges: edgeObjects(p.edges) }),
      finalize: finalizeGraph,
      aliases: ["network", "networkgraph", "knowledgegraph", "nodegraph", "mindmap", "orgchart", "flowchart", "diagram", "relations"],
    },
    gallery: {
      tier: "extended",
      description: "A grid of images with captions.",
      hint: "put every image in props.images; copy supplied captions verbatim into alt, without embellishment",
      props: props(
        { images: listOr({ type: "array", items: props({ src: str({ aliases: ["url", "image", "href"] }), alt: str({ aliases: ["caption", "title", "description"] }) }, ["src"]) }, { aliases: ["photos", "pictures", "items"] }) },
        ["images"],
      ),
      normalize: (p) => ({ ...p, images: itemObjects(p.images, "src") }),
      aliases: ["carousel", "photos", "album", "images"],
    },
    calendar: {
      tier: "extended",
      description: "Events on a day, week or month calendar, or as an agenda.",
      hint: "for meal plans, classes, trips and shifts; props.events is [{title, date: YYYY-MM-DD, start?: HH:MM, end?: HH:MM, note?}]; view: month, week, day or agenda",
      // "calendar" was a date-picker alias: one with a bind is that input.
      retype: [{ type: "date", when: props({ bind: str() }, ["bind"]) }],
      props: props(
        {
          events: listOr({ type: "array", items: calendarEvent }, { aliases: ["items", "entries", "schedule", "meals", "classes", "shifts", "appointments"] }),
          view: oneOf(["month", "week", "day", "agenda"], { aliases: ["mode", "range", "kind"], enumAliases: { monthly: "month", weekly: "week", daily: "day", list: "agenda", schedule: "agenda" } }),
          date: str({ description: "YYYY-MM-DD shown first", aliases: ["start", "focus", "initialDate", "today"] }),
        },
        ["events"],
      ),
      normalize: (p) => ({ ...p, events: itemObjects(p.events) }),
      finalize: finalizeCalendar,
      aliases: ["agenda", "schedule", "planner", "eventcalendar", "mealplan", "weekplanner", { name: "weekview", props: { view: "week" } }, { name: "monthview", props: { view: "month" } }],
    },
    board: {
      tier: "extended",
      description: "Columns of cards the user drags between stages.",
      hint: "for to-dos, job hunts, pipelines and projects; props.columns is the stage names; props.cards is [{title, column, note?, tag?}]; bind: /path keeps moves in data",
      props: props(
        {
          columns: listOr({ type: "array", items: { anyOf: [{ type: "string" }, props({ id: str({ aliases: ["key", "value"] }), title: str({ aliases: ["name", "label", "stage", "status"] }) })] } }, { aliases: ["stages", "lanes", "lists", "statuses"] }),
          cards: listOr({ type: "array", items: { anyOf: [{ type: "string" }, boardCard] } }, { aliases: ["items", "tasks", "tickets", "entries", "jobs"] }),
          bind: str({ description: "/path the cards are kept at; moves write here", aliases: ["path", "model"] }),
        },
        ["cards"],
      ),
      finalize: finalizeBoard,
      aliases: ["kanban", "kanbanboard", "taskboard", "pipeline", "swimlanes", "trello"],
    },
    progress: {
      tier: "extended",
      description: "How far toward a goal: a bar, a gauge, a ring or a star rating.",
      hint: "for budgets, spending limits, habits, goals and scores; props.value and props.max (default 100); kind: bar, gauge, ring or rating; tone shows state",
      // "progress" was a steps alias: one with stage items is steps. A rating
      // the user sets (with bind) is an input.
      retype: [
        { type: "steps", when: props({ items: { type: "array", minItems: 1 } }, ["items"]) },
        { type: "input", when: props({ bind: str() }, ["bind"]) },
      ],
      props: props(
        {
          value: { type: ["number", "string"], aliases: ["current", "spent", "done", "score", "progress", "percent", "amount", "rating"] },
          max: { type: ["number", "string"], description: "default 100; 5 for a rating", aliases: ["total", "goal", "target", "limit", "budget", "of", "outOf", "maximum"] },
          label: str({ aliases: ["title", "name", "caption", "text"] }),
          kind: oneOf(["bar", "gauge", "ring", "rating"], { aliases: ["variant", "style", "type"], enumAliases: { meter: "bar", linear: "bar", dial: "gauge", speedometer: "gauge", circle: "ring", donut: "ring", radial: "ring", stars: "rating", star: "rating" } }),
          unit: str({ aliases: ["suffix", "currency", "units"] }),
          tone,
          note: str({ aliases: ["description", "detail", "subtitle"] }),
        },
        ["value"],
      ),
      finalize: finalizeProgress,
      aliases: ["progressbar", "meter", "gauge", "budget", "goal", "score", { name: "rating", props: { kind: "rating" } }, { name: "stars", props: { kind: "rating" } }, { name: "ring", props: { kind: "ring" } }, { name: "progressring", props: { kind: "ring" } }],
    },
    accordion: {
      tier: "extended",
      description: "Collapsible sections; each item or child opens on its own.",
      hint: "for FAQs and long content on phones; props.items is [{title, body}], or children with props.title",
      props: props({
        items: listOr({ type: "array", items: props({ title: str({ aliases: ["question", "q", "heading", "label", "summary"] }), body: md({ aliases: ["answer", "a", "content", "text", "details"] }) }, ["title"]) }, { aliases: ["sections", "faqs", "questions", "entries", "panels"] }),
        multiple: bool({ description: "several open at once (default true)", aliases: ["allowMultiple"] }),
      }),
      children: true,
      aliases: ["faq", "faqs", "collapsible", "expander", "disclosure", "details", "accordions"],
    },
    compare: {
      tier: "extended",
      description: "Options side by side, the best one highlighted.",
      hint: "for shopping and which-should-I-pick questions; props.options is [{name, pros, cons, specs: {feature: value}, price?, note?}]; props.best names the pick; props.action (e.g. book_hotel) puts a button on each option that sends you {option: name}",
      props: props(
        {
          options: listOr({ type: "array", items: compareOption }, { aliases: ["items", "choices", "products", "candidates", "alternatives"] }),
          best: str({ description: "name of the recommended option", aliases: ["winner", "pick", "recommended", "recommendation", "choice"] }),
          action: str({ description: "action name sent with the chosen option", aliases: ["onSelect", "onChoose", "onPick", "select", "event"] }),
          actionLabel: str({ description: "each option's button text (default Choose)", aliases: ["buttonLabel", "cta", "buttonText", "selectLabel"] }),
          payload: { description: "sent back with the action, beside option", aliases: ["data", "params"] },
        },
        ["options"],
      ),
      finalize: finalizeCompare,
      role: "action",
      choices: "options",
      aliases: ["comparison", "proscons", "prosandcons", "versus", "vs", "comparisontable", "decision"],
    },
    timer: {
      tier: "extended",
      description: "A timer or stopwatch, or a countdown to a date and time.",
      hint: "for cooking, workouts and deadlines; props.duration in seconds or \"10m\"/\"1:30\"; props.until is a date-time to count down to; no duration nor until is a stopwatch",
      props: props({
        label: str({ aliases: ["title", "name", "caption", "text"] }),
        duration: { type: ["number", "string"], description: "seconds, or \"10m\", \"1:30\"", aliases: ["seconds", "time", "length", "minutes", "for"] },
        until: str({ description: "YYYY-MM-DDTHH:MM to count down to", aliases: ["deadline", "date", "target", "end", "at", "due"] }),
        autostart: bool({ aliases: ["autoStart", "start", "running"] }),
      }),
      finalize: finalizeTimer,
      aliases: ["countdown", "stopwatch", "clock", "kitchentimer", "workouttimer"],
    },
    tree: {
      tier: "extended",
      description: "A collapsible hierarchy: files, notes, outlines and tables of contents.",
      hint: "props.items is [{label, children: [...]}] nested, or path strings like \"src/app/main.ts\"",
      props: props(
        {
          items: listOr({ type: "array", items: { anyOf: [{ type: "string" }, { type: "object" }] } }, { aliases: ["nodes", "children", "files", "outline", "entries", "toc", "data"] }),
          expanded: bool({ description: "start open (default true for 2 levels)", aliases: ["open", "expandAll"] }),
        },
        ["items"],
      ),
      finalize: finalizeTree,
      aliases: ["outline", "treeview", "filetree", "hierarchy", "toc", "tableofcontents", "folders", "directory"],
    },
    math: {
      tier: "extended",
      description: "A mathematical formula written in TeX.",
      hint: "props.tex is TeX like \\frac{a}{b}, x^2, \\sqrt{x}, \\sum_{i=1}^n; display: false for inline",
      props: props(
        {
          tex: str({ literal: true, description: "TeX source; braces are preserved", aliases: ["formula", "latex", "expression", "equation", "math", "content", "text", "value"] }),
          display: bool({ description: "default true", aliases: ["block"] }),
          caption: str({ aliases: ["label", "title", "note"] }),
        },
        ["tex"],
      ),
      aliases: ["formula", "equation", "latex", "katex", "tex", "mathjax"],
    },
    diff: {
      tier: "extended",
      description: "Before and after text with the changes marked.",
      hint: "props.before and props.after are the full texts (copied verbatim), or props.diff is a unified diff; view: unified or split",
      props: props({
        before: str({ literal: true, aliases: ["old", "original", "from", "left", "a"] }),
        after: str({ literal: true, aliases: ["new", "changed", "to", "right", "b", "revised"] }),
        diff: str({ literal: true, description: "unified diff text", aliases: ["patch", "unified"] }),
        language: str({ aliases: ["lang", "syntax"] }),
        title: str({ aliases: ["filename", "file", "label", "caption"] }),
        view: oneOf(["unified", "split"], { aliases: ["mode", "layout"], enumAliases: { inline: "unified", sidebyside: "split", "side-by-side": "split" } }),
      }),
      aliases: ["textdiff", "changes", "beforeafter", "patch", "codediff"],
    },
    gantt: {
      tier: "extended",
      description: "Tasks as bars across dates: a Gantt chart or roadmap.",
      hint: "props.tasks is [{title, start: YYYY-MM-DD, end: YYYY-MM-DD, progress?: 0-100, group?}]; for dated events without spans use timeline",
      props: props(
        { tasks: listOr({ type: "array", items: ganttTask }, { aliases: ["items", "bars", "phases", "milestones", "entries", "workstreams"] }) },
        ["tasks"],
      ),
      finalize: finalizeGantt,
      aliases: ["ganttchart", "roadmap", "projectplan", "schedulechart"],
    },
    // --- interaction ------------------------------------------------------
    button: {
      description: "Button that sends an action to you.",
      props: props(
        {
          label: str({ aliases: ["text", "title", "caption"] }),
          action: str({ description: "action name", aliases: ["onClick", "onPress", "event"] }),
          payload: { description: "sent back with the action; any JSON value", aliases: ["data", "params", "value"] },
          style: oneOf(["primary", "secondary", "danger", "link"], {
            aliases: ["variant", "kind"],
            enumAliases: { main: "primary", cta: "primary", solid: "primary", outline: "secondary", default: "secondary", ghost: "link", text: "link", destructive: "danger", delete: "danger" },
          }),
        },
        ["label", "action"],
      ),
      defaults: buttonDefaults,
      role: "action",
      aliases: ["btn", "cta", { name: "link", props: { style: "link" } }, { name: "submit", props: { style: "primary" } }],
    },
    form: {
      description: "Form; its children are inputs. On submit you receive the bound values.",
      props: props({ submit: str({ description: "action name", aliases: ["action", "onSubmit"] }), submitLabel: str({ aliases: ["buttonLabel", "submitText", "cta"] }) }),
      children: true,
      role: "form",
      aliases: ["signup", "signupform", "contactform"],
    },
    input: {
      description: "Single-line text input.",
      props: props(
        {
          label: fieldLabel,
          bind: fieldBind,
          placeholder,
          // HTML input types that are their own components here ("date", "checkbox",
          // "textarea") retype the node instead of failing the enum.
          kind: oneOf(["text", "email", "number", "tel", "url", "time", "range", "rating", "file"], {
            aliases: ["inputType", "format"],
            enumAliases: { phone: "tel", telephone: "tel", integer: "number", link: "url", string: "text", slider: "range", stars: "rating", upload: "file", attachment: "file", clock: "time", bar: "range", meter: "range", gauge: "range" },
            namesComponent: true,
          }),
          min: num({ aliases: ["minimum", "from"] }),
          max: num({ description: "range top; rating stars (default 5)", aliases: ["maximum", "to", "stars", "outOf"] }),
          step: num({ aliases: ["increment"] }),
          unit: str({ aliases: ["suffix", "units"] }),
          accept: str({ description: "file types, e.g. image/*,.pdf", aliases: ["fileTypes", "types"] }),
          multiple: bool({ description: "file: several files", aliases: ["multi"] }),
          checks,
        },
        ["label", "bind"],
      ),
      defaults: fieldDefaults,
      aliases: [
        "textinput", "textfield", "field", "textbox", "entry",
        { name: "email", props: { kind: "email" } },
        { name: "emailinput", props: { kind: "email" } },
        { name: "phone", props: { kind: "tel" } },
        { name: "tel", props: { kind: "tel" } },
        { name: "url", props: { kind: "url" } },
        { name: "numberinput", props: { kind: "number" } },
        { name: "time", props: { kind: "time" } },
        { name: "timepicker", props: { kind: "time" } },
        { name: "timeinput", props: { kind: "time" } },
        { name: "slider", props: { kind: "range" } },
        { name: "range", props: { kind: "range" } },
        { name: "rangeinput", props: { kind: "range" } },
        { name: "starrating", props: { kind: "rating" } },
        { name: "ratinginput", props: { kind: "rating" } },
        { name: "file", props: { kind: "file" } },
        { name: "fileinput", props: { kind: "file" } },
        { name: "upload", props: { kind: "file" } },
        { name: "attachment", props: { kind: "file" } },
        { name: "dropzone", props: { kind: "file" } },
      ],
    },
    textarea: {
      tier: "extended",
      description: "Multi-line text input.",
      props: props({ label: fieldLabel, bind: fieldBind, placeholder, checks }, ["label", "bind"]),
      defaults: fieldDefaults,
      aliases: ["multiline", "comment", "comments", "longtext"],
    },
    select: {
      description: "Choice from options.",
      props: props(
        {
          label: fieldLabel,
          bind: fieldBind,
          options: listOr(
            { type: "array", items: { anyOf: [{ type: "string" }, props({ label: str({ aliases: ["text", "name", "title"] }), value: str({ aliases: ["id", "key"] }) }, ["label", "value"])] } },
            { aliases: ["choices", "items", "values"] },
          ),
          multiple: bool({ aliases: ["multi", "multiSelect"] }),
          checks,
        },
        ["label", "bind", "options"],
      ),
      defaults: fieldDefaults,
      aliases: ["dropdown", "radio", "radiogroup", "combobox", "picker", "choice", { name: "multiselect", props: { multiple: true } }, { name: "checkboxgroup", props: { multiple: true } }, { name: "tags", props: { multiple: true } }],
    },
    checkbox: {
      description: "Yes/no toggle.",
      // A checklist came out as cards with "Mark Complete" buttons (bench
      // onboarding-checklist): one checkbox per item, in a form, is the native shape.
      hint: "one per checklist item, inside a form",
      props: props({ label: fieldLabel, bind: fieldBind }, ["label", "bind"]),
      defaults: fieldDefaults,
      aliases: ["toggle", "switch", "consent", "agree"],
    },
    date: {
      description: "Date picker.",
      props: props({ label: fieldLabel, bind: fieldBind, range: bool({ aliases: ["isRange"] }), checks }, ["label", "bind"]),
      defaults: fieldDefaults,
      aliases: ["datepicker", "dateinput", { name: "daterange", props: { range: true } }],
    },
  },
  {
    span: { type: ["integer", "string"], description: "1-4 or \"full\"", aliases: ["colSpan", "colspan", "width"] },
    priority: oneOf(["primary", "secondary", "tertiary"], { aliases: ["importance"], enumAliases: { high: "primary", medium: "secondary", low: "tertiary" } }),
    visibleIf: str({ description: "{/path}: shown when truthy", aliases: ["showIf", "if", "when"] }),
  },
  {
    container: "stack",
    itemTemplate,
    examples: [
      {
        request: "Show this month's sales KPIs, a weekly revenue chart and the top products",
        render: {
          surface: "sales",
          title: "Sales this month",
          nodes: [
            { id: "root", type: "stack", children: ["kpis", "trend", "top"] },
            { id: "kpis", type: "grid", props: { columns: 3 }, children: ["k1", "k2", "k3"] },
            { id: "k1", type: "stat", props: { label: "Revenue", value: "{/revenue}", delta: "+8%", trend: "up" } },
            { id: "k2", type: "stat", props: { label: "Orders", value: "{/orders}", delta: "+3%", trend: "up" } },
            { id: "k3", type: "stat", props: { label: "Refund rate", value: "{/refunds}", delta: "-0.2%", trend: "down" } },
            { id: "trend", type: "chart", props: { kind: "line", labels: ["W1", "W2", "W3", "W4"], series: [{ name: "Revenue ($k)", values: [42, 51, 47, 58] }] } },
            { id: "top", type: "table", props: { columns: [{ key: "name", label: "Product" }, { key: "sales", label: "Sales", align: "end" }], rows: "{/products}" } },
          ],
          data: { revenue: "$198k", orders: "1,284", refunds: "0.9%", products: [{ name: "Desk lamp", sales: "$24k" }, { name: "Chair", sales: "$19k" }] },
        },
      },
      {
        request: "Suggest three weekend trips and let me pick one",
        render: {
          surface: "trips",
          nodes: [
            { id: "root", type: "stack", children: ["intro", "options"] },
            { id: "intro", type: "text", props: { content: "Three ideas within 3 hours:" } },
            { id: "options", type: "grid", props: { columns: 3 }, children: { each: "/trips", template: "trip" } },
            { id: "trip", type: "card", props: { title: "{name}", subtitle: "{price}", body: "{why}" }, children: ["pick"] },
            { id: "pick", type: "button", props: { label: "Choose", action: "choose_trip", payload: { name: "{name}" }, style: "primary" } },
          ],
          data: {
            trips: [
              { name: "Coastal town", price: "$180", why: "Seafood and a cliff walk" },
              { name: "Mountain cabin", price: "$240", why: "Quiet, with a hot tub" },
              { name: "City break", price: "$210", why: "Museums and night markets" },
            ],
          },
        },
      },
      {
        request: "Let me sign up for the beta",
        render: {
          surface: "beta",
          nodes: [
            { id: "root", type: "form", props: { submit: "join_beta", submitLabel: "Join the beta" }, children: ["name", "email", "role", "updates"] },
            { id: "name", type: "input", props: { label: "Name", bind: "/signup/name", checks: ["required"] } },
            { id: "email", type: "input", props: { label: "Email", bind: "/signup/email", kind: "email", checks: ["required", "email"] } },
            { id: "role", type: "select", props: { label: "Role", bind: "/signup/role", options: ["Developer", "Designer", "Other"] } },
            { id: "updates", type: "checkbox", props: { label: "Email me product updates", bind: "/signup/updates" } },
          ],
          data: { signup: {} },
        },
      },
    ],
  },
);
