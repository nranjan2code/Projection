// Dependency-free SVG charts: bar (grouped), line, area, pie (donut).
// Colors come from CSS custom properties so themes apply.

const NS = "http://www.w3.org/2000/svg";

export interface ChartSpec {
  kind: "bar" | "line" | "area" | "pie";
  labels: string[];
  series: { name?: string; values: number[] }[];
}

function svgEl<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function titled<T extends SVGElement>(doc: Document, el: T, text: string): T {
  const t = svgEl(doc, "title");
  t.textContent = text;
  el.append(t);
  return el;
}

const color = (i: number) => `var(--vak-series-${(i % 6) + 1})`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  return String(+v.toFixed(2));
}

export function normalizeChart(props: Record<string, unknown>): ChartSpec {
  const kind = (["bar", "line", "area", "pie"].includes(String(props.kind)) ? props.kind : "bar") as ChartSpec["kind"];
  const rawSeries = Array.isArray(props.series) ? props.series : [];
  const series = rawSeries
    .map((s) => {
      if (Array.isArray(s)) return { values: s.map(Number) };
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        const vals = Array.isArray(o.values) ? o.values : Array.isArray(o.data) ? o.data : [];
        return { name: typeof o.name === "string" ? o.name : undefined, values: vals.map(Number) };
      }
      return { values: [Number(s)] };
    })
    .filter((s) => s.values.length)
    .map((s) => ({ ...s, values: s.values.map((v) => (Number.isFinite(v) ? v : 0)) }));
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const labels = Array.isArray(props.labels) ? props.labels.map(String) : [];
  while (labels.length < n) labels.push(String(labels.length + 1));
  return { kind, labels: labels.slice(0, n), series };
}

/** `width`: actual pixel width, so text and strokes stay crisp at any size. */
export function renderChart(spec: ChartSpec, doc: Document = document, width = 640): HTMLElement {
  const wrap = doc.createElement("figure");
  wrap.className = "chart";
  if (!spec.series.length) {
    wrap.textContent = "No data";
    return wrap;
  }
  if (spec.kind === "pie") wrap.append(pie(spec, doc));
  else wrap.append(cartesian(spec, doc, width));

  const names = spec.kind === "pie" ? spec.labels : spec.series.map((s, i) => s.name ?? `Series ${i + 1}`);
  if (names.length > 1) {
    const legend = doc.createElement("figcaption");
    legend.className = "legend";
    names.forEach((name, i) => {
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

function cartesian(spec: ChartSpec, doc: Document, width: number): SVGSVGElement {
  const W = Math.max(200, Math.round(width)), H = Math.round(Math.min(320, Math.max(180, W * 0.5))), L = 44, R = 12, T = 12, B = 34;
  const svg = svgEl(doc, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", width: W, height: H });
  const all = spec.series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = niceMax(Math.max(...all, 0));
  const span = max - min || 1;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / span);
  const n = spec.labels.length;
  const band = (W - L - R) / Math.max(n, 1);

  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    const yy = y(v);
    svg.append(svgEl(doc, "line", { x1: L, x2: W - R, y1: yy, y2: yy, class: "gridline" }));
    const t = svgEl(doc, "text", { x: L - 6, y: yy + 4, "text-anchor": "end", class: "axis" });
    t.textContent = fmt(v);
    svg.append(t);
  }
  const step = Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 70)));
  spec.labels.forEach((label, i) => {
    if (i % step) return;
    const t = svgEl(doc, "text", { x: L + band * (i + 0.5), y: H - 12, "text-anchor": "middle", class: "axis" });
    t.textContent = label.length > 12 ? `${label.slice(0, 11)}…` : label;
    svg.append(t);
  });

  if (spec.kind === "bar") {
    const groups = spec.series.length;
    const inner = band * 0.72;
    const bw = inner / groups;
    spec.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = L + band * i + (band - inner) / 2 + bw * si;
        const y0 = y(Math.max(v, 0));
        const h = Math.abs(y(v) - y(0));
        svg.append(titled(doc, svgEl(doc, "rect", { x: x + 1, y: y0, width: Math.max(bw - 2, 1), height: Math.max(h, 0.5), rx: 3, fill: color(si) }), `${s.name ? `${s.name} · ` : ""}${spec.labels[i]}: ${v}`));
      });
    });
  } else {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [L + band * (i + 0.5), y(v)] as const);
      const d = pts.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)}`).join("");
      if (spec.kind === "area" && pts.length) {
        const base = y(Math.max(min, 0));
        svg.append(svgEl(doc, "path", { d: `${d}L${pts[pts.length - 1]![0]},${base}L${pts[0]![0]},${base}Z`, fill: color(si), "fill-opacity": 0.18 }));
      }
      svg.append(svgEl(doc, "path", { d, fill: "none", stroke: color(si), "stroke-width": 2.5, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
      pts.forEach(([x, yy], i) => svg.append(titled(doc, svgEl(doc, "circle", { cx: x, cy: yy, r: 3.5, fill: color(si) }), `${s.name ? `${s.name} · ` : ""}${spec.labels[i]}: ${s.values[i]}`)));
    });
  }
  return svg;
}

function pie(spec: ChartSpec, doc: Document): SVGSVGElement {
  const svg = svgEl(doc, "svg", { viewBox: "0 0 200 200", role: "img", class: "pie" });
  const values = spec.series[0]!.values.map((v) => Math.max(v, 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const a = (v / total) * Math.PI * 2;
    const large = a > Math.PI ? 1 : 0;
    const p = (r: number, t: number) => `${100 + r * Math.cos(t)},${100 + r * Math.sin(t)}`;
    const d = a >= Math.PI * 2 - 1e-6
      ? `M100,10A90,90 0 1 1 99.99,10ZM100,48A52,52 0 1 0 100.01,48Z`
      : `M${p(90, angle)}A90,90 0 ${large} 1 ${p(90, angle + a)}L${p(52, angle + a)}A52,52 0 ${large} 0 ${p(52, angle)}Z`;
    svg.append(titled(doc, svgEl(doc, "path", { d, fill: color(i), "fill-rule": "evenodd" }), `${spec.labels[i]}: ${v} (${Math.round((v / total) * 100)}%)`));
    angle += a;
  });
  return svg;
}
