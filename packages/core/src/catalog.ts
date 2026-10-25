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
  opts: { container?: string; examples?: CatalogExample[] } = {},
): Catalog {
  const container = opts.container ?? Object.keys(components).find((n) => components[n]!.children);
  if (!container || !components[container]?.children) {
    throw new Error(`catalog ${id}: needs a container component (one with children: true)`);
  }
  return { id, components, common, container, examples: opts.examples ?? [] };
}

/** Only the components of a tier ("core" drops "extended" ones); examples using dropped components go too. */
export function withTier(catalog: Catalog, tier: "core" | "extended"): Catalog {
  if (tier === "extended") return catalog;
  const components: Record<string, ComponentDef> = {};
  for (const [name, def] of Object.entries(catalog.components)) {
    if ((def.tier ?? "core") === "core" || name === catalog.container) components[name] = def;
  }
  const examples = catalog.examples.filter((ex) => ex.render.nodes.every((n) => n.type in components));
  return { ...catalog, components, examples };
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
      ? { type: "array", items: { anyOf: [{ type: "object", description: "a child node {id, type, props, children}" }, { type: "string" }] }, description: "child nodes, in order (ids of template nodes allowed)" }
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
      const properties: Record<string, JSONSchema> = {
        id: { type: "string" },
        type: { const: name, type: "string" },
        props: toWireSchema(props),
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
        "Show rich UI to the user. Creates or replaces a surface. Nodes are a flat list, root first; parents list child ids.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string", description: "stable id for this UI, reuse it to replace" },
          title: { type: "string" },
          nodes: { type: "array", items: nodeSchema(catalog, mode, false, opts.authoring), minItems: 1 },
          data: { type: "object", description: "data model; props bind into it with {/path}" },
        },
        required: ["surface", "nodes"],
      },
    },
    {
      name: TOOL_UPDATE,
      description: "Change part of an existing surface: patch nodes by id and/or patch data with JSON Patch ops.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string" },
          title: { type: "string" },
          nodes: { type: "array", items: nodeSchema(catalog, "compact", true, opts.authoring) },
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
  "Answer with one JSON object: {\"reply\": \"one short sentence\", \"render\": <vak_render arguments, or null only when the answer has no structure at all>}. " +
  "To change a UI you showed before, render it again with the same surface id.";

// ---------------------------------------------------------------------------
// Prompt text

function describeType(s: JSONSchema): string {
  if (s.enum) return s.enum.map(String).join("|");
  if (s.anyOf) return s.anyOf.map(describeType).join(" or ");
  const t = Array.isArray(s.type) ? s.type.join("|") : (s.type ?? "any");
  if (t === "array" && s.items) {
    const item = s.items.properties
      ? `{${Object.keys(s.items.properties).join(",")}}`
      : describeType(s.items);
    return `${item}[]`;
  }
  return t;
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
    "Prefer UI over long prose whenever content has structure: options, comparisons, metrics, steps, forms.",
    "",
    "Rules:",
    opts.authoring === "inline"
      ? "- nodes starts with the node with id \"root\". Write each child node directly inside its parent's \"children\" array, so every node is defined where it is used. A template node (see each/template below) is its own entry in nodes."
      : "- nodes is a FLAT list. Put the node with id \"root\" first. Parents reference children by id in \"children\".",
    "- Put values in data and bind them: \"{/path}\" inside any string. A string that is only \"{/path}\" keeps the raw value.",
    "- Repeat a node per list item with children: {\"each\": \"/items\", \"template\": \"tplId\"}; inside the template use relative paths like \"{name}\".",
    "- Inputs use bind: \"/form/field\". A form's submit is an action name.",
    "- Put data in the surface's data field (vak_update: ops, or an object to merge), not inside nodes.",
    "- When the user acts on your UI you get a message starting with \"[ui action]\" holding {action, surface, data}.",
    "  Always answer it visibly: update that surface (vak_update) or render the next step. Never leave an action without feedback.",
    "- checks: \"required\", \"email\", \"url\", \"number\", \"minLength:3\", \"maxLength:80\", \"min:0\", \"max:10\".",
    "- Only use the components and props listed below. * marks required props.",
    "",
    "Layout: compose real layouts, not a single column. Use grid for card collections and dashboards (it adapts 1→4 columns),",
    "split for primary + secondary content, stack direction:horizontal for toolbars and button rows. Any node accepts",
    "span (1-4 or \"full\") to make bento-style layouts and priority (primary|secondary|tertiary) for small screens and chat.",
    "",
    `Components (${catalog.id}):`,
  );
  for (const [name, def] of Object.entries(catalog.components)) {
    const props = describeProps(def.props);
    const extra = [def.children ? "has children" : "", def.hint ?? ""].filter(Boolean).join("; ");
    lines.push(`- ${name}: ${def.description}${props ? ` props: ${props}` : ""}${extra ? ` (${extra})` : ""}`);
  }
  const common = describeProps({ properties: catalog.common });
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
