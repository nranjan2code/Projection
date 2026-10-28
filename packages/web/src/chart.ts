// Dependency-free SVG charts: bar (grouped or stacked), line, area, pie (donut),
// scatter, heatmap (a habit calendar for dated values, else a matrix) and radar.
// Colors come from CSS custom properties so themes apply.

const NS = "http://www.w3.org/2000/svg";

export interface ChartSpec {
  kind: "bar" | "stacked" | "line" | "area" | "pie" | "scatter" | "heatmap" | "radar" | "candlestick";
  title?: string;
  orientation?: "vertical" | "horizontal";
  yScale?: "auto" | "zero";
  colorBy?: "series" | "sign";
  height?: "sm" | "md" | "lg";
  xLabel?: string; yLabel?: string;
  labels: string[];
  series: { name?: string; values: number[]; x?: number[] }[];
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

const color = (i: number) => `var(--vak-series-${(i % 6) + 1}, var(--_vak-series-${(i % 6) + 1}))`;

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
  const kind = (["bar", "stacked", "line", "area", "pie", "scatter", "heatmap", "radar", "candlestick"].includes(String(props.kind)) ? props.kind : "bar") as ChartSpec["kind"];
  const rawSeries = Array.isArray(props.series) ? props.series : [];
  const series = rawSeries
    .map((s) => {
      if (Array.isArray(s)) return { values: s.map(Number) };
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        const vals = Array.isArray(o.values) ? o.values : Array.isArray(o.data) ? o.data : [];
        const x = Array.isArray(o.x) ? o.x.map(Number) : undefined;
        return { name: typeof o.name === "string" ? o.name : undefined, values: vals.map(Number), ...(x ? { x } : {}) };
      }
      return { values: [Number(s)] };
    })
    .filter((s) => s.values.length)
    .map((s) => ({ ...s, values: s.values.map((v) => (Number.isFinite(v) ? v : 0)) }));
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const labels = Array.isArray(props.labels) ? props.labels.map(String) : [];
  while (labels.length < n) labels.push(String(labels.length + 1));
  return { kind, labels: labels.slice(0, n), series,
    ...(typeof props.title === "string" ? { title: props.title } : {}),
    ...(props.orientation === "horizontal" ? { orientation: "horizontal" as const } : {}),
    ...(props.yScale === "zero" ? { yScale: "zero" as const } : {}),
    ...(props.colorBy === "sign" ? { colorBy: "sign" as const } : {}),
    ...(["sm", "md", "lg"].includes(String(props.height)) ? { height: props.height as ChartSpec["height"] } : {}),
    ...(typeof props.xLabel === "string" ? { xLabel: props.xLabel } : {}),
    ...(typeof props.yLabel === "string" ? { yLabel: props.yLabel } : {}),
  };
}

/** `width`: actual pixel width, so text and strokes stay crisp at any size. */
export function renderChart(spec: ChartSpec, doc: Document = document, width = 640): HTMLElement {
  const wrap = doc.createElement("figure");
  wrap.className = "chart";
  if (spec.title) {
    const title = doc.createElement("figcaption"); title.className = "chart-heading";
    title.textContent = spec.title; wrap.append(title);
  }
  if (!spec.series.length) {
    const empty = doc.createElement("span"); empty.textContent = "No data"; wrap.append(empty);
    return wrap;
  }
  if (spec.kind === "bar" && spec.orientation === "horizontal") wrap.append(horizontalBars(spec, doc, width));
  else if (spec.kind === "pie") wrap.append(pie(spec, doc));
  else if (spec.kind === "scatter") wrap.append(scatter(spec, doc, width));
  else if (spec.kind === "heatmap") wrap.append(heatmap(spec, doc, width));
  else if (spec.kind === "radar") wrap.append(radar(spec, doc));
  else wrap.append(cartesian(spec, doc, width));

  const names = spec.kind === "heatmap" || spec.kind === "candlestick" ? [] : spec.kind === "pie" ? spec.labels : spec.series.map((s, i) => s.name ?? `Series ${i + 1}`);
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
  if ((spec.kind === "line" || spec.kind === "candlestick") && spec.yScale !== "zero") {
    const note = doc.createElement("div"); note.className = "scale-note";
    note.textContent = "Y-axis fits observed values; baseline may exclude zero."; wrap.append(note);
  }
  return wrap;
}

/** General quantitative scales: intervals/trends need detail, magnitude bars
 * need a zero reference. A flat series still gets a finite visible range. */
export function chartDomain(spec: ChartSpec): [number, number] {
  const all = spec.kind === "stacked"
    ? spec.labels.flatMap((_, i) => [spec.series.reduce((a,s) => a + Math.max(s.values[i] ?? 0,0),0), spec.series.reduce((a,s) => a + Math.min(s.values[i] ?? 0,0),0)])
    : spec.series.flatMap(s => s.values).filter(Number.isFinite);
  if (!all.length) return [0, 1];
  let low = Math.min(...all), high = Math.max(...all);
  const zero = spec.yScale === "zero" || !["line", "candlestick"].includes(spec.kind);
  if (zero) { low = Math.min(0, low); high = Math.max(0, high); }
  const padding = zero ? 0 : ((high - low) || Math.abs(high) * 0.02 || 1) * 0.08;
  const step = niceMax(((high - low + padding * 2) || 1) / 4);
  const min = Math.floor((low - padding) / step) * step;
  const max = Math.ceil((high + padding) / step) * step;
  return [min, max > min ? max : min + step];
}
const plotHeight = (spec: ChartSpec, width: number) => spec.height ? ({ sm: 180, md: 260, lg: 360 }[spec.height]) : Math.round(Math.min(320, Math.max(180, width * 0.5)));
const valueColor = (spec: ChartSpec, value: number, series: number) => spec.colorBy === "sign"
  ? value > 0 ? "var(--vak-success, var(--_vak-success))" : value < 0 ? "var(--vak-danger, var(--_vak-danger))" : "var(--vak-muted, var(--_vak-muted))"
  : color(series);

function horizontalBars(spec: ChartSpec, doc: Document, width: number): SVGSVGElement {
  const W = Math.max(200, Math.round(width)), L = Math.min(176, W * 0.4), R = 50, T = 24, B = 28;
  const H = Math.max(plotHeight(spec, W), spec.labels.length * Math.max(24, spec.series.length * 16) + T + B);
  const [min, max] = chartDomain(spec), x = (v: number) => L + (v - min) / (max - min) * (W - L - R);
  const svg = svgEl(doc, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", width: W, height: H, "aria-label": spec.title ?? "Horizontal bar chart" });
  const band = (H - T - B) / spec.labels.length;
  for (let i = 0; i <= 4; i++) {
    const v = min + (max-min)*i/4, px = x(v);
    svg.append(svgEl(doc,"line",{x1:px,x2:px,y1:T,y2:H-B,class:"gridline"}));
    const tick=svgEl(doc,"text",{x:px,y:H-8,"text-anchor":"middle",class:"axis"});tick.textContent=fmt(v);svg.append(tick);
  }
  svg.append(svgEl(doc,"line",{x1:x(0),x2:x(0),y1:T,y2:H-B,class:"zero-line"}));
  spec.labels.forEach((label,i)=>{
    const cy=T+band*(i+0.5), t=svgEl(doc,"text",{x:L-8,y:cy+4,"text-anchor":"end",class:"axis"});
    const limit=Math.max(6,Math.floor((L-12)/6.5)); t.textContent=label.length>limit?label.slice(0,limit-1)+"…":label; svg.append(titled(doc,t,label));
    spec.series.forEach((series,si)=>{
      const value=series.values[i];if(value===undefined)return;
      const h=Math.min(16,band*0.7/spec.series.length), top=cy-band*0.35+si*h;
      svg.append(titled(doc,svgEl(doc,"rect",{x:Math.min(x(0),x(value)),y:top,width:Math.max(0.5,Math.abs(x(value)-x(0))),height:h-1,rx:2,fill:valueColor(spec,value,si)}),`${label} · ${series.name??"Value"}: ${value}`));
      const val=svgEl(doc,"text",{x:W-2,y:top+h-3,"text-anchor":"end",class:"axis"});val.textContent=(spec.colorBy==="sign" && value>0?"+":"")+fmt(value);svg.append(val);
    });
  });
  return svg;
}

function cartesian(spec: ChartSpec, doc: Document, width: number): SVGSVGElement {
  const W = Math.max(200, Math.round(width)), H = plotHeight(spec, W), L = spec.yLabel ? 62 : 48, R = 16, T = 16, B = spec.xLabel ? 48 : 34;
  const svg = svgEl(doc, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", width: W, height: H });
  const [min, max] = chartDomain(spec);
  svg.setAttribute("aria-label", spec.title ?? `${spec.kind} chart`);
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

  if (spec.yLabel) {
    const label = svgEl(doc,"text",{x:12,y:T+(H-T-B)/2,transform:`rotate(-90 12 ${T+(H-T-B)/2})`,"text-anchor":"middle",class:"axis-label"}); label.textContent=spec.yLabel;svg.append(label);
  }
  if (spec.xLabel) {
    const label = svgEl(doc,"text",{x:L+(W-L-R)/2,y:H-2,"text-anchor":"middle",class:"axis-label"}); label.textContent=spec.xLabel;svg.append(label);
  }
  if (spec.kind === "candlestick") {
    if (spec.series.length !== 4 || spec.series.some(s=>s.values.length!==n)) {
      const error=svgEl(doc,"text",{x:L,y:24,class:"axis"});error.textContent="Invalid OHLC series";svg.append(error);return svg;
    }
    spec.labels.forEach((label,i)=>{
      const [open,high,low,close]=spec.series.map(s=>s.values[i]!);
      if (![open,high,low,close].every(Number.isFinite) || low!>Math.min(open!,close!) || high!<Math.max(open!,close!) || low!>high!) return;
      const x=L+band*(i+0.5), bw=Math.max(1,Math.min(18,band*0.65));
      const tone=close!>=open!?"var(--vak-success, var(--_vak-success))":"var(--vak-danger, var(--_vak-danger))";
      const mark=svgEl(doc,"g",{"aria-label":`${label}: open ${open}, high ${high}, low ${low}, close ${close}`});
      mark.append(svgEl(doc,"line",{x1:x,x2:x,y1:y(high!),y2:y(low!),stroke:tone,"stroke-width":1.25}));
      mark.append(svgEl(doc,"rect",{x:x-bw/2,y:y(Math.max(open!,close!)),width:bw,height:Math.max(1,Math.abs(y(open!)-y(close!))),fill:tone,stroke:tone}));
      svg.append(titled(doc,mark,`${label}: Open ${open} · High ${high} · Low ${low} · Close ${close}`));
    });
  } else if (spec.kind === "stacked") {
    const bw = band * 0.62;
    spec.labels.forEach((label, i) => {
      let up = 0, down = 0;
      spec.series.forEach((s, si) => {
        const v = s.values[i] ?? 0;
        const from = v >= 0 ? up : down;
        const to = from + v;
        if (v >= 0) up = to;
        else down = to;
        const top = y(Math.max(from, to)), h = Math.abs(y(from) - y(to));
        svg.append(titled(doc, svgEl(doc, "rect", { x: L + band * i + (band - bw) / 2, y: top, width: Math.max(bw, 1), height: Math.max(h, 0.5), fill: color(si), stroke: "var(--vak-surface, var(--_vak-surface))", "stroke-width": 1 }), `${s.name ? `${s.name} · ` : ""}${label}: ${v}`));
      });
    });
  } else if (spec.kind === "bar") {
    const groups = spec.series.length;
    const inner = band * 0.72;
    const bw = inner / groups;
    spec.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = L + band * i + (band - inner) / 2 + bw * si;
        const y0 = y(Math.max(v, 0));
        const h = Math.abs(y(v) - y(0));
        svg.append(titled(doc, svgEl(doc, "rect", { x: x + 1, y: y0, width: Math.max(bw - 2, 1), height: Math.max(h, 0.5), rx: 3, fill: valueColor(spec, v, si) }), `${s.name ? `${s.name} · ` : ""}${spec.labels[i]}: ${v}`));
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

/** Points on numeric x and y axes; x from each series' own x, numeric labels, or position. */
function scatter(spec: ChartSpec, doc: Document, width: number): SVGSVGElement {
  const W = Math.max(200, Math.round(width)), H = Math.round(Math.min(320, Math.max(180, W * 0.55))), L = 44, R = 14, T = 12, B = 30;
  const svg = svgEl(doc, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", width: W, height: H });
  const xs = (s: ChartSpec["series"][number]) => s.values.map((_, i) => s.x?.[i] ?? (Number.isFinite(Number(spec.labels[i])) ? Number(spec.labels[i]) : i + 1));
  const allX = spec.series.flatMap(xs), allY = spec.series.flatMap((s) => s.values);
  // Axes on round steps (1, 2 or 5 × 10ⁿ) that cover the data.
  const range = (v: number[]) => {
    const lo = Math.min(...v), hi = Math.max(...v);
    const step = niceMax(((hi - lo) || Math.abs(hi) || 1) / 4);
    const a = Math.floor(lo / step) * step;
    return [a, Math.max(a + step * 4, Math.ceil(hi / step) * step), step] as const;
  };
  const [x0, x1, xs0] = range(allX), [y0, y1, ys0] = range(allY);
  const px = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const py = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  for (let vy = y0; vy <= y1 + ys0 / 2; vy += ys0) {
    svg.append(svgEl(doc, "line", { x1: L, x2: W - R, y1: py(vy), y2: py(vy), class: "gridline" }));
    const ty = svgEl(doc, "text", { x: L - 6, y: py(vy) + 4, "text-anchor": "end", class: "axis" });
    ty.textContent = fmt(vy);
    svg.append(ty);
  }
  for (let vx = x0; vx <= x1 + xs0 / 2; vx += xs0) {
    const tx = svgEl(doc, "text", { x: px(vx), y: H - 10, "text-anchor": "middle", class: "axis" });
    tx.textContent = fmt(vx);
    svg.append(tx);
  }
  spec.series.forEach((s, si) => {
    const x = xs(s);
    s.values.forEach((v, i) => svg.append(titled(doc, svgEl(doc, "circle", { cx: px(x[i]!), cy: py(v), r: 4.5, fill: color(si), "fill-opacity": 0.75, stroke: color(si) }), `${s.name ? `${s.name} · ` : ""}(${x[i]}, ${v})`)));
  });
  return svg;
}

/**
 * Dated values (one series, ISO labels) as a habit calendar: a column per
 * week, a row per weekday. Anything else as a matrix: a row per series, a
 * column per label. Shade is the value's share of the largest.
 */
function heatmap(spec: ChartSpec, doc: Document, width: number): SVGSVGElement {
  const dated = spec.series.length === 1 && spec.labels.length > 0 && spec.labels.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  const max = Math.max(...spec.series.flatMap((s) => s.values), 0) || 1;
  const shade = (v: number) => (v <= 0 ? "var(--vak-surface-2, var(--_vak-surface-2))" : `color-mix(in srgb, var(--vak-accent, var(--_vak-accent)) ${Math.round(18 + (v / max) * 82)}%, var(--vak-surface, var(--_vak-surface)))`);
  if (dated) {
    const DAY = 86_400_000;
    const t = spec.labels.map((l) => Date.parse(`${l}T00:00:00Z`));
    const first = Math.min(...t) - (((new Date(Math.min(...t)).getUTCDay() + 6) % 7) * DAY);
    const weeks = Math.floor((Math.max(...t) - first) / DAY / 7) + 1;
    const cell = Math.max(8, Math.min(18, Math.floor((width - 40) / weeks) - 2)), gap = 2, L = 30, T = 16;
    const W = L + weeks * (cell + gap), H = T + 7 * (cell + gap);
    const svg = svgEl(doc, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", width: W, height: H, class: "heat" });
    ["Mon", "", "Wed", "", "Fri", "", ""].forEach((d, i) => {
      if (!d) return;
      const tx = svgEl(doc, "text", { x: L - 6, y: T + i * (cell + gap) + cell - 2, "text-anchor": "end", class: "axis" });
      tx.textContent = d;
      svg.append(tx);
    });
    let lastMonth = -1, lastX = -99;
    t.forEach((ti, i) => {
      const w = Math.floor((ti - first) / DAY / 7), d = (new Date(ti).getUTCDay() + 6) % 7;
      const m = new Date(ti).getUTCMonth();
      if (m !== lastMonth && d === 0 && L + w * (cell + gap) - lastX > 34) {
        lastMonth = m;
        lastX = L + w * (cell + gap);
        const tx = svgEl(doc, "text", { x: L + w * (cell + gap), y: 10, class: "axis" });
        tx.textContent = new Date(ti).toLocaleString(undefined, { month: "short", timeZone: "UTC" });
        svg.append(tx);
      }
      const v = spec.series[0]!.values[i] ?? 0;
      svg.append(titled(doc, svgEl(doc, "rect", { x: L + w * (cell + gap), y: T + d * (cell + gap), width: cell, height: cell, rx: 2, fill: shade(v) }), `${spec.labels[i]}: ${v}`));
    });
    return svg;
  }
  const L = Math.min(120, 8 + 7 * Math.max(...spec.series.map((s, i) => (s.name ?? `Series ${i + 1}`).length))), T = 22;
  const cw = Math.max(18, Math.min(56, (width - L) / Math.max(spec.labels.length, 1))), ch = Math.min(34, Math.max(20, cw * 0.7));
  const W = L + cw * spec.labels.length, H = T + ch * spec.series.length;
  const svg = svgEl(doc, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", width: W, height: H, class: "heat" });
  spec.labels.forEach((l, i) => {
    const tx = svgEl(doc, "text", { x: L + cw * (i + 0.5), y: 14, "text-anchor": "middle", class: "axis" });
    tx.textContent = l.length > 6 ? `${l.slice(0, 5)}…` : l;
    svg.append(tx);
  });
  spec.series.forEach((s, si) => {
    const tx = svgEl(doc, "text", { x: L - 6, y: T + ch * (si + 0.5) + 4, "text-anchor": "end", class: "axis" });
    tx.textContent = s.name ?? `Series ${si + 1}`;
    svg.append(tx);
    s.values.forEach((v, i) => {
      svg.append(titled(doc, svgEl(doc, "rect", { x: L + cw * i + 1, y: T + ch * si + 1, width: cw - 2, height: ch - 2, rx: 3, fill: shade(v) }), `${s.name ? `${s.name} · ` : ""}${spec.labels[i]}: ${v}`));
      if (cw >= 30) {
        const vt = svgEl(doc, "text", { x: L + cw * (i + 0.5), y: T + ch * (si + 0.5) + 4, "text-anchor": "middle", class: `heat-v${v / max > 0.55 ? " on" : ""}` });
        vt.textContent = fmt(v);
        svg.append(vt);
      }
    });
  });
  return svg;
}

/** A spoke per label, a polygon per series, rings at quarters of the largest value. */
function radar(spec: ChartSpec, doc: Document): SVGSVGElement {
  const n = Math.max(spec.labels.length, 3), cx = 160, cy = 150, r = 105;
  const svg = svgEl(doc, "svg", { viewBox: "0 0 320 300", role: "img", class: "radar" });
  const max = niceMax(Math.max(...spec.series.flatMap((s) => s.values), 0));
  const at = (i: number, f: number) => [cx + r * f * Math.sin((2 * Math.PI * i) / n), cy - r * f * Math.cos((2 * Math.PI * i) / n)] as const;
  for (let k = 1; k <= 4; k++) svg.append(svgEl(doc, "polygon", { points: Array.from({ length: n }, (_, i) => at(i, k / 4).join(",")).join(" "), class: "gridline", fill: "none" }));
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i, 1);
    svg.append(svgEl(doc, "line", { x1: cx, y1: cy, x2: x, y2: y, class: "gridline" }));
    const [lx, ly] = at(i, 1.16);
    const t = svgEl(doc, "text", { x: lx, y: ly + 4, "text-anchor": Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end", class: "axis" });
    const label = spec.labels[i] ?? "";
    t.textContent = label.length > 14 ? `${label.slice(0, 13)}…` : label;
    svg.append(t);
  }
  spec.series.forEach((s, si) => {
    const pts = Array.from({ length: n }, (_, i) => at(i, Math.max(0, s.values[i] ?? 0) / max));
    svg.append(svgEl(doc, "polygon", { points: pts.map((q) => q.join(",")).join(" "), fill: color(si), "fill-opacity": 0.16, stroke: color(si), "stroke-width": 2 }));
    pts.forEach(([x, y], i) => svg.append(titled(doc, svgEl(doc, "circle", { cx: x, cy: y, r: 3.5, fill: color(si) }), `${s.name ? `${s.name} · ` : ""}${spec.labels[i]}: ${s.values[i] ?? 0}`)));
  });
  return svg;
}
