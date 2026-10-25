// Lowering: richer components written as the basic ones every projector
// already draws. The web renders timeline, steps, code, map, gallery and graph
// natively; chat platforms and plain text get them here, so a new component
// never shows up as nothing on a target that predates it.

import type { ResolvedNode, ResolvedSurface } from "./surface.ts";

export const LOWERED = new Set(["timeline", "steps", "code", "map", "gallery", "graph"]);

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const items = (p: Record<string, unknown>) => (Array.isArray(p.items) ? p.items : []) as Record<string, unknown>[];

/** A map link that needs no key and keeps the place private to the user's own click (OpenStreetMap). */
export function mapLink(place: Record<string, unknown>): string {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent([s(place.name), s(place.address)].filter(Boolean).join(", "))}`;
}

/** Markdown-safe text for list items (a title must not start a heading or close a link). */
const md = (v: unknown) => s(v).replace(/[[\]]/g, "");

const STEP = { done: "✓", current: "→", todo: "○", skipped: "–", failed: "✗" } as Record<string, string>;

export function lowerNode(n: ResolvedNode): ResolvedNode {
  const p = n.props;
  const make = (type: string, props: Record<string, unknown>, children: ResolvedNode[] = []): ResolvedNode => ({ ...n, type, props, children });
  switch (n.type) {
    case "timeline":
      return make("list", { items: items(p).map((it) => [it.date ? `**${md(it.date)}**` : "", md(it.title), it.description ? `— ${s(it.description)}` : ""].filter(Boolean).join(" ")) });
    case "steps":
      return make("list", { ordered: true, items: items(p).map((it) => `${STEP[s(it.status)] ?? STEP.todo} **${md(it.title)}**${it.description ? ` — ${s(it.description)}` : ""}`) });
    case "code": {
      const fence = s(p.code).includes("```") ? "~~~" : "```";
      return make("text", { content: `${p.title ? `**${md(p.title)}**\n\n` : ""}${fence}${s(p.language)}\n${s(p.code)}\n${fence}` });
    }
    case "map": {
      const places = (Array.isArray(p.places) ? p.places : []) as Record<string, unknown>[];
      return make("list", { items: places.map((pl) => `[${md(pl.name) || md(pl.address) || "Place"}](${mapLink(pl)})${pl.address && pl.name ? ` — ${s(pl.address)}` : ""}${pl.note ? ` · ${s(pl.note)}` : ""}`) });
    }
    case "gallery": {
      const images = (Array.isArray(p.images) ? p.images : []) as Record<string, unknown>[];
      // Each picture as an image node: chat projectors verify and embed them their own way.
      return make(
        "stack",
        {},
        images.map((im, i) => ({ key: `${n.key}#img${i}`, id: `${n.id}_img${i}`, type: "image", props: { src: s(im.src), alt: s(im.alt ?? im.caption) }, children: [] })),
      );
    }
    case "graph": {
      // One line per connection, then the nodes nothing connects, so every
      // node and edge reads on a target that cannot draw.
      const nodes = (Array.isArray(p.nodes) ? p.nodes : []) as Record<string, unknown>[];
      const edges = (Array.isArray(p.edges) ? p.edges : []) as Record<string, unknown>[];
      const label = new Map(nodes.map((nd) => [s(nd.id), md(nd.label ?? nd.id)]));
      const name = (id: unknown) => `**${label.get(s(id)) ?? md(id)}**`;
      const arrow = p.directed === false ? "—" : "→";
      const linked = new Set(edges.flatMap((e) => [s(e.from), s(e.to)]));
      const detail = (nd: Record<string, unknown>) => [nd.group ? ` (${md(nd.group)})` : "", nd.note ? ` — ${s(nd.note)}` : ""].join("");
      return make("list", {
        items: [
          ...edges.map((e) => `${name(e.from)} ${arrow}${e.label ? ` ${md(e.label)} ${arrow}` : ""} ${name(e.to)}`),
          ...nodes.filter((nd) => !linked.has(s(nd.id))).map((nd) => `${name(nd.id)}${detail(nd)}`),
        ],
      });
    }
    default:
      return n;
  }
}

function walkLower(n: ResolvedNode, keep: (type: string) => boolean): ResolvedNode {
  const low = LOWERED.has(n.type) && !keep(n.type) ? lowerNode(n) : n;
  return { ...low, children: low.children.map((c) => walkLower(c, keep)) };
}

/** The surface with every rich component a target does not draw itself lowered. */
export function lowerSurface(surface: ResolvedSurface, keep: (type: string) => boolean = () => false): ResolvedSurface {
  return surface.root ? { ...surface, root: walkLower(surface.root, keep) } : surface;
}
