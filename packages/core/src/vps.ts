// Vak Projection Spec (VPS): the target-neutral shape the LLM emits.

/** Children are either static node ids or a template repeated over a data list. */
export type Children = string[] | { each: string; template: string };

export interface VpsNode {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: Children;
}

/** vak_render: create or replace a surface. */
export interface RenderArgs {
  surface: string;
  title?: string;
  nodes: VpsNode[];
  data?: Record<string, unknown>;
}

/** Partial node: props merge shallowly, a `null` prop value deletes the key. */
export interface NodePatch {
  id: string;
  type?: string;
  props?: Record<string, unknown>;
  children?: Children;
}

/** RFC 6902 subset applied to the surface data model. */
export interface PatchOp {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

/** vak_update: patch nodes and/or data on an existing surface. */
export interface UpdateArgs {
  surface: string;
  title?: string;
  nodes?: NodePatch[];
  data?: PatchOp[];
}

/** vak_remove: drop a whole surface, or only the listed nodes. */
export interface RemoveArgs {
  surface: string;
  ids?: string[];
}

/** What returns to the model when a user acts, identical on every target. */
export interface VpsAction {
  action: string;
  surface: string;
  source: string;
  target?: string;
  data: Record<string, unknown>;
}

export const TOOL_RENDER = "vak_render";
export const TOOL_UPDATE = "vak_update";
export const TOOL_REMOVE = "vak_remove";
export type ToolName = typeof TOOL_RENDER | typeof TOOL_UPDATE | typeof TOOL_REMOVE;

/**
 * Accepted spellings when reading tool arguments. `nodes` / `type` are
 * canonical and the only names the tool schemas advertise; the others are
 * tolerated on input because models trained on other UI formats use them.
 */
export const NODE_LIST_KEYS = ["nodes", "components", "elements", "children", "ui", "items", "layout"] as const;
export const NODE_TYPE_KEYS = ["type", "component", "element", "widget"] as const;
