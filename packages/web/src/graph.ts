// Dependency-free SVG node-link graphs. A directed graph without cycles is
// drawn in layers (org charts, dependencies, flows read top-down); any other
// graph gets a deterministic force layout, so the same props always draw the
// same picture. Colors come from CSS custom properties so themes apply.

const NS = "http://www.w3.org/2000/svg";

export interface GraphSpec {
  nodes: { id: string; label: string; group?: string; note?: string }[];
  edges: { from: string; to: string; label?: string }[];
  directed: boolean;
}

interface Placed {
  x: number;
  y: number;
  w: number;
}

const NODE_H = 34;
const CHAR_W = 7.2;
const MAX_LABEL = 26;

function svgEl<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const color = (i: number) => `var(--vak-series-${(i % 6) + 1}, var(--_vak-series-${(i % 6) + 1}))`;
const clip = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function normalizeGraph(props: Record<string, unknown>): GraphSpec {
  const nodes = (Array.isArray(props.nodes) ? props.nodes : [])
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n) => ({ id: str(n.id), label: str(n.label) || str(n.id), group: str(n.group) || undefined, note: str(n.note) || undefined }))
    .filter((n) => n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(props.edges) ? props.edges : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({ from: str(e.from), to: str(e.to), label: str(e.label) || undefined }))
    .filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges, directed: props.directed !== false };
}

/** Longest-path layers when the directed graph has no cycle; undefined otherwise. */
function layers(spec: GraphSpec): string[][] | undefined {
  if (!spec.directed || !spec.edges.length) return undefined;
  const indeg = new Map(spec.nodes.map((n) => [n.id, 0]));
  for (const e of spec.edges) if (e.from !== e.to) indeg.set(e.to, indeg.get(e.to)! + 1);
  const depth = new Map<string, number>();
  const queue = spec.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const e of spec.edges) {
      if (e.from !== id || e.from === e.to) continue;
      depth.set(e.to, Math.max(depth.get(e.to) ?? 0, depth.get(id)! + 1));
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  if (queue.length < spec.nodes.length) return undefined;
  const rows: string[][] = [];
  for (const n of spec.nodes) (rows[depth.get(n.id)!] ??= []).push(n.id);
  // A few barycenter sweeps so edges between layers cross less.
  const pos = new Map<string, number>();
  const index = () => rows.forEach((r) => r.forEach((id, i) => pos.set(id, i / Math.max(r.length - 1, 1))));
  index();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const row of rows.slice(1)) {
      const bary = (id: string) => {
        const ps = spec.edges.filter((e) => e.to === id && depth.get(e.from)! < depth.get(id)!).map((e) => pos.get(e.from)!);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(id)!;
      };
      const keyed = new Map(row.map((id) => [id, bary(id)]));
      row.sort((a, b) => keyed.get(a)! - keyed.get(b)!);
      index();
    }
  }
  return rows;
}

function widthOf(label: string): number {
  return Math.max(56, Math.round(clip(label).length * CHAR_W + 24));
}

/** Layers top-down ("tb") or left-to-right ("lr"); the renderer picks the one that fits its frame. */
function layered(spec: GraphSpec, rows: string[][], dir: "tb" | "lr"): Map<string, Placed> {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Placed>();
  if (dir === "lr") {
    let x = 0;
    for (const r of rows) {
      const colW = Math.max(...r.map((id) => widthOf(byId.get(id)!.label)));
      const top = -((r.length - 1) * (NODE_H + 18)) / 2;
      r.forEach((id, i) => out.set(id, { x: x + colW / 2, y: top + i * (NODE_H + 18), w: widthOf(byId.get(id)!.label) }));
      x += colW + 70;
    }
    return out;
  }
  const rowWidth = (r: string[]) => r.reduce((a, id) => a + widthOf(byId.get(id)!.label), 0) + (r.length - 1) * 28;
  const widest = Math.max(...rows.map(rowWidth));
  rows.forEach((r, depth) => {
    let x = (widest - rowWidth(r)) / 2;
    for (const id of r) {
      const w = widthOf(byId.get(id)!.label);
      out.set(id, { x: x + w / 2, y: depth * (NODE_H + 62) + NODE_H / 2, w });
      x += w + 28;
    }
  });
  return out;
}

/** Fruchterman–Reingold from a circle start: deterministic, no randomness. */
function forced(spec: GraphSpec): Map<string, Placed> {
  const n = spec.nodes.length;
  // Ideal edge length from the boxes' size, so labels between nodes have room.
  const k = Math.max(150, spec.nodes.reduce((a, nd) => a + widthOf(nd.label), 0) / Math.max(n, 1) + 90);
  const p = spec.nodes.map((nd, i) => {
    const a = (2 * Math.PI * i) / Math.max(n, 1);
    const r = n > 1 ? k * Math.sqrt(n) * 0.6 : 0;
    return { x: r * Math.cos(a), y: r * Math.sin(a), w: widthOf(nd.label) };
  });
  const at = new Map(spec.nodes.map((nd, i) => [nd.id, i]));
  let temp = k * 1.5;
  for (let it = 0; it < 300 && n > 1; it++) {
    const dx = new Float64Array(n), dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const x = p[i]!.x - p[j]!.x, y = p[i]!.y - p[j]!.y;
        const d = Math.max(Math.hypot(x, y), 1);
        const f = (k * k) / d;
        dx[i]! += (x / d) * f; dy[i]! += (y / d) * f;
        dx[j]! -= (x / d) * f; dy[j]! -= (y / d) * f;
      }
    }
    for (const e of spec.edges) {
      const i = at.get(e.from)!, j = at.get(e.to)!;
      if (i === j) continue;
      const x = p[i]!.x - p[j]!.x, y = p[i]!.y - p[j]!.y;
      const d = Math.max(Math.hypot(x, y), 1);
      const f = (d * d) / k;
      dx[i]! -= (x / d) * f; dy[i]! -= (y / d) * f;
      dx[j]! += (x / d) * f; dy[j]! += (y / d) * f;
    }
    for (let i = 0; i < n; i++) {
      // A weak pull to the center keeps unconnected nodes from drifting off.
      dx[i]! -= p[i]!.x * 0.02 * k; dy[i]! -= p[i]!.y * 0.02 * k;
      const d = Math.max(Math.hypot(dx[i]!, dy[i]!), 1e-9);
      p[i]!.x += (dx[i]! / d) * Math.min(d, temp);
      p[i]!.y += (dy[i]! / d) * Math.min(d, temp);
    }
    temp = Math.max(temp * 0.98, 2);
  }
  return new Map(spec.nodes.map((nd, i) => [nd.id, p[i]!]));
}

/** Where the segment from a node's center toward (tx, ty) leaves its box. */
function boxEdge(c: Placed, tx: number, ty: number): [number, number] {
  const dx = tx - c.x, dy = ty - c.y;
  if (!dx && !dy) return [c.x, c.y];
  const s = Math.min(Math.abs((c.w / 2 + 3) / (dx || 1e-9)), Math.abs((NODE_H / 2 + 3) / (dy || 1e-9)));
  return [c.x + dx * s, c.y + dy * s];
}

function bounds(pos: Map<string, Placed>) {
  const ps = [...pos.values()];
  const x0 = Math.min(...ps.map((p) => p.x - p.w / 2)), x1 = Math.max(...ps.map((p) => p.x + p.w / 2));
  const y0 = Math.min(...ps.map((p) => p.y)) - NODE_H / 2, y1 = Math.max(...ps.map((p) => p.y)) + NODE_H / 2;
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

let seq = 0;
const PAD = 28;

/**
 * An interactive view: drag to pan, pinch (touch, trackpad, WebKit gesture
 * events) or Ctrl/⌘-scroll to zoom, buttons and keys for the same, nodes can
 * be dragged, and selecting one shows its note and dims what it does not
 * touch. Plain scrolling is left to the page so a graph never traps it. The
 * view refits as its frame resizes until the user moves it, and a layered
 * graph turns to whichever direction fits the frame (top-down when narrow).
 */
export function renderGraph(spec: GraphSpec, doc: Document = document): HTMLElement {
  const wrap = doc.createElement("figure");
  wrap.className = "graph";
  if (!spec.nodes.length) {
    wrap.textContent = "No data";
    return wrap;
  }
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const rows = layers(spec);
  let dir: "tb" | "lr" = "tb";
  let pos = rows ? layered(spec, rows, dir) : forced(spec);
  let moved = false, interacted = false, selected: string | undefined;
  const view = { cx: 0, cy: 0, k: 1 };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const tools = el("div", "graph-tools");
  const button = (text: string, label: string, run: () => void) => {
    const b = el("button", "graph-btn", text);
    b.type = "button";
    b.title = b.ariaLabel = label;
    b.addEventListener("click", run);
    tools.append(b);
  };
  const frame = el("div", "graph-frame");
  frame.tabIndex = 0;
  frame.title = "Drag to pan · pinch or Ctrl/⌘-scroll to zoom · drag a node to move it";
  const svg = svgEl(doc, "svg", { role: "group", "aria-label": `Graph of ${spec.nodes.length} ${spec.nodes.length === 1 ? "node" : "nodes"} and ${spec.edges.length} ${spec.edges.length === 1 ? "connection" : "connections"}` });
  const marker = `vak-arrow-${++seq}`;
  if (spec.directed) {
    const defs = svgEl(doc, "defs");
    const m = svgEl(doc, "marker", { id: marker, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    m.append(svgEl(doc, "path", { d: "M0,0L10,5L0,10Z", class: "graph-arrow" }));
    defs.append(m);
    svg.append(defs);
  }
  const edgeLayer = svgEl(doc, "g"), labelLayer = svgEl(doc, "g"), nodeLayer = svgEl(doc, "g");
  svg.append(edgeLayer, labelLayer, nodeLayer);
  frame.append(svg);
  const detail = el("figcaption", "graph-detail");
  detail.hidden = true;
  const groups = [...new Set(spec.nodes.map((n) => n.group).filter((g): g is string => !!g))];

  const edgeEls: SVGPathElement[] = [];
  const drawEdges = () => {
    edgeLayer.replaceChildren();
    labelLayer.replaceChildren();
    edgeEls.length = 0;
    // Parallel edges between the same pair bend apart so each label stays readable.
    const pairCount = new Map<string, number>();
    for (const e of spec.edges) {
      const a = pos.get(e.from)!, b = pos.get(e.to)!;
      let d: string, lx: number, ly: number;
      if (e.from === e.to) {
        const top = a.y - NODE_H / 2;
        d = `M${a.x - 10},${top}C${a.x - 30},${top - 42} ${a.x + 30},${top - 42} ${a.x + 10},${top}`;
        lx = a.x; ly = top - 36;
      } else {
        const key = [e.from, e.to].sort().join("\u0000");
        const nth = pairCount.get(key) ?? 0;
        pairCount.set(key, nth + 1);
        const bend = nth === 0 ? 0 : (nth % 2 ? 1 : -1) * Math.ceil(nth / 2) * 26;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
        const cx = mx - ((b.y - a.y) / len) * bend, cy = my + ((b.x - a.x) / len) * bend;
        const [sx, sy] = boxEdge(a, cx, cy), [tx, ty] = boxEdge(b, cx, cy);
        d = bend ? `M${sx},${sy}Q${cx},${cy} ${tx},${ty}` : `M${sx},${sy}L${tx},${ty}`;
        lx = bend ? (sx + 2 * cx + tx) / 4 : mx;
        ly = bend ? (sy + 2 * cy + ty) / 4 : my;
      }
      const path = svgEl(doc, "path", { d, class: "graph-edge", fill: "none", ...(spec.directed ? { "marker-end": `url(#${marker})` } : {}) });
      const t = svgEl(doc, "title");
      const arrow = spec.directed ? "→" : "—";
      t.textContent = `${byId.get(e.from)!.label} ${arrow} ${e.label ? `${e.label} ${arrow} ` : ""}${byId.get(e.to)!.label}`;
      path.append(t);
      edgeLayer.append(path);
      edgeEls.push(path);
      if (e.label) {
        const text = svgEl(doc, "text", { x: lx, y: ly + 4, "text-anchor": "middle", class: "graph-edge-label" });
        text.textContent = clip(e.label);
        labelLayer.append(text);
      }
    }
    mark();
  };

  const nodeEls = new Map<string, SVGGElement>();
  for (const n of spec.nodes) {
    const g = svgEl(doc, "g", { class: "graph-node", tabindex: 0, role: "button", "data-id": n.id, "aria-label": [n.label, n.group, n.note].filter(Boolean).join(", ") });
    const gi = n.group ? groups.indexOf(n.group) : -1;
    const w = widthOf(n.label);
    g.append(svgEl(doc, "rect", { x: -w / 2, y: -NODE_H / 2, width: w, height: NODE_H, rx: 9, ...(gi >= 0 ? { style: `--node: ${color(gi)}` } : {}) }));
    const text = svgEl(doc, "text", { y: 4.5, "text-anchor": "middle" });
    text.textContent = clip(n.label);
    const t = svgEl(doc, "title");
    t.textContent = [n.label, n.group && `(${n.group})`, n.note].filter(Boolean).join(" ");
    g.append(text, t);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        select(selected === n.id ? undefined : n.id);
      }
    });
    nodeLayer.append(g);
    nodeEls.set(n.id, g);
  }
  const placeNodes = () => nodeEls.forEach((g, id) => g.setAttribute("transform", `translate(${pos.get(id)!.x},${pos.get(id)!.y})`));

  // Selection dims everything the selected node does not touch; a search highlights matches.
  let query = "";
  function mark() {
    const near = new Set(selected ? [selected] : []);
    spec.edges.forEach((e, i) => {
      const on = !selected || e.from === selected || e.to === selected;
      if (selected && on) near.add(e.from).add(e.to);
      edgeEls[i]?.classList.toggle("dim", !on);
    });
    nodeEls.forEach((g, id) => {
      g.classList.toggle("selected", id === selected);
      g.classList.toggle("dim", !!selected && !near.has(id));
      g.classList.toggle("match", !!query && byId.get(id)!.label.toLowerCase().includes(query));
    });
  }
  function select(id: string | undefined) {
    selected = id;
    mark();
    detail.hidden = !id;
    detail.replaceChildren();
    if (!id) return;
    const n = byId.get(id)!;
    const linked = spec.edges.filter((e) => e.from === id || e.to === id).length;
    const b = doc.createElement("b");
    b.textContent = n.label;
    detail.append(b, doc.createTextNode([n.group ? ` · ${n.group}` : "", ` · ${linked} ${linked === 1 ? "connection" : "connections"}`, n.note ? ` — ${n.note}` : ""].join("")));
  }

  const size = () => ({ w: frame.clientWidth, h: frame.clientHeight });
  const apply = () => {
    const { w, h } = size();
    if (!w || !h) return;
    svg.setAttribute("viewBox", `${(view.cx - w / 2 / view.k).toFixed(1)} ${(view.cy - h / 2 / view.k).toFixed(1)} ${(w / view.k).toFixed(1)} ${(h / view.k).toFixed(1)}`);
  };
  const fit = () => {
    const { w, h } = size();
    if (!w || !h) return;
    const b = bounds(pos);
    // Never enlarge past 1.25×: a lone node should not fill the frame.
    view.k = Math.min((w - PAD * 2) / Math.max(b.w, 1), (h - PAD * 2) / Math.max(b.h, 1), 1.25);
    view.cx = b.x0 + b.w / 2;
    view.cy = b.y0 + b.h / 2;
    interacted = false;
    apply();
  };
  // The natural height in the chosen direction, within the frame's bounds (CSS clamps it).
  const sizeFrame = () => frame.style.setProperty("--graph-h", `${Math.round(bounds(pos).h + PAD * 2)}px`);
  /** A layered graph turns to whichever direction leaves its nodes larger in this frame. */
  const orient = () => {
    if (!rows || moved) return;
    const { w, h } = size();
    if (!w) return;
    const scale = (p: Map<string, Placed>) => { const b = bounds(p); return Math.min(w / b.w, Math.max(h, 320) / b.h); };
    const tb = layered(spec, rows, "tb"), lr = layered(spec, rows, "lr");
    const next = scale(lr) > scale(tb) * 1.15 ? "lr" : "tb";
    if (next === dir && pos.size) return;
    dir = next;
    pos = next === "lr" ? lr : tb;
    sizeFrame();
    placeNodes();
    drawEdges();
  };
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const r = frame.getBoundingClientRect();
    const px = clientX === undefined ? r.width / 2 : clientX - r.left, py = clientY === undefined ? r.height / 2 : clientY - r.top;
    const lx = view.cx + (px - r.width / 2) / view.k, ly = view.cy + (py - r.height / 2) / view.k;
    view.k = Math.min(4, Math.max(0.1, view.k * factor));
    view.cx = lx - (px - r.width / 2) / view.k;
    view.cy = ly - (py - r.height / 2) / view.k;
    interacted = true;
    apply();
  };
  const pan = (dx: number, dy: number) => {
    view.cx -= dx / view.k;
    view.cy -= dy / view.k;
    interacted = true;
    apply();
  };

  button("−", "Zoom out", () => zoomAt(1 / 1.25));
  button("+", "Zoom in", () => zoomAt(1.25));
  button("Fit", "Fit to view", fit);
  if (spec.nodes.length >= 12) {
    const find = el("input", "graph-find");
    find.type = "search";
    find.placeholder = `Find in ${spec.nodes.length} nodes`;
    find.ariaLabel = "Find a node";
    find.addEventListener("input", () => {
      query = find.value.trim().toLowerCase();
      mark();
      const hit = query && spec.nodes.find((n) => n.label.toLowerCase().includes(query));
      if (hit) {
        view.cx = pos.get(hit.id)!.x;
        view.cy = pos.get(hit.id)!.y;
        interacted = true;
        apply();
      }
    });
    tools.prepend(find);
  }

  frame.addEventListener("wheel", (ev) => {
    // Trackpad pinch arrives as Ctrl+wheel in Chromium and Firefox.
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    zoomAt(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
  }, { passive: false });
  // WebKit (Safari, the app window) reports trackpad pinch only as gesture events.
  let gestureScale = 1;
  frame.addEventListener("gesturestart", (ev) => { ev.preventDefault(); gestureScale = 1; });
  frame.addEventListener("gesturechange", (ev) => {
    ev.preventDefault();
    const e = ev as unknown as { scale: number; clientX: number; clientY: number };
    zoomAt(e.scale / gestureScale, e.clientX, e.clientY);
    gestureScale = e.scale;
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let dragNode: string | undefined, travel = 0, pinch: { d: number; x: number; y: number } | undefined;
  const pinchOf = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  };
  frame.addEventListener("pointerdown", (ev) => {
    if ((ev.target as Element).closest(".graph-tools")) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    // Capture keeps a drag going outside the frame; a pointer that is already gone cannot be captured.
    try { frame.setPointerCapture(ev.pointerId); } catch { /* the drag still works inside the frame */ }
    if (pointers.size === 1) {
      travel = 0;
      dragNode = (ev.target as Element).closest?.(".graph-node")?.getAttribute("data-id") ?? undefined;
    } else {
      dragNode = undefined;
      travel = Infinity;
      pinch = pinchOf();
    }
  });
  frame.addEventListener("pointermove", (ev) => {
    const last = pointers.get(ev.pointerId);
    if (!last) return;
    const dx = ev.clientX - last.x, dy = ev.clientY - last.y;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2 && pinch) {
      const now = pinchOf();
      pan(now.x - pinch.x, now.y - pinch.y);
      if (pinch.d) zoomAt(now.d / pinch.d, now.x, now.y);
      pinch = now;
      return;
    }
    travel += Math.abs(dx) + Math.abs(dy);
    if (travel < 4) return;
    frame.classList.add("dragging");
    if (dragNode) {
      const p = pos.get(dragNode)!;
      p.x += dx / view.k;
      p.y += dy / view.k;
      moved = true;
      placeNodes();
      drawEdges();
    } else pan(dx, dy);
  });
  const release = (ev: PointerEvent) => {
    if (!pointers.delete(ev.pointerId)) return;
    if (pointers.size < 2) pinch = undefined;
    if (pointers.size) return;
    frame.classList.remove("dragging");
    // A press that did not move is a click: a node toggles its selection, the background clears it.
    if (travel < 4) select(dragNode && dragNode !== selected ? dragNode : undefined);
    dragNode = undefined;
  };
  frame.addEventListener("pointerup", release);
  frame.addEventListener("pointercancel", release);
  frame.addEventListener("dblclick", (ev) => {
    if (!(ev.target as Element).closest(".graph-node")) zoomAt(1.6, ev.clientX, ev.clientY);
  });
  frame.addEventListener("keydown", (ev) => {
    if (ev.target !== frame && !(ev.target as Element).closest?.(".graph-node")) return;
    const step = 48;
    const keys: Record<string, () => void> = {
      "+": () => zoomAt(1.25), "=": () => zoomAt(1.25), "-": () => zoomAt(1 / 1.25), "0": fit,
      ArrowLeft: () => pan(step, 0), ArrowRight: () => pan(-step, 0), ArrowUp: () => pan(0, step), ArrowDown: () => pan(0, -step),
      Escape: () => select(undefined),
    };
    const run = keys[ev.key];
    if (!run) return;
    ev.preventDefault();
    run();
  });

  sizeFrame();
  placeNodes();
  drawEdges();
  // Refit as the frame changes size (split canvas, full screen, rotation) until the user takes over.
  const RO = (doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
  if (RO) {
    new RO(() => {
      orient();
      if (interacted) apply();
      else fit();
    }).observe(frame);
  }

  wrap.append(tools, frame, detail);
  if (groups.length > 1) {
    const legend = el("div", "legend");
    groups.forEach((name, i) => {
      const item = doc.createElement("span");
      const sw = doc.createElement("i");
      sw.style.background = color(i);
      item.append(sw, doc.createTextNode(name));
      legend.append(item);
    });
    wrap.append(legend);
  }
  return wrap;
}
