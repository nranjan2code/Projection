// Shadow-DOM stylesheet for <vak-surface>. Layout adapts with container
// queries, so a surface responds to the box it lives in (side panel, phone,
// dashboard) rather than the viewport. Theme through --vak-* custom properties.

export const surfaceCss = /* css */ `
:host {
  --vak-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --vak-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --vak-bg: #f7f7f8;
  --vak-surface: #ffffff;
  --vak-surface-2: #f2f3f5;
  --vak-fg: #17181c;
  --vak-muted: #62656f;
  --vak-border: #e3e4e8;
  --vak-accent: #4f46e5;
  --vak-accent-fg: #ffffff;
  --vak-accent-soft: #eef0ff;
  --vak-info: #2563eb;
  --vak-success: #15803d;
  --vak-warning: #b45309;
  --vak-danger: #dc2626;
  --vak-series-1: #4f46e5;
  --vak-series-2: #0891b2;
  --vak-series-3: #d97706;
  --vak-series-4: #db2777;
  --vak-series-5: #16a34a;
  --vak-series-6: #7c3aed;
  --vak-radius: 14px;
  --vak-radius-sm: 9px;
  --vak-shadow: 0 1px 2px rgb(16 18 27 / 0.05), 0 2px 8px rgb(16 18 27 / 0.04);
  --vak-shadow-hover: 0 2px 4px rgb(16 18 27 / 0.06), 0 8px 24px rgb(16 18 27 / 0.08);
  --gap-sm: 8px;
  --gap-md: 14px;
  --gap-lg: 22px;

  display: block;
  container-type: inline-size;
  container-name: vak-surface;
  color: var(--vak-fg);
  font: 15px/1.5 var(--vak-font);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --vak-bg: #0f1013;
    --vak-surface: #17181d;
    --vak-surface-2: #1f2027;
    --vak-fg: #ececf0;
    --vak-muted: #9a9cab;
    --vak-border: #2b2d36;
    --vak-accent: #8b85ff;
    --vak-accent-fg: #0f1013;
    --vak-accent-soft: #23234a;
    --vak-info: #60a5fa;
    --vak-success: #4ade80;
    --vak-warning: #fbbf24;
    --vak-danger: #f87171;
    --vak-series-1: #8b85ff;
    --vak-series-2: #22d3ee;
    --vak-series-3: #fbbf24;
    --vak-series-4: #f472b6;
    --vak-series-5: #4ade80;
    --vak-series-6: #c084fc;
    --vak-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    --vak-shadow-hover: 0 6px 24px rgb(0 0 0 / 0.4);
  }
}
:host([theme="dark"]) {
  --vak-bg: #0f1013;
  --vak-surface: #17181d;
  --vak-surface-2: #1f2027;
  --vak-fg: #ececf0;
  --vak-muted: #9a9cab;
  --vak-border: #2b2d36;
  --vak-accent: #8b85ff;
  --vak-accent-fg: #0f1013;
  --vak-accent-soft: #23234a;
  --vak-info: #60a5fa;
  --vak-success: #4ade80;
  --vak-warning: #fbbf24;
  --vak-danger: #f87171;
  --vak-series-1: #8b85ff;
  --vak-series-2: #22d3ee;
  --vak-series-3: #fbbf24;
  --vak-series-4: #f472b6;
  --vak-series-5: #4ade80;
  --vak-series-6: #c084fc;
  --vak-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  --vak-shadow-hover: 0 6px 24px rgb(0 0 0 / 0.4);
}

*, *::before, *::after { box-sizing: border-box; }
.root { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
.title { margin: 0 0 2px; font-size: 1.15rem; font-weight: 650; letter-spacing: -0.01em; }
p, h3, h4, h5, h6, ul, ol, pre { margin: 0 0 0.6em; }
:is(p, ul, ol, pre):last-child { margin-bottom: 0; }
a { color: var(--vak-accent); }
code { font-family: var(--vak-mono); font-size: 0.88em; background: var(--vak-surface-2); padding: 0.1em 0.35em; border-radius: 5px; }
pre { background: var(--vak-surface-2); padding: 12px 14px; border-radius: var(--vak-radius-sm); overflow-x: auto; }
pre code { background: none; padding: 0; }

/* ---- layout ---------------------------------------------------------- */
.stack { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.stack.horizontal { flex-direction: row; flex-wrap: wrap; align-items: center; }
.stack.horizontal > * { flex: 1 1 auto; min-width: 0; }
.stack.horizontal > :is(.btn, .chip) { flex: 0 0 auto; }
.align-start { align-items: flex-start; } .align-center { align-items: center; }
.align-end { align-items: flex-end; } .align-stretch { align-items: stretch; }

.grid-box { container-type: inline-size; min-width: 0; }
.grid {
  display: grid;
  gap: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, max(var(--min), (100% - (var(--cols) - 1) * var(--gap)) / var(--cols))), 1fr));
}
.span-full { grid-column: 1 / -1; }
@container (min-width: 540px) { .grid > .span-2 { grid-column: span 2; } }
@container (min-width: 800px) { .grid > .span-3 { grid-column: span 3; } }
@container (min-width: 1060px) { .grid > .span-4 { grid-column: span 4; } }

.split-box { container-type: inline-size; min-width: 0; }
.split { display: grid; gap: var(--gap); grid-template-columns: minmax(0, 1fr); }
@container (min-width: 700px) {
  .split.r-1-1 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .split.r-2-1 { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  .split.r-1-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }
  .split.r-3-1 { grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); }
  .split.r-1-3 { grid-template-columns: minmax(0, 1fr) minmax(0, 3fr); }
}

/* Narrow surfaces: horizontal stacks fold, primary content comes first. */
@container vak-surface (max-width: 480px) {
  .stack.horizontal:not(.wrap) { flex-direction: column; align-items: stretch; }
  .p-primary { order: -1; }
  .p-tertiary { order: 1; }
}

.section { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
.section > header h3 { margin: 0; font-size: 1.05rem; font-weight: 650; letter-spacing: -0.01em; }
.section > header p { margin: 2px 0 0; color: var(--vak-muted); font-size: 0.92rem; }

.tabs { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
.tablist { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--vak-border); scrollbar-width: none; }
.tablist button {
  appearance: none; border: 0; background: none; color: var(--vak-muted); font: inherit; font-weight: 550;
  padding: 8px 12px; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; white-space: nowrap;
}
.tablist button[aria-selected="true"] { color: var(--vak-fg); border-bottom-color: var(--vak-accent); }

/* ---- content --------------------------------------------------------- */
.card {
  position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius);
  box-shadow: var(--vak-shadow); transition: box-shadow 160ms ease, transform 160ms ease;
}
.card:hover { box-shadow: var(--vak-shadow-hover); }
.card > img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: var(--vak-surface-2); }
.card .body { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px 18px; flex: 1; }
.card .head { display: flex; align-items: flex-start; gap: 10px; justify-content: space-between; }
.card h3 { margin: 0; font-size: 1.02rem; font-weight: 650; letter-spacing: -0.01em; line-height: 1.3; }
.card .sub { margin: 2px 0 0; color: var(--vak-muted); font-size: 0.9rem; }
.card .md { color: var(--vak-fg); font-size: 0.95rem; }
.card .kids { display: flex; flex-direction: column; gap: 10px; margin-top: auto; }
.card.tone-info { border-top: 3px solid var(--vak-info); }
.card.tone-success { border-top: 3px solid var(--vak-success); }
.card.tone-warning { border-top: 3px solid var(--vak-warning); }
.card.tone-danger { border-top: 3px solid var(--vak-danger); }
.badge {
  flex: none; font-size: 0.74rem; font-weight: 600; letter-spacing: 0.02em; padding: 3px 9px; border-radius: 999px;
  background: var(--vak-accent-soft); color: var(--vak-accent); white-space: nowrap;
}

.text.heading { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; }
.text.subheading { font-size: 1.05rem; font-weight: 600; }
.text.caption { font-size: 0.85rem; color: var(--vak-muted); }
.text.code { font-family: var(--vak-mono); font-size: 0.9rem; }

.stat {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  padding: 14px 16px; background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius);
}
.card .stat { padding: 0; border: 0; background: none; }
.stat .label { color: var(--vak-muted); font-size: 0.82rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.04em; }
.stat .value { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.15; overflow-wrap: anywhere; }
.card .stat .value { font-size: 1.2rem; }
.stat .delta { font-size: 0.86rem; font-weight: 600; color: var(--vak-muted); }
.stat .delta.up { color: var(--vak-success); } .stat .delta.down { color: var(--vak-danger); }

.alert {
  display: flex; gap: 12px; padding: 12px 14px; border-radius: var(--vak-radius-sm);
  background: var(--vak-surface-2); border: 1px solid var(--vak-border); border-left: 4px solid var(--vak-muted);
}
.alert.tone-info { border-left-color: var(--vak-info); }
.alert.tone-success { border-left-color: var(--vak-success); }
.alert.tone-warning { border-left-color: var(--vak-warning); }
.alert.tone-danger { border-left-color: var(--vak-danger); }
.alert strong { display: block; margin-bottom: 2px; }

.list { margin: 0; padding-left: 1.25em; display: flex; flex-direction: column; gap: 4px; }
.image { display: block; max-width: 100%; border-radius: var(--vak-radius-sm); }
hr.divider { border: 0; border-top: 1px solid var(--vak-border); margin: 4px 0; width: 100%; }

/* table → stacked rows on narrow containers */
.table-box { container-type: inline-size; border: 1px solid var(--vak-border); border-radius: var(--vak-radius); background: var(--vak-surface); overflow: hidden; }
.table-scroll { overflow-x: auto; }
/* Local interactions: filter, sort, page (no model turn). */
.filter { display: block; width: calc(100% - 16px); margin: 8px; font: inherit; font-size: 0.88rem; color: var(--vak-fg); background: var(--vak-bg); border: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); padding: 6px 10px; }
.list-box > .filter, .grid-box > .filter { width: 100%; margin: 0 0 var(--gap-sm); }
.filter:focus { outline: 2px solid var(--vak-accent); outline-offset: -1px; }
th .sort { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
th .sort::after { content: "↕"; opacity: 0.35; font-size: 0.9em; }
th[aria-sort="ascending"] .sort::after { content: "↑"; opacity: 1; }
th[aria-sort="descending"] .sort::after { content: "↓"; opacity: 1; }
th .sort:focus-visible { outline: 2px solid var(--vak-accent); border-radius: 4px; }
tfoot .totals td { font-weight: 650; border-top: 2px solid var(--vak-border); border-bottom: 0; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 6px 10px; font-size: 0.82rem; color: var(--vak-muted); border-top: 1px solid var(--vak-border); }
.pager[hidden] { display: none; }
.pager .page { font: inherit; width: 28px; height: 26px; border: 1px solid var(--vak-border); border-radius: 6px; background: var(--vak-surface); color: var(--vak-fg); cursor: pointer; }
.pager .page:disabled { opacity: 0.4; cursor: default; }
.none { color: var(--vak-muted); font-style: italic; }
/* timeline, steps, code, places, gallery */
.timeline { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--vak-border); display: flex; flex-direction: column; gap: var(--gap-md); }
.timeline li { position: relative; }
.timeline li::before { content: ""; position: absolute; left: -24px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: var(--vak-accent); box-shadow: 0 0 0 3px var(--vak-surface); }
.tl-date { font-size: 0.78rem; color: var(--vak-muted); font-variant-numeric: tabular-nums; }
.tl-title { font-weight: 600; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.step { display: flex; gap: 12px; padding: 8px 0; }
.step-mark { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 0.8rem; font-weight: 700; border: 2px solid var(--vak-border); color: var(--vak-muted); }
.step.done .step-mark { background: var(--vak-success); border-color: var(--vak-success); color: var(--vak-surface); }
.step.current .step-mark { border-color: var(--vak-accent); color: var(--vak-accent); }
.step.failed .step-mark { border-color: var(--vak-danger); color: var(--vak-danger); }
.step.skipped .step-title { text-decoration: line-through; color: var(--vak-muted); }
.step-title { font-weight: 600; }
.step.todo .step-title { color: var(--vak-muted); font-weight: 500; }
.code-box { border: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); overflow: hidden; background: var(--vak-surface-2); }
.code-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; font-size: 0.78rem; color: var(--vak-muted); border-bottom: 1px solid var(--vak-border); }
.code-copy { font: inherit; border: 1px solid var(--vak-border); background: var(--vak-surface); color: var(--vak-fg); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
pre.code { margin: 0; padding: 12px; overflow-x: auto; font: 0.85rem/1.5 var(--vak-mono); }
.places { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--vak-border); border-radius: var(--vak-radius); background: var(--vak-surface); }
.place { display: flex; gap: 12px; align-items: center; padding: 10px 14px; }
.place + .place { border-top: 1px solid var(--vak-border); }
.place > div { flex: 1; min-width: 0; }
.place-pin { color: var(--vak-accent); font-size: 1.1rem; }
.place-name { font-weight: 600; }
.place-addr, .place-note { font-size: 0.85rem; color: var(--vak-muted); }
.place-open { font-size: 0.82rem; color: var(--vak-accent); white-space: nowrap; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--gap-sm); }
.gallery figure { margin: 0; border-radius: var(--vak-radius-sm); overflow: hidden; background: var(--vak-surface-2); }
.gallery img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.gallery figcaption { font-size: 0.8rem; color: var(--vak-muted); padding: 6px 8px; }
table { width: 100%; border-collapse: collapse; font-size: 0.93rem; font-variant-numeric: tabular-nums; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--vak-border); vertical-align: top; }
th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vak-muted); font-weight: 600; background: var(--vak-surface-2); }
tr:last-child td { border-bottom: 0; }
.a-end { text-align: right; } .a-center { text-align: center; }
@container (max-width: 520px) {
  table, tbody, tr, td { display: block; width: 100%; }
  thead { display: none; }
  tr { padding: 10px 14px; border-bottom: 1px solid var(--vak-border); }
  tr:last-child { border-bottom: 0; }
  td { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border: 0; text-align: right; }
  td::before { content: attr(data-label); color: var(--vak-muted); font-size: 0.85rem; text-align: left; }
}

.chart { margin: 0; padding: 14px 14px 10px; background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius); min-width: 0; }
.card .chart { padding: 0; border: 0; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart svg.pie { aspect-ratio: 1; max-width: 240px; margin: 0 auto; }
.chart .gridline { stroke: var(--vak-border); stroke-width: 1; vector-effect: non-scaling-stroke; }
.chart .axis { fill: var(--vak-muted); font-size: 11px; font-family: var(--vak-font); }
.graph { margin: 0; padding: 14px; background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius); min-width: 0; }
.card .graph { padding: 0; border: 0; }
.graph-tools { display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin-bottom: 8px; }
.graph-btn { font: inherit; font-size: 0.82rem; min-width: 30px; height: 28px; padding: 0 8px; border: 1px solid var(--vak-border); border-radius: 7px; background: var(--vak-surface); color: var(--vak-fg); cursor: pointer; }
.graph-btn:hover { border-color: var(--vak-muted); }
.graph-find { font: inherit; font-size: 0.84rem; height: 28px; flex: 1; max-width: 240px; margin-right: auto; padding: 0 8px; border: 1px solid var(--vak-border); border-radius: 7px; background: var(--vak-surface); color: var(--vak-fg); }
.graph-frame { position: relative; height: clamp(200px, var(--graph-h, 320px), 70vh); border-radius: calc(var(--vak-radius) - 4px); background: color-mix(in srgb, var(--vak-border) 22%, var(--vak-surface)); overflow: hidden; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.graph-frame.dragging { cursor: grabbing; }
.graph-frame:focus-visible { outline: 2px solid var(--vak-accent); outline-offset: 2px; }
.graph-frame svg { display: block; width: 100%; height: 100%; font-family: var(--vak-font); }
.graph .dim { opacity: 0.22; }
.graph-node.match rect { stroke: var(--vak-accent); stroke-width: 3; }
.graph-edge { stroke: var(--vak-muted); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.graph-arrow { fill: var(--vak-muted); }
.graph-edge-label { font-size: 11px; fill: var(--vak-muted); paint-order: stroke; stroke: var(--vak-surface); stroke-width: 4px; stroke-linejoin: round; }
.graph-node { cursor: pointer; outline: none; transition: opacity 0.15s; }
.graph-node rect { --node: var(--vak-accent); fill: color-mix(in srgb, var(--node) 14%, var(--vak-surface)); stroke: var(--node); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.graph-node text { font-size: 12.5px; font-weight: 600; fill: var(--vak-fg); pointer-events: none; }
.graph-node:hover rect, .graph-node.selected rect { stroke-width: 2.5; fill: color-mix(in srgb, var(--node) 26%, var(--vak-surface)); }
.graph-node:focus-visible rect { stroke-width: 3; }
.graph-detail { margin-top: 10px; font-size: 0.88rem; color: var(--vak-muted); text-align: center; }
.graph-detail b { color: var(--vak-fg); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 0.84rem; color: var(--vak-muted); justify-content: center; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

/* ---- everyday components --------------------------------------------- */
.w-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.w-muted { color: var(--vak-muted); font-size: 0.88rem; margin: 4px 0; }
.w-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; }
.w-btn, .w-seg button { font: inherit; font-size: 0.84rem; min-width: 32px; min-height: 32px; padding: 0 10px; border: 1px solid var(--vak-border); border-radius: 8px; background: var(--vak-surface); color: var(--vak-fg); cursor: pointer; }
.w-btn:hover, .w-seg button:hover { border-color: var(--vak-muted); }
.w-btn:focus-visible, .w-seg button:focus-visible { outline: 2px solid var(--vak-accent); outline-offset: 1px; }
.w-seg { display: inline-flex; margin-left: auto; }
.w-seg button { border-radius: 0; margin-left: -1px; }
.w-seg button:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
.w-seg button:last-child { border-radius: 0 8px 8px 0; }
.w-seg button[aria-pressed="true"] { background: var(--vak-accent-soft); border-color: var(--vak-accent); color: var(--vak-accent); position: relative; }
.cal, .board, .prog, .acc, .cmp, .timer, .tree-box, .diff, .gantt, .math { min-width: 0; }
.cal, .tree-box, .gantt, .timer, .prog, .math:not(.inline) { padding: 14px; background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius); }
.card :is(.cal, .tree-box, .gantt, .timer, .prog, .math) { padding: 0; border: 0; }
.cal-title { font-weight: 650; padding: 0 4px; }
.cal-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--vak-border); border-left: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); overflow: hidden; }
.cal-wd { font-size: 0.75rem; color: var(--vak-muted); padding: 4px 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.cal-month .cal-wd { border-right: 1px solid var(--vak-border); border-bottom: 1px solid var(--vak-border); background: var(--vak-surface-2); }
.cal-cell { position: relative; min-height: 84px; padding: 4px; border-right: 1px solid var(--vak-border); border-bottom: 1px solid var(--vak-border); cursor: pointer; outline: none; min-width: 0; }
.cal-cell.out { background: color-mix(in srgb, var(--vak-surface-2) 60%, transparent); color: var(--vak-muted); }
.cal-cell:hover { background: var(--vak-surface-2); }
.cal-cell:focus-visible { box-shadow: inset 0 0 0 2px var(--vak-accent); }
.cal-cell.picked { background: var(--vak-accent-soft); }
.cal-num { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 12px; font-size: 0.82rem; font-weight: 600; }
.cal-cell.today .cal-num { background: var(--vak-accent); color: var(--vak-accent-fg); }
.cal-evs { display: grid; gap: 2px; }
.cal-ev { display: flex; gap: 6px; align-items: baseline; padding: 2px 6px; border-radius: 6px; font-size: 0.78rem; background: var(--vak-accent-soft); border-left: 3px solid var(--vak-accent); overflow: hidden; }
.cal-ev-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-ev.t-success { border-left-color: var(--vak-success); } .cal-ev.t-warning { border-left-color: var(--vak-warning); } .cal-ev.t-danger { border-left-color: var(--vak-danger); } .cal-ev.t-info { border-left-color: var(--vak-info); }
.cal-time { color: var(--vak-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cal-more { font-size: 0.74rem; color: var(--vak-muted); padding-left: 6px; }
.cal-dot { display: none; }
.cal-day-list { margin-top: 12px; display: grid; gap: 6px; }
.cal-day-list h4 { margin: 0; font-size: 0.92rem; }
.cal-day-list .cal-ev { font-size: 0.88rem; padding: 6px 10px; flex-wrap: wrap; }
.cal-day-list .cal-ev-title { white-space: normal; }
.cal-note { flex-basis: 100%; color: var(--vak-muted); font-size: 0.82rem; }
.cal-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.cal-wcol { display: grid; align-content: start; gap: 4px; min-height: 120px; padding: 4px; border-radius: var(--vak-radius-sm); background: var(--vak-surface-2); }
.cal-wcol.today { box-shadow: inset 0 0 0 2px var(--vak-accent); }
.cal-wcol .cal-ev { flex-wrap: wrap; }
.cal-wcol .cal-ev-title { white-space: normal; }
@container vak-surface (max-width: 560px) {
  .cal-cell { min-height: 48px; text-align: center; }
  .cal-evs { display: none; }
  .cal-dot { display: block; width: 6px; height: 6px; border-radius: 3px; margin: 2px auto 0; background: var(--vak-accent); }
  .cal-week { grid-template-columns: 1fr; }
  .cal-wcol { min-height: 0; }
  .w-seg { margin-left: 0; }
}
.board-lanes { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x proximity; }
.board-col { display: flex; flex-direction: column; min-width: 0; background: var(--vak-surface-2); border-radius: var(--vak-radius); padding: 10px; scroll-snap-align: start; }
.board-head { display: flex; justify-content: space-between; align-items: center; font-weight: 650; font-size: 0.9rem; margin-bottom: 8px; }
.board-count { font-size: 0.78rem; color: var(--vak-muted); background: var(--vak-surface); border-radius: 10px; padding: 1px 8px; }
.board-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; align-content: start; flex: 1; min-height: 48px; }
.board-card { background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); padding: 10px 12px; box-shadow: var(--vak-shadow); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
.board-card:hover { box-shadow: var(--vak-shadow-hover); }
.board-card:focus-visible { outline: 2px solid var(--vak-accent); outline-offset: 1px; }
.board-card.grabbed { outline: 2px dashed var(--vak-accent); transform: rotate(-1deg); }
.board-card.dragging { opacity: 0.35; }
.board-title { font-weight: 600; font-size: 0.92rem; }
.board-note { color: var(--vak-muted); font-size: 0.84rem; margin-top: 2px; }
.board-tag { display: inline-block; margin-top: 6px; font-size: 0.74rem; padding: 1px 8px; border-radius: 10px; background: var(--vak-accent-soft); color: var(--vak-accent); }
.board-empty { color: var(--vak-muted); font-size: 0.82rem; text-align: center; padding: 12px; border: 1.5px dashed var(--vak-border); border-radius: var(--vak-radius-sm); }
.board-marker { height: 4px; border-radius: 2px; background: var(--vak-accent); }
.board-ghost { position: fixed; left: 0; top: 0; z-index: 10; pointer-events: none; box-shadow: var(--vak-shadow-hover); opacity: 0.95; }
.prog-head { display: flex; justify-content: space-between; gap: 10px; font-size: 0.9rem; margin-bottom: 6px; }
.prog-label { font-weight: 600; }
.prog-val { color: var(--vak-muted); font-variant-numeric: tabular-nums; font-size: 0.88rem; }
.prog { --tone: var(--vak-accent); }
.prog.t-success { --tone: var(--vak-success); } .prog.t-warning { --tone: var(--vak-warning); } .prog.t-danger { --tone: var(--vak-danger); } .prog.t-info { --tone: var(--vak-info); }
.prog-track { height: 10px; border-radius: 5px; background: var(--vak-surface-2); overflow: hidden; }
.prog-fill { height: 100%; border-radius: 5px; background: var(--tone); transition: width 0.4s ease; }
.prog-dial { display: block; width: 100%; max-width: 180px; margin: 0 auto; }
.prog-bg { fill: none; stroke: var(--vak-surface-2); stroke-width: 12; stroke-linecap: round; }
.prog-arc { fill: none; stroke: var(--tone, var(--vak-accent)); stroke-width: 12; stroke-linecap: round; transition: stroke-dasharray 0.4s ease; }
.prog-pct { font-size: 22px; font-weight: 700; fill: var(--vak-fg); font-family: var(--vak-font); }
.prog:is(.k-ring, .k-gauge) .prog-val { text-align: center; }
.prog-stars { display: inline-flex; gap: 2px; font-size: 1.4rem; margin-right: 8px; vertical-align: middle; }
.prog-stars .star, .stars-in .star { color: transparent; background: linear-gradient(90deg, var(--vak-warning) var(--fill, 0%), var(--vak-border) var(--fill, 0%)); -webkit-background-clip: text; background-clip: text; }
.stars-in { display: inline-flex; gap: 2px; }
.stars-in .star { font-size: 1.6rem; line-height: 1; padding: 2px; border: 0; background-color: transparent; cursor: pointer; --fill: 0%; border-radius: 6px; }
.stars-in .star.on { --fill: 100%; }
.stars-in:hover .star { --fill: 100%; }
.stars-in .star:hover ~ .star { --fill: 0%; }
.stars-in .star:focus-visible { outline: 2px solid var(--vak-accent); }
.range-in { display: flex; align-items: center; gap: 12px; }
.range-in input[type="range"] { flex: 1; accent-color: var(--vak-accent); min-height: 32px; }
.range-val { min-width: 3.5em; text-align: end; font-variant-numeric: tabular-nums; font-weight: 600; }
.file-in { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1.5px dashed var(--vak-border); border-radius: var(--vak-radius-sm); cursor: pointer; color: var(--vak-muted); font-size: 0.9rem; }
.file-in.over { border-color: var(--vak-accent); background: var(--vak-accent-soft); }
.file-in input { max-width: 110px; font-size: 0.82rem; }
.acc { display: grid; gap: 8px; }
.acc-tools { margin-bottom: 0; justify-content: flex-end; }
.acc-kids { display: contents; }
.acc-item { background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); }
.acc-item > summary { list-style: none; cursor: pointer; padding: 12px 14px; font-weight: 600; display: flex; justify-content: space-between; gap: 10px; min-height: 24px; }
.acc-item > summary::-webkit-details-marker { display: none; }
.acc-item > summary::after { content: "▾"; color: var(--vak-muted); transition: transform 0.2s; }
.acc-item[open] > summary::after { transform: rotate(180deg); }
.acc-item > summary:focus-visible { outline: 2px solid var(--vak-accent); outline-offset: -2px; border-radius: var(--vak-radius-sm); }
.acc-item > :not(summary) { padding: 0 14px 12px; }
.acc-item > .section { border: 0; padding-top: 0; }
.cmp { display: grid; gap: 12px; }
.cmp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.cmp-card { position: relative; padding: 14px; background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius); }
.cmp-card.best { border: 2px solid var(--vak-success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--vak-success) 14%, transparent); }
.cmp-badge { position: absolute; top: -10px; right: 12px; font-size: 0.74rem; font-weight: 700; padding: 2px 10px; border-radius: 10px; background: var(--vak-success); color: var(--vak-surface); }
.cmp-card h4 { margin: 0 0 4px; font-size: 1rem; }
.cmp-price { font-weight: 700; font-size: 1.1rem; margin-bottom: 6px; }
.cmp-pc { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; font-size: 0.88rem; }
.cmp-pc li::before { display: inline-block; width: 1.3em; font-weight: 700; }
.cmp-pc .pro::before { content: "✓"; color: var(--vak-success); }
.cmp-pc .con::before { content: "✗"; color: var(--vak-danger); }
.cmp-table td.best, .cmp-table th.best { background: color-mix(in srgb, var(--vak-success) 10%, transparent); }
.cmp-table tr.same td { color: var(--vak-muted); }
.timer { display: grid; justify-items: center; gap: 10px; outline: none; }
.timer:focus-visible { box-shadow: 0 0 0 2px var(--vak-accent); }
.timer-label { font-weight: 650; }
.timer-face { position: relative; width: min(200px, 60vw); aspect-ratio: 1; display: grid; place-items: center; }
.timer-ring { position: absolute; inset: 0; width: 100%; height: 100%; }
.timer-ring .prog-arc { stroke-width: 8; transition: none; }
.timer-ring .prog-bg { stroke-width: 8; }
.timer-digits { font-size: clamp(1.6rem, 6cqi, 2.6rem); font-weight: 700; font-variant-numeric: tabular-nums; }
.m-countdown .timer-digits { font-size: clamp(1.3rem, 5cqi, 2.1rem); }
.timer.done .timer-digits { color: var(--vak-danger); animation: vak-pulse 1s ease-in-out 3; }
.timer-tools { justify-content: center; margin: 0; }
.timer-laps { margin: 0; padding-left: 1.6em; font-variant-numeric: tabular-nums; color: var(--vak-muted); font-size: 0.88rem; columns: 2; }
@keyframes vak-pulse { 50% { opacity: 0.35; } }
.tree { list-style: none; margin: 0; padding: 0; font-size: 0.92rem; }
.tree ul { list-style: none; margin: 0; padding: 0; }
.tree li[aria-expanded="false"] > ul { display: none; }
.tree li { outline: none; }
.tree-row { display: flex; align-items: baseline; gap: 6px; padding: 4px 8px 4px calc(8px + var(--depth) * 18px); border-radius: 6px; cursor: pointer; min-height: 24px; }
.tree-row:hover { background: var(--vak-surface-2); }
.tree li:focus-visible > .tree-row { box-shadow: inset 0 0 0 2px var(--vak-accent); }
.tree-twisty { width: 1em; text-align: center; font-weight: 700; color: var(--vak-muted); transition: transform 0.15s; flex: none; }
.tree li[aria-expanded="true"] > .tree-row .tree-twisty { transform: rotate(90deg); }
.tree-note { color: var(--vak-muted); font-size: 0.82rem; }
.math { margin: 0; overflow-x: auto; text-align: center; font-size: 1.15rem; }
.math.inline { display: inline; padding: 0; font-size: inherit; }
.math figcaption { font-size: 0.84rem; color: var(--vak-muted); margin-top: 6px; }
.math-unknown { color: var(--vak-danger); }
.diff { border: 1px solid var(--vak-border); border-radius: var(--vak-radius); overflow: hidden; background: var(--vak-surface); }
.diff .code-bar { gap: 10px; }
.diff .w-seg { margin-left: auto; }
.diff-stat { font-size: 0.8rem; color: var(--vak-muted); font-family: var(--vak-mono); }
.diff-scroll { overflow-x: auto; }
.diff-table { width: 100%; border-collapse: collapse; font: 0.82rem/1.5 var(--vak-mono); }
.diff-table td { padding: 0 8px; vertical-align: top; border: 0; white-space: pre; }
.diff-table td.no { width: 1%; color: var(--vak-muted); text-align: end; user-select: none; -webkit-user-select: none; opacity: 0.7; }
.diff-table td.txt code { font: inherit; background: none; padding: 0; }
.diff-table .sig { display: inline-block; width: 1.2em; color: var(--vak-muted); user-select: none; -webkit-user-select: none; }
.diff-table td.add { background: color-mix(in srgb, var(--vak-success) 12%, transparent); }
.diff-table td.del { background: color-mix(in srgb, var(--vak-danger) 12%, transparent); }
.diff-table td.add mark { background: color-mix(in srgb, var(--vak-success) 32%, transparent); color: inherit; border-radius: 2px; }
.diff-table td.del mark { background: color-mix(in srgb, var(--vak-danger) 32%, transparent); color: inherit; border-radius: 2px; }
.diff-table.v-split td.txt { width: 49%; }
.diff-table tr.hunk td, .diff-table tr.fold td { background: var(--vak-surface-2); color: var(--vak-muted); padding: 2px 8px; }
.diff-more { font: inherit; border: 0; background: none; color: var(--vak-accent); cursor: pointer; padding: 2px 0; }
@container (max-width: 520px) {
  .diff-table { display: table; } .diff-table tbody { display: table-row-group; } .diff-table tr { display: table-row; padding: 0; }
  .diff-table td { display: table-cell; width: auto; text-align: left; padding: 0 8px; } .diff-table td::before { content: none; }
}
@container vak-surface (max-width: 560px) { .diff-table.v-split td.txt { white-space: pre-wrap; word-break: break-all; } }
.gantt-frame { display: grid; grid-template-columns: minmax(90px, 28%) 1fr; border: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); overflow: hidden; outline: none; }
.gantt-frame:focus-visible { outline: 2px solid var(--vak-accent); }
.gantt-names { border-right: 1px solid var(--vak-border); background: var(--vak-surface-2); min-width: 0; }
.gantt-name { height: 34px; display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--vak-border); cursor: pointer; }
.gantt-name.head { height: 26px; cursor: default; }
.gantt-group { font-size: 0.72rem; color: var(--vak-muted); }
.gantt-track { overflow-x: auto; position: relative; touch-action: pan-x pan-y; cursor: grab; }
.gantt-track.dragging { cursor: grabbing; user-select: none; -webkit-user-select: none; }
.gantt-inner { position: relative; min-width: 100%; }
.gantt-scale { position: relative; height: 26px; border-bottom: 1px solid var(--vak-border); }
.gantt-tick { position: absolute; top: 0; bottom: 0; padding: 5px 4px; font-size: 0.72rem; color: var(--vak-muted); border-left: 1px solid var(--vak-border); white-space: nowrap; }
.gantt-tick.month { color: var(--vak-fg); font-weight: 600; }
.gantt-row { position: relative; height: 34px; border-bottom: 1px solid color-mix(in srgb, var(--vak-border) 60%, transparent); }
.gantt-bar { position: absolute; top: 7px; height: 20px; border-radius: 6px; background: color-mix(in srgb, var(--c) 30%, var(--vak-surface)); border: 1.5px solid var(--c); overflow: hidden; outline: none; }
.gantt-bar:focus-visible { box-shadow: 0 0 0 2px var(--vak-accent); }
.gantt-bar.milestone { width: 14px; height: 14px; top: 10px; border-radius: 2px; transform: translateX(-7px) rotate(45deg); background: var(--c); }
.gantt-done { position: absolute; inset: 0 auto 0 0; background: var(--c); opacity: 0.55; }
.gantt-bar-label { position: relative; padding: 0 6px; font-size: 0.74rem; font-weight: 600; line-height: 17px; white-space: nowrap; }
.gantt-today { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--vak-danger); opacity: 0.7; z-index: 1; pointer-events: none; }
.chart svg.radar { max-width: 360px; margin: 0 auto; }
.chart svg.heat { max-width: 100%; height: auto; }
.heat-v { font-size: 10.5px; fill: var(--vak-fg); font-family: var(--vak-font); pointer-events: none; }
.heat-v.on { fill: var(--vak-accent-fg); }
@media (prefers-reduced-motion: reduce) { .prog-fill, .prog-arc, .tree-twisty, .acc-item > summary::after { transition: none; } .timer.done .timer-digits { animation: none; } }

/* ---- interaction ----------------------------------------------------- */
.btn {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-weight: 600; font-size: 0.93rem; line-height: 1; padding: 10px 16px; min-height: 40px;
  border-radius: var(--vak-radius-sm); border: 1px solid var(--vak-border); background: var(--vak-surface); color: var(--vak-fg);
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
}
.btn:hover { background: var(--vak-surface-2); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, .chip:focus-visible, .seg button:focus-visible {
  outline: 2px solid var(--vak-accent); outline-offset: 2px;
}
.btn.primary { background: var(--vak-accent); border-color: var(--vak-accent); color: var(--vak-accent-fg); }
.btn.primary:hover { filter: brightness(1.08); background: var(--vak-accent); }
.btn.danger { color: var(--vak-danger); }
.btn.link { border-color: transparent; background: none; color: var(--vak-accent); padding-inline: 4px; }
.btn[disabled] { opacity: 0.55; cursor: progress; }

.form {
  display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0;
  padding: 18px; background: var(--vak-surface); border: 1px solid var(--vak-border); border-radius: var(--vak-radius);
}
.card .form { padding: 0; border: 0; background: none; }
.form-box { container-type: inline-size; }
.fields { display: grid; gap: 14px 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
.fields > .wide { grid-column: 1 / -1; }
.form .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
@container (max-width: 420px) { .form .actions .btn { flex: 1; } }

.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field > label, .field > .label { font-size: 0.86rem; font-weight: 600; color: var(--vak-fg); }
.field .req { color: var(--vak-danger); margin-left: 2px; }
input, select, textarea {
  font: inherit; color: var(--vak-fg); background: var(--vak-surface); width: 100%;
  border: 1px solid var(--vak-border); border-radius: var(--vak-radius-sm); padding: 9px 12px; min-height: 40px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
input:hover, select:hover, textarea:hover { border-color: color-mix(in srgb, var(--vak-muted) 45%, var(--vak-border)); }
textarea { min-height: 92px; resize: vertical; }
.field.invalid :is(input, select, textarea) { border-color: var(--vak-danger); }
.field .err { color: var(--vak-danger); font-size: 0.82rem; }
.range { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; color: var(--vak-muted); }
.check { display: flex; align-items: center; gap: 10px; font-weight: 500; cursor: pointer; }
.check input { width: 18px; height: 18px; min-height: 0; accent-color: var(--vak-accent); }

.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg button, .chip {
  appearance: none; font: inherit; font-size: 0.9rem; font-weight: 550; padding: 7px 12px; border-radius: 999px;
  border: 1px solid var(--vak-border); background: var(--vak-surface); color: var(--vak-fg); cursor: pointer;
}
.seg button[aria-pressed="true"], .chip[aria-pressed="true"] { background: var(--vak-accent-soft); border-color: var(--vak-accent); color: var(--vak-accent); }

/* ---- streaming + errors ---------------------------------------------- */
.pending {
  min-height: 64px; border-radius: var(--vak-radius);
  background: linear-gradient(90deg, var(--vak-surface-2) 0%, var(--vak-surface) 50%, var(--vak-surface-2) 100%) 0 0 / 200% 100%;
  animation: shimmer 1.2s linear infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .pending { animation: none; } .card { transition: none; } }
.invalid-node {
  padding: 10px 12px; border: 1px dashed var(--vak-border); border-radius: var(--vak-radius-sm);
  color: var(--vak-muted); font-size: 0.85rem;
}
.enter { animation: enter 220ms ease both; }
@keyframes enter { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .enter { animation: none; } }
`;
