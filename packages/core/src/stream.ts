// Progressive rendering while a tool call's arguments stream in.

import { parsePartial } from "./partial-json.ts";
import { type Diagnostic, type SurfaceStore } from "./surface.ts";
import { TOOL_RENDER } from "./vps.ts";

export interface StreamTick {
  /** Surface touched by this delta, once its id is known. */
  surface?: string;
  /** True when the visible surface changed and projectors should refresh. */
  changed: boolean;
}

/**
 * Feed argument deltas for one tool call. vak_render is applied
 * progressively (each node as soon as its id and type are complete);
 * other tools apply once on `end()`.
 */
export class ToolCallStream {
  readonly tool: string;
  private store: SurfaceStore;
  private text = "";
  private lastSignature = "";
  private surface?: string;
  private select: (root: unknown) => unknown;

  /**
   * `select` picks the tool arguments out of the streamed document, for when
   * they are nested (constrained output: `{render: {...}, reply}`).
   */
  constructor(store: SurfaceStore, tool: string, opts: { select?: (root: unknown) => unknown } = {}) {
    this.store = store;
    this.tool = tool;
    this.select = opts.select ?? ((root) => root);
  }

  /** The streamed text so far. */
  get raw(): string {
    return this.text;
  }

  push(delta: string): StreamTick {
    this.text += delta;
    if (this.tool !== TOOL_RENDER) return { changed: false };
    const r = parsePartial(this.text);
    const args = this.select(r.value);
    if (args === null || typeof args !== "object" || Array.isArray(args)) return { changed: false };
    const a = args as Record<string, unknown>;
    if (typeof a.surface !== "string" || r.partialKeys.get(a)?.has("surface")) return { changed: false };

    const nodes = (Array.isArray(a.nodes) ? a.nodes : []).filter((n) => {
      if (n === null || typeof n !== "object") return false;
      const partial = r.partialKeys.get(n);
      const o = n as Record<string, unknown>;
      return typeof o.id === "string" && typeof (o.type ?? o.component) === "string" && !partial?.has("id") && !partial?.has("type");
    });
    if (nodes.length === 0) return { surface: a.surface, changed: false };

    // Only re-apply when something visible moved: node count or text length.
    const signature = `${nodes.length}:${this.text.length}`;
    if (signature === this.lastSignature) return { surface: a.surface, changed: false };
    this.lastSignature = signature;
    this.surface = a.surface;
    this.store.render(
      { surface: a.surface, title: typeof a.title === "string" ? a.title : undefined, nodes: nodes as never, data: a.data as never },
      { partial: true },
    );
    return { surface: a.surface, changed: true };
  }

  /** Apply the finished arguments and return diagnostics for the model. */
  end(): { surface?: string; diagnostics: Diagnostic[]; args: unknown } {
    const r = parsePartial(this.text, { final: true });
    const args = this.select(r.value) ?? {};
    const diagnostics = this.store.apply(this.tool, args);
    const surface = (args as { surface?: unknown }).surface;
    return { surface: typeof surface === "string" ? surface : this.surface, diagnostics, args };
  }
}
