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
 * When to look at the streamed document again. Parsing it on every delta is
 * the other half of the quadratic cost: the parse itself is O(document), so a
 * 36 KB render was reparsed thousands of times (0.9 ms each at the end) even
 * though most deltas cannot complete a node. Parse when a bit more has
 * arrived — a fraction of the document, so early nodes still appear at once
 * and later ones arrive in a few batches — and the same rule decides when the
 * store is rebuilt: a quarter more nodes, or a chunk of a growing node.
 */
const PARSE_STEP = 48;
const PARSE_FRACTION = 24;
const NODE_GROWTH = 0.25;
const TEXT_CHUNK = 256;
/** A bigger surface costs more to rebuild, so it settles for coarser text updates. */
const TEXT_CHUNK_PER_NODE = 8;

/**
 * Feed argument deltas for one tool call. vak_render is applied
 * progressively (nodes as they complete, batched — see above); other tools
 * apply once on `end()`.
 */
export class ToolCallStream {
  readonly tool: string;
  private store: SurfaceStore;
  private text = "";
  private surface?: string;
  private select: (root: unknown) => unknown;
  private parsedBytes = 0;
  private appliedNodes = 0;
  private appliedBytes = 0;

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
    if (this.text.length - this.parsedBytes < Math.max(PARSE_STEP, this.parsedBytes / PARSE_FRACTION)) {
      return { surface: this.surface, changed: false };
    }
    this.parsedBytes = this.text.length;
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

    const moreNodes = nodes.length >= this.appliedNodes + Math.max(1, Math.floor(this.appliedNodes * NODE_GROWTH));
    const moreText = this.text.length - this.appliedBytes >= TEXT_CHUNK + TEXT_CHUNK_PER_NODE * nodes.length;
    if (!moreNodes && !moreText) return { surface: a.surface, changed: false };
    this.appliedNodes = nodes.length;
    this.appliedBytes = this.text.length;
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
