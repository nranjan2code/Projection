// Starter component set. Props are semantic (tone, size, priority), never pixels,
// so every projector can interpret them for its surface.
//
// Repair knowledge is declared here, beside what it repairs, so the engine
// stays generic:
// - component `aliases`: other names models use (HTML tags, other UI kits)
// - property `aliases` / `enumAliases`: other spellings of props and values
// - schema `default`: a sensible value for a required prop the model omitted
// - `defaults`: props derivable from other props (an input's label from its bind)
// - `normalize`: shape fixes for component-specific data (chart series)

import { defineCatalog } from "./catalog.ts";
import type { JSONSchema } from "./schema.ts";

type Extra = Pick<JSONSchema, "aliases" | "enumAliases" | "description" | "default" | "format">;

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
  return { ...p, columns };
}

const numeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/** Canonicalize the series shorthands the schema accepts into [{name?, values}]. */
function normalizeChart(p: Record<string, unknown>): Record<string, unknown> {
  const s = p.series;
  if (!Array.isArray(s) || s.length === 0) return p;
  if (s.every(numeric)) return { ...p, series: [{ values: s.map(Number) }] };
  if (s.every((v) => Array.isArray(v))) return { ...p, series: (s as unknown[][]).map((values) => ({ values: values.map(Number) })) };
  return p;
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
      }),
      children: true,
      hint: "children may set span for bento layouts",
      aliases: ["columns", "gallery", "cards", "cardgrid", "dashboard", "bento", "masonry"],
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
        { name: "code", props: { variant: "code" } },
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
        },
        ["columns", "rows"],
      ),
      finalize: finalizeTable,
      aliases: ["datatable", "grid_table", "spreadsheet", "datagrid"],
    },
    list: {
      description: "Simple list of text items.",
      props: props({
        items: listOr({ type: "array", items: { type: "string" } }, { aliases: ["list", "entries", "bullets", "values", "points"] }),
        ordered: bool({ aliases: ["numbered"] }),
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
      aliases: [
        "graph", "plot",
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
          kind: oneOf(["text", "email", "number", "tel", "url"], { aliases: ["inputType", "format"], enumAliases: { phone: "tel", telephone: "tel", integer: "number", link: "url", string: "text" } }),
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
