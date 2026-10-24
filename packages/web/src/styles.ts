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
.table-box { container-type: inline-size; overflow-x: auto; border: 1px solid var(--vak-border); border-radius: var(--vak-radius); background: var(--vak-surface); }
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
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 0.84rem; color: var(--vak-muted); justify-content: center; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

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
