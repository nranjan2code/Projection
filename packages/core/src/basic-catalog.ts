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

/** Canonicalize the series shorthands the schema accepts into [{name?, values}]. */
function normalizeChart(p: Record<string, unknown>): Record<string, unknown> {
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
          rows: listOr({ type: "array" }, { description: "array of row objects, or \"{/path}\"", aliases: ["data", "items", "records"] }),
          // Projectors sort, filter and page on their own (see interact.ts);
          // these only switch a default off or on.
          sortable: bool({ aliases: ["sort", "sorting"] }),
          searchable: bool({ aliases: ["filterable", "filter", "search"] }),
          pageSize: { type: "integer", minimum: 0, aliases: ["perPage", "pagination", "rowsPerPage", "page_size"] },
          totals: bool({ description: "adds a computed totals row; don't add one yourself", aliases: ["total", "showTotals", "summary", "sum"] }),
        },
        ["columns", "rows"],
      ),
      hint: "rows is an array of objects keyed by columns; retain currency and percent symbols in string cells; when totals are requested set props.totals: true (the engine computes the total)",
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
      props: props(
        {
          kind: oneOf(["bar", "line", "area", "pie"], {
            default: "bar",
            aliases: ["chartType", "variant"],
            enumAliases: { column: "bar", columns: "bar", barchart: "bar", histogram: "bar", linechart: "line", trend: "line", areachart: "area", piechart: "pie", donut: "pie", doughnut: "pie" },
          }),
          labels: listOr({ type: "array", items: { type: "string" } }, { aliases: ["categories", "xAxis", "x", "keys"] }),
          series: {
            description: "[{name, values}], or shorthand: a list of numbers (one series) or of number lists",
            aliases: ["datasets", "data", "values"],
            anyOf: [
              {
                type: "array",
                items: props(
                  { name: str({ aliases: ["label", "title"] }), values: { type: "array", items: { type: "number" }, aliases: ["data", "points", "y"] } },
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
      aliases: ["stepper", "progress", "wizard", "process", "checklist_steps"],
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
          kind: oneOf(["text", "email", "number", "tel", "url"], {
            aliases: ["inputType", "format"],
            enumAliases: { phone: "tel", telephone: "tel", integer: "number", link: "url", string: "text" },
            namesComponent: true,
          }),
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
      aliases: ["datepicker", "calendar", "dateinput", { name: "daterange", props: { range: true } }],
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
