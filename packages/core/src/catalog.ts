// The catalog is the single source of truth: it generates the tool schemas,
// the prompt text, the validator and (via projectors) the renderer registry.

import { type JSONSchema, toWireSchema } from "./schema.ts";
import { type RenderArgs, TOOL_REMOVE, TOOL_RENDER, TOOL_UPDATE, type VpsNode } from "./vps.ts";

/** Another name for a component, optionally implying props ("row" → stack, direction: horizontal). */
export type ComponentAlias = string | { name: string; props: Record<string, unknown> };

export interface ComponentDef {
  description: string;
  /** Object schema for `props`. Property schemas may carry `aliases` / `enumAliases` / `default`. */
  props: JSONSchema;
  /** Whether the node may have children. */
  children?: boolean;
  /** Short usage hint shown to the model. */
  hint?: string;
  /** Other names models use for this component (HTML tags, other UI kits). */
  aliases?: readonly ComponentAlias[];
  /**
   * Shape repairs specific to this component's data (e.g. a chart's series sent
   * as a bare number list). Runs after alias renaming and type coercion.
   */
  normalize?: (props: Record<string, unknown>) => Record<string, unknown>;
  /** Schema-declared semantic variants; only used when the target validates. */
  retype?: readonly { when: JSONSchema; type: string }[];
  /**
   * Values for props the model omitted that can be derived from the props it
   * did send (an input's label from its bind path). Only missing keys are used;
   * never invent content the model was asked for.
   */
  defaults?: (props: Record<string, unknown>, ctx: { id: string }) => Record<string, unknown>;
  /**
   * Canonicalize props after bindings resolve, for shapes that depend on the
   * bound data (a table's string columns matched against its row keys). Every
   * projector receives the canonical form.
   */
  finalize?: (props: Record<string, unknown>) => Record<string, unknown>;
  /**
   * How the engine treats activation. "form": activating it submits the bound
   * inputs inside it. "action": activating it sends its `action` prop (with any
   * bound inputs in its nearest container). Inputs are any node with `bind`.
   */
  role?: "form" | "action";
  /**
   * With role "action": the list prop whose items are each choosable on their
   * own (a comparison's options). Control `<node key>#<index>` submits the
   * node's action with `{option: <item name>}` added to its payload, so every
   * projector can draw one button per item.
   */
  choices?: string;
  /**
   * "core": always offered. "extended": offered only to models the policy
   * judges capable of using a larger vocabulary well. Defaults to "core".
   */
  tier?: "core" | "extended";
}

/** A worked example: a request and the render that answers it well. Must render without diagnostics. */
export interface CatalogExample {
  request: string;
  render: RenderArgs;
}

export interface Catalog {
  id: string;
  components: Record<string, ComponentDef>;
  /** Props accepted on every node (layout hints, visibility). */
  common: Record<string, JSONSchema>;
  /**
   * The generic container: used when the engine must group nodes itself (a
   * synthesized root) or a typeless node only has children.
   */
  container: string;
  examples: CatalogExample[];
  /**
   * How one list item is shown when a model repeats a template it never sent
   * (children {each, template} naming no node). Gets the items' fields and
   * returns one node, written inline. Without it, that is an error.
   */
  itemTemplate?: (fields: ItemField[]) => Record<string, unknown> | undefined;
}

/** A field of the items in a data list; name "." is a list of plain values. */
export interface ItemField {
  name: string;
  /** For people: "price_per_night" is "Price per night". */
  label: string;
  kind: "text" | "list";
}

export type Support = "native" | "degraded" | "none";

/** What a projection target can do; drives prompt narrowing and degradation. */
export interface CapabilityProfile {
  target: string;
  /** Per-component support; unlisted components count as "degraded". */
  components?: Record<string, Support>;
  /** "adaptive" = real multi-column layout; "linear" = flattened in priority order. */
  layout: "adaptive" | "linear";
  streaming: "incremental" | "edit" | "none";
  markup: "html" | "markdown" | "mrkdwn" | "plain";
  maxFormFields?: number;
  maxTextLength?: number;
  /** Extra guidance appended to the prompt for this target. */
  notes?: string[];
}

export function defineCatalog(
  id: string,
  components: Record<string, ComponentDef>,
  common: Record<string, JSONSchema> = {},
  opts: { container?: string; examples?: CatalogExample[]; itemTemplate?: Catalog["itemTemplate"] } = {},
): Catalog {
  const container = opts.container ?? Object.keys(components).find((n) => components[n]!.children);
  if (!container || !components[container]?.children) {
    throw new Error(`catalog ${id}: needs a container component (one with children: true)`);
  }
  return { id, components, common, container, examples: opts.examples ?? [], ...(opts.itemTemplate ? { itemTemplate: opts.itemTemplate } : {}) };
}

/**
 * Only the components of a tier ("core" drops "extended" ones); examples using
 * dropped components go too. `keep` names extended components to offer anyway:
 * one the user asked for, or one already on screen that the model may update.
 */
export function withTier(catalog: Catalog, tier: "core" | "extended", keep: Iterable<string> = []): Catalog {
  if (tier === "extended") return catalog;
  const kept = new Set(keep);
  const components: Record<string, ComponentDef> = {};
  for (const [name, def] of Object.entries(catalog.components)) {
    if ((def.tier ?? "core") === "core" || name === catalog.container || kept.has(name)) components[name] = def;
  }
  const examples = catalog.examples.filter((ex) => ex.render.nodes.every((n) => n.type in components));
  return { ...catalog, components, examples };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name counts as a noun the request asks for: "the X component", after an
// article or determiner ("a board", "two timers"; not "my", which names the
// user's data rather than a format: "my to-do list"), right after
// a leading imperative ("Show progress bars"), or as a several-word name
// opening the request ("Stacked bar chart of…"). A lone opening word is often
// a verb ("Compare these hotels"), and a name in passing prose ("how to track
// progress") is not a request for it. Plurals count.
const VERB = "^\\s*(?:(?:please|can you|could you)\\s+)?(?:show|make|build|create|draw|give|add|render|display|plot|list|set up|start|put)(?:\\s+me)?\\s+(?:(?!(?:my|your|our)\\b)[\\w-]+\\s+){0,2}";
const phrase = (token: string, explicit = false) => {
  if (explicit) return new RegExp(`\\b${token}s?\\s+component\\b|\\bcomponent\\s+(?:named\\s+)?${token}s?\\b`, "i");
  const re = new RegExp(`\\b${token}s?\\s+component\\b|\\bcomponent\\s+(?:named\\s+)?${token}s?\\b|\\b(?:a|an|the|some|these|those|two|three|four|five|\\d+)\\s+(?:[\\w-]+\\s+){0,3}${token}s?\\b|${VERB}${token}s?\\b`, "i");
  const opening = new RegExp(`^\\s*(${token})s?\\b`, "i");
  return { test: (text: string) => re.test(text) || /[\s-]/.test(opening.exec(text)?.[1] ?? "") };
};

/**
 * The presets of a component's aliases the request uses: "a stacked bar
 * chart" → [{kind: "stacked"}], "a slider and a time picker" for input →
 * [{kind: "range"}, {kind: "time"}]. An alias inside a longer matching one
 * ("bar chart" in "stacked bar chart") is not counted separately.
 */
export function namedPresets(catalog: Catalog, request: string, name: string): Record<string, unknown>[] {
  const loose = (n: string) => [...n].map(escape).join("[\\s-]?");
  const hits = (catalog.components[name]?.aliases ?? [])
    .filter((a): a is Exclude<ComponentAlias, string> => typeof a !== "string" && phrase(loose(a.name)).test(request))
    .sort((x, y) => y.name.length - x.name.length);
  // A longer matching name elsewhere wins too: "a star rating" is input's starrating, not progress's rating.
  const others = Object.entries(catalog.components).flatMap(([other, d]) => (other === name ? [] : (d.aliases ?? []).map((x) => (typeof x === "string" ? x : x.name)).filter((n) => phrase(loose(n)).test(request))));
  const kept = hits.filter((a, i) => !hits.slice(0, i).some((b) => b.name.includes(a.name)) && !others.some((n) => n.length > a.name.length && n.includes(a.name)));
  return [...new Map(kept.map((a) => [JSON.stringify(a.props), a.props])).values()];
}

/**
 * Components a request names: "the timeline component", "a component named
 * map", "a graph", "as an interactive graph view". With `aliases`, other names
 * count too, written as one word or several ("an org chart" for orgchart).
 * With `explicit`, only "the X component" / "a component named X" count.
 */
export function namedComponents(catalog: Catalog, request: string, opts: { aliases?: boolean; explicit?: boolean } = {}): string[] {
  const all = (name: string, def: ComponentDef) => [name, ...(def.aliases ?? []).map((a) => (typeof a === "string" ? a : a.name))];
  // An alias written as one word ("orgchart") also matches its spaced or hyphenated form.
  const loose = (n: string) => [...n].map(escape).join("[\\s-]?");
  return Object.entries(catalog.components)
    .filter(([name, def]) => {
      // A longer name of another component wins: "an org chart" names graph
      // (orgchart), not chart.
      const longer = Object.entries(catalog.components).flatMap(([other, d]) => (other === name ? [] : all(other, d).filter((n) => n.length > name.length && n.includes(name))));
      const text = longer.reduce((t, n) => t.replace(new RegExp(`\\b${loose(n)}\\b`, "gi"), " "), request);
      return (opts.aliases ? all(name, def) : [name]).some((n) => phrase(opts.aliases ? loose(n) : escape(n), opts.explicit).test(text));
    })
    .map(([name]) => name);
}

export function support(profile: CapabilityProfile | undefined, type: string): Support {
  return profile?.components?.[type] ?? (profile ? "degraded" : "native");
}

/** Drop components the target cannot show at all. */
export function narrow(catalog: Catalog, profile: CapabilityProfile): Catalog {
  const components: Record<string, ComponentDef> = {};
  for (const [name, def] of Object.entries(catalog.components)) {
    if (support(profile, name) !== "none" || name === catalog.container) components[name] = def;
  }
  const examples = catalog.examples.filter((ex) => ex.render.nodes.every((n) => n.type in components));
  return { ...catalog, components, examples };
}

export function propsSchema(catalog: Catalog, type: string): JSONSchema | undefined {
  const def = catalog.components[type];
  if (!def) return undefined;
  return {
    ...def.props,
    type: "object",
    properties: { ...catalog.common, ...def.props.properties },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

/**
 * How the model writes the node tree. "flat": one list, children referenced by
 * id (best for progressive streaming). "inline": each child written inside its
 * parent's children, so nothing referenced can be left undefined. The engine
 * accepts both; this only changes what the model is asked to write.
 */
export type Authoring = "flat" | "inline";

export interface ToolOptions {
  /**
   * "strict": each node is a union keyed by `type` with its exact props schema.
   * Best with constrained decoding (Ollama `format`, OpenAI strict mode).
   * "compact": props are a free object; the component list lives in the prompt.
   */
  mode?: "strict" | "compact";
  authoring?: Authoring;
}

const childrenSchema = (authoring: Authoring): JSONSchema => ({
  anyOf: [
    authoring === "inline"
      ? { type: "array", items: { anyOf: [{ type: "object", properties: { id: { type: "string" }, type: { type: "string" }, props: { type: "object" }, children: { anyOf: [{ type: "array" }, { type: "object" }] } }, required: ["id", "type"], additionalProperties: false, description: "a child node {id, type, props, children}; no anonymous wrappers" }, { type: "string" }] }, description: "child nodes, in order (ids of template nodes allowed)" }
      : { type: "array", items: { type: "string" }, description: "ids of child nodes, in order" },
    {
      type: "object",
      properties: {
        each: { type: "string", description: "data path of a list, e.g. /results" },
        template: { type: "string", description: "id of the node repeated per item" },
      },
      required: ["each", "template"],
    },
  ],
});

function nodeSchema(catalog: Catalog, mode: "strict" | "compact", partial: boolean, authoring: Authoring = "flat"): JSONSchema {
  const CHILDREN_SCHEMA = childrenSchema(authoring);
  const names = Object.keys(catalog.components);
  const required = partial ? ["id"] : ["id", "type"];
  if (mode === "compact") {
    return {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: names },
        props: { type: "object" },
        children: CHILDREN_SCHEMA,
      },
      required,
    };
  }
  return {
    anyOf: names.map((name) => {
      const def = catalog.components[name]!;
      const props = propsSchema(catalog, name)!;
      const wireProps = toWireSchema(props);
      // Common prop descriptions repeat in every branch of the model's
      // component union. Keep their types here and explain them once in the
      // system prompt; a local card request otherwise sends that prose 18x.
      for (const key of Object.keys(catalog.common)) {
        const property = wireProps.properties?.[key];
        if (property) delete property.description;
      }
      const properties: Record<string, JSONSchema> = {
        id: { type: "string" },
        type: { const: name, type: "string" },
        props: wireProps,
      };
      if (def.children) properties.children = CHILDREN_SCHEMA;
      return { type: "object", properties, required: ["id", "type"], additionalProperties: false };
    }),
  };
}

export function toolDefinitions(catalog: Catalog, opts: ToolOptions = {}): ToolDefinition[] {
  const mode = opts.mode ?? "strict";
  return [
    {
      name: TOOL_RENDER,
      description:
        opts.authoring === "inline"
          ? "Show rich UI. Creates or replaces a surface. Start with root; write child node objects directly in children. Arrays and objects are JSON values, never JSON-encoded strings."
          : "Show rich UI to the user. Creates or replaces a surface. Nodes are a flat list, root first; parents list child ids.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string", description: "stable id for this UI; reuse only for a complete replacement including all data; correct parts with vak_update" },
          title: { type: "string" },
          nodes: { type: "array", items: nodeSchema(catalog, mode, false, opts.authoring), minItems: 1 },
          data: { type: "object", description: "complete data model; props bind with {/path}; initialize supplied input values at their exact bind paths" },
        },
        required: ["surface", "nodes"],
      },
    },
    {
      name: TOOL_UPDATE,
      description: "Change part of an existing surface: patch nodes by id and/or patch data with JSON Patch ops. For children, send existing node IDs, not a rewritten nested tree; keep all children that should remain.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string" },
          title: { type: "string" },
          nodes: { type: "array", items: nodeSchema(catalog, "compact", true, "flat") },
          data: {
            description: "JSON Patch ops, or an object deep-merged into the data model",
            anyOf: [
              {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    op: { type: "string", enum: ["add", "replace", "remove"] },
                    path: { type: "string" },
                    value: {},
                  },
                  required: ["op", "path"],
                },
              },
              { type: "object" },
            ],
          },
        },
        required: ["surface"],
      },
    },
    {
      name: TOOL_REMOVE,
      description: "Remove a whole surface, or only the listed node ids.",
      inputSchema: {
        type: "object",
        properties: { surface: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
        required: ["surface"],
      },
    },
  ];
}

/**
 * Schema for constrained (grammar-decoded) projection: the model's whole
 * answer is `{reply, render}`. Decoding follows property order, so `reply`
 * comes first: the model states its answer before deciding on and building
 * the UI (rendering first made "no UI" the cheapest first token). `render` is
 * null when the answer needs no UI.
 */
export function projectionResponseSchema(catalog: Catalog): JSONSchema {
  const render = toolDefinitions(catalog, { mode: "strict" })[0]!.inputSchema;
  return {
    type: "object",
    properties: {
      reply: { type: "string", description: "one short sentence for the user" },
      render: { anyOf: [render, { type: "null" }] },
    },
    required: ["reply", "render"],
  };
}

export const CONSTRAINED_INSTRUCTIONS =
  "Answer with one JSON object: {\"reply\": \"one short sentence\", \"render\": <vak_render arguments, or null when the reply is conversation or a short plain answer>}. " +
  "To change a UI you showed before, render it again with the same surface id.";

// ---------------------------------------------------------------------------
// Prompt text

function describeType(s: JSONSchema): string {
  if (s.enum) return s.enum.map(String).join("|");
  if (s.anyOf) return s.anyOf.map(describeType).join(" or ");
  const t = Array.isArray(s.type) ? s.type.join("|") : (s.type ?? "any");
  if (t === "array" && s.items) {
    return `(${describeType(s.items)})[]`;
  }
  if (t === "object" && s.properties) return `{${describeProps(s)}}`;
  return s.literal ? `${t} (literal source, copy exactly; no ANSI, fences or extra escaping)` : t;
}

function describeProps(schema: JSONSchema): string {
  const req = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .map(([k, s]) => `${k}${req.has(k) ? "*" : ""}: ${describeType(s)}`)
    .join(", ");
}

export interface PromptOptions {
  /** Include the catalog's worked examples (helps models that compose UIs poorly). */
  examples?: boolean;
  authoring?: Authoring;
}

/** A flat example rewritten with children inline (template nodes stay top-level, as ids are needed there). */
export function toInline(render: RenderArgs): RenderArgs {
  const byId = new Map(render.nodes.map((n) => [n.id, n]));
  const templates = new Set(render.nodes.flatMap((n) => (n.children && !Array.isArray(n.children) ? [n.children.template] : [])));
  const used = new Set<string>();
  const build = (id: string): VpsNode => {
    const n = byId.get(id)!;
    used.add(id);
    const out: VpsNode = { ...n };
    if (Array.isArray(n.children)) {
      out.children = n.children.map((c) => (byId.has(c) && !templates.has(c) && !used.has(c) ? build(c) : c)) as never;
    }
    return out;
  };
  const root = byId.get("root") ?? render.nodes[0]!;
  const nodes = [build(root.id)];
  for (const n of render.nodes) if (!used.has(n.id)) nodes.push(build(n.id));
  return { ...render, nodes };
}

export function systemPrompt(catalog: Catalog, profile?: CapabilityProfile, opts: PromptOptions = {}): string {
  const lines: string[] = [];
  lines.push(
    "You can show rich, interactive UI by calling vak_render (new or replaced surface), vak_update (patch) and vak_remove.",
    "Choose whether to use UI from the user's request and caller instructions. Existing surfaces do not require another render.",
    "",
    "Rules:",
      opts.authoring === "inline"
      ? "- nodes starts with the node with id \"root\". Write each child node directly inside its parent's \"children\" array, so every node is defined where it is used. A template node (see each/template below) is its own entry in nodes."
      : "- nodes is a FLAT list. Put the node with id \"root\" first. Parents reference children by id in \"children\".",
    "- If the user names a listed component, use that exact type. Preserve all user-supplied items, labels, order and values exactly. Do not invent dates or rewrite supplied source code.",
    "- Supplied captions and code are source material: copy verbatim, including punctuation and whitespace. Do not paraphrase, embellish or omit parts.",
    "- Write arrays and objects directly as JSON, not strings containing JSON. A leaf component stores its items in props, never in children.",
    "- Preserve supplied values and units. Formatting displayed currency or percentages must not change the numeric values stored in data.",
    "- Put values in data and bind them: \"{/path}\" inside any string. A string that is only \"{/path}\" keeps the raw value.",
    "- Repeat a node per list item with children: {\"each\": \"/items\", \"template\": \"tplId\"}; inside the template use relative paths like \"{name}\"; for a list of plain values, \"{.}\" is the item.",
    "- Inputs use bind: \"/form/field\". A form's submit is an action name.",
    "- Initialize every supplied input value in data at its exact bind path; props.value and placeholders do not initialize a bound control. Preserve numeric values and units exactly; never rescale supplied amounts. Leave unspecified input values blank; do not invent defaults for missing facts or add populated fields the user did not request.",
    "- vak_render replaces the entire surface, including data. For corrections use vak_update with existing surface/node IDs and change only the affected props/data. Omitted fields survive a patch; an explicit empty array replaces a list. To delete a node use vak_remove with its id; to delete stored values use data JSON Patch remove ops with their exact paths. Omitting a field from merged data never deletes it. Do not create new IDs for retries.",
    "- Independently requested outputs need separate vak_render calls with distinct stable surface IDs. Keep requested source/sample labels visible in the surface title or content.",
    "- Put data in the surface entry data field, not inside nodes.",
    "- When the user acts on your UI you get a message starting with \"[ui action]\" holding {action, surface, data}.",
    "  Always answer it visibly: update that surface (vak_update) or render the next step. Never leave an action without feedback.",
    "- checks: \"required\", \"email\", \"url\", \"number\", \"minLength:3\", \"maxLength:80\", \"min:0\", \"max:10\".",
    "- Only use the components and props listed below. * marks required props.",
    "",
    `Components (${catalog.id}):`,
  );
  for (const [name, def] of Object.entries(catalog.components)) {
    const props = describeProps(def.props);
    const extra = [def.children ? "has children" : "", def.hint ?? ""].filter(Boolean).join("; ");
    lines.push(`- ${name}: ${def.description}${props ? ` props: ${props}` : ""}${extra ? ` (${extra})` : ""}`);
  }
  const common = Object.entries(catalog.common).map(([name, schema]) => `${name}: ${describeType(schema)}${schema.description ? ` (${schema.description})` : ""}`).join(", ");
  if (common) lines.push(`Common props on every node: ${common}`);
  if (opts.examples && catalog.examples.length) {
    lines.push("", "Examples of good vak_render arguments:");
    for (const ex of catalog.examples) lines.push(`Request: ${ex.request}`, `vak_render: ${JSON.stringify(opts.authoring === "inline" ? toInline(ex.render) : ex.render)}`);
  }
  if (profile) {
    lines.push("", `Target: ${profile.target}.`);
    if (profile.layout === "linear") lines.push("This target shows one column; layout is flattened in priority order, so order nodes by importance.");
    if (profile.maxFormFields) lines.push(`Keep forms to at most ${profile.maxFormFields} fields.`);
    for (const note of profile.notes ?? []) lines.push(note);
  }
  return lines.join("\n");
}
