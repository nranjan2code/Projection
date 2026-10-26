// Lowering: richer components written as the basic ones every projector
// already draws. The web renders timeline, steps, code, map, gallery, graph and
// the everyday components (calendar, board, progress, accordion, compare, timer,
// tree, math, diff, gantt) natively; chat platforms and plain text get them here, so a new component
// never shows up as nothing on a target that predates it.

import type { ResolvedNode, ResolvedSurface } from "./surface.ts";

export const LOWERED = new Set(["timeline", "steps", "code", "map", "gallery", "graph", "calendar", "board", "progress", "accordion", "compare", "timer", "tree", "math", "diff", "gantt"]);

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

const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-11-02" → "Mon 2 Nov 2026", in UTC so the day never shifts. */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}
/** 125 → "2:05", 3725 → "1:02:05". */
export function clockText(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
/** A text bar for targets without graphics: ▓▓▓▓░░░░░░. */
const bar = (f: number, n = 10) => "▓".repeat(Math.round(Math.max(0, Math.min(1, f)) * n)).padEnd(n, "░");

/** Outline lines for a tree: nested markdown bullets. */
function outline(items: Record<string, unknown>[], depth = 0): string[] {
  return items.flatMap((it) => [`${"  ".repeat(depth)}- ${md(it.label)}${it.note ? ` — ${s(it.note)}` : ""}`, ...outline(list(it.children), depth + 1)]);
}

/** Unified diff lines from before/after texts (LCS on lines; small inputs only). */
export function diffLines(before: string, after: string): { op: " " | "-" | "+"; text: string }[] {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 4e6) return [...a.map((text) => ({ op: "-" as const, text })), ...b.map((text) => ({ op: "+" as const, text }))];
  const L = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: { op: " " | "-" | "+"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ op: " ", text: a[i++]! }), j++;
    else if (i < a.length && (j === b.length || L[i + 1]![j]! >= L[i]![j + 1]!)) out.push({ op: "-", text: a[i++]! });
    else out.push({ op: "+", text: b[j++]! });
  }
  return out;
}

/** A diff node's lines: its unified diff text, or computed from before/after. */
export function diffOf(p: Record<string, unknown>): { op: " " | "-" | "+" | "@"; text: string }[] {
  if (typeof p.diff === "string" && p.diff.trim()) {
    return p.diff.split("\n").filter((l) => !/^(---|\+\+\+|diff |index )/.test(l)).map((l) => ({ op: (l.startsWith("@@") ? "@" : l[0] === "+" || l[0] === "-" ? l[0] : " ") as " " | "-" | "+" | "@", text: l.startsWith("@@") ? l : l.slice(l[0] === "+" || l[0] === "-" || l[0] === " " ? 1 : 0) }));
  }
  return diffLines(s(p.before), s(p.after));
}

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
    case "calendar": {
      // One line per event, grouped by day in date order.
      return make("list", {
        items: list(p.events).map((e) => `**${e.date ? dayLabel(s(e.date)) : md(e.when) || "Unscheduled"}**${e.start ? ` ${s(e.start)}${e.end ? `–${s(e.end)}` : ""}` : ""} · ${md(e.title)}${e.note ? ` — ${s(e.note)}` : ""}`),
      });
    }
    case "board": {
      const cards = list(Array.isArray(p.value) ? p.value : p.cards);
      return make("stack", {}, list(p.columns).map((c, i) => ({
        ...n, key: `${n.key}/${i}`, id: `${n.id}-${i}`, type: "list", children: [],
        props: { items: [`**${md(c.title)}** (${cards.filter((k) => k.column === c.id).length})`, ...cards.filter((k) => k.column === c.id).map((k) => `• ${md(k.title)}${k.tag ? ` [${md(k.tag)}]` : ""}${k.note ? ` — ${s(k.note)}` : ""}`)] },
      })));
    }
    case "progress": {
      const v = Number(p.value) || 0, max = Number(p.max) || 100;
      const unit = s(p.unit);
      const amount = (x: number) => (unit.length === 1 && !/[%a-z]/i.test(unit) ? `${unit}${x}` : `${x}${unit ? ` ${unit}` : ""}`);
      const shown = p.kind === "rating" ? `${"★".repeat(Math.round(v))}${"☆".repeat(Math.max(0, Math.round(max) - Math.round(v)))} ${v}/${max}` : `${bar(v / max)} ${amount(v)} of ${amount(max)} (${Math.round((v / max) * 100)}%)`;
      return make("text", { content: `${p.label ? `**${md(p.label)}**: ` : ""}${shown}${p.note ? ` — ${s(p.note)}` : ""}` });
    }
    case "accordion": {
      // Every panel open: a chat message cannot collapse.
      const panels = list(p.items).map((it, i): ResolvedNode => ({ ...n, key: `${n.key}/${i}`, id: `${n.id}-${i}`, type: "section", props: { title: s(it.title), ...(it.body ? { description: s(it.body) } : {}) }, children: [] }));
      return make("stack", {}, [...panels, ...n.children]);
    }
    case "compare": {
      const opts = list(p.options);
      const specKeys = [...new Set(opts.flatMap((o) => Object.keys((o.specs as object) ?? {})))];
      const sections = opts.map((o, i): ResolvedNode => ({
        ...n, key: `${n.key}/${i}`, id: `${n.id}-${i}`, type: "section", children: [],
        props: {
          title: `${o.best ? "★ " : ""}${s(o.name)}${o.price ? ` — ${s(o.price)}` : ""}${o.best ? " (best pick)" : ""}`,
          description: [...(o.pros as string[] ?? []).map((x) => `✓ ${x}`), ...(o.cons as string[] ?? []).map((x) => `✗ ${x}`), ...(o.note ? [s(o.note)] : [])].join("\n\n"),
        },
      }));
      const table: ResolvedNode[] = specKeys.length
        ? [{ ...n, key: `${n.key}/specs`, id: `${n.id}-specs`, type: "table", children: [], props: { columns: [{ key: "k", label: "" }, ...opts.map((o, i) => ({ key: `o${i}`, label: `${o.best ? "★ " : ""}${s(o.name)}` }))], rows: specKeys.map((k) => ({ k, ...Object.fromEntries(opts.map((o, i) => [`o${i}`, s((o.specs as Record<string, unknown> | undefined)?.[k])])) })) } }]
        : [];
      return make("stack", {}, [...table, ...sections]);
    }
    case "timer": {
      const label = p.label ? `**${md(p.label)}**: ` : "";
      if (p.until) return make("text", { content: `⏳ ${label}until ${s(p.until).replace("T", " ")}` });
      return make("text", { content: `⏱ ${label}${p.duration ? clockText(Number(p.duration)) : "stopwatch"}` });
    }
    case "tree":
      return make("text", { content: outline(list(p.items)).join("\n") });
    case "math":
      return make("text", { content: `${p.display === false ? `\`${s(p.tex)}\`` : `\`\`\`tex\n${s(p.tex)}\n\`\`\``}${p.caption ? `\n\n${s(p.caption)}` : ""}` });
    case "diff": {
      const lines = diffOf(p).map((l) => (l.op === "@" ? l.text : `${l.op}${l.text}`)).join("\n");
      const fence = lines.includes("```") ? "~~~" : "```";
      return make("text", { content: `${p.title ? `**${md(p.title)}**\n\n` : ""}${fence}diff\n${lines}\n${fence}` });
    }
    case "gantt":
      return make("table", {
        columns: [{ key: "task", label: "Task" }, { key: "start", label: "Start" }, { key: "end", label: "End" }, { key: "done", label: "Done", align: "end" }],
        rows: list(p.tasks).map((t) => ({ task: `${t.group ? `${s(t.group)}: ` : ""}${s(t.title)}`, start: s(t.start), end: s(t.end), done: t.progress !== undefined ? `${Math.round(Number(t.progress))}%` : "" })),
      });
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
