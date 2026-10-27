// Shadow-DOM stylesheet for <vak-surface>. Layout adapts with container
// queries, so a surface responds to the box it lives in (side panel, phone,
// dashboard) rather than the viewport. Theme through inherited --vak-* custom properties. Private --_vak-* values
// are fallbacks, so defaults never mask an app wrapper’s branding.

export const surfaceCss = /* css */ `
.media { margin: 0; display: grid; gap: 10px; min-width: 0; }
.media img, .media video { display: block; max-width: 100%; max-height: 65vh; object-fit: contain; }
.media audio { width: 100%; min-width: 0; }
.media-controls { display: flex; gap: 6px; flex-wrap: wrap; }
.media-status:empty { display: none; }
:host {
  --_vak-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --_vak-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --_vak-bg: #f7f7f8;
  --_vak-surface: #ffffff;
  --_vak-surface-2: #f2f3f5;
  --_vak-fg: #17181c;
  --_vak-muted: #62656f;
  --_vak-border: #e5e7eb;
  --_vak-accent: #343940;
  --_vak-accent-fg: #ffffff;
  --_vak-accent-soft: #eef0f2;
  --_vak-info: #2563eb;
  --_vak-success: #15803d;
  --_vak-warning: #b45309;
  --_vak-danger: #dc2626;
  --_vak-series-1: #62656f;
  --_vak-series-2: #0891b2;
  --_vak-series-3: #d97706;
  --_vak-series-4: #db2777;
  --_vak-series-5: #16a34a;
  --_vak-series-6: #7c3aed;
  --_vak-radius: 8px;
  --_vak-radius-sm: 6px;
  --_vak-shadow: none;
  --_vak-shadow-hover: 0 2px 6px rgb(0 0 0 / 0.06);
  --_vak-font-size: 14px;
  --_vak-line-height: 1.55;
  --_vak-weight-heading: 500;
  --_vak-weight-label: 500;
  --_vak-weight-value: 550;
  --_vak-control-height: 36px;
  --_vak-card-padding: 16px;
  --_vak-grid-min: 220px;
  --gap-sm: var(--vak-space-sm, 8px);
  --gap-md: var(--vak-space-md, 12px);
  --gap-lg: var(--vak-space-lg, 20px);

  display: block;
  container-type: inline-size;
  container-name: vak-surface;
  color: var(--vak-fg, var(--_vak-fg));
  font: var(--vak-font-size, var(--_vak-font-size))/var(--vak-line-height, var(--_vak-line-height)) var(--vak-font, var(--_vak-font));
  color-scheme: light;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    color-scheme: dark;
    --_vak-bg: #0f1013;
    --_vak-surface: #181a1f;
    --_vak-surface-2: #202329;
    --_vak-fg: #ececf0;
    --_vak-muted: #9a9cab;
    --_vak-border: #292c33;
    --_vak-accent: #d4d7dd;
    --_vak-accent-fg: #0f1013;
    --_vak-accent-soft: #272a30;
    --_vak-info: #60a5fa;
    --_vak-success: #4ade80;
    --_vak-warning: #fbbf24;
    --_vak-danger: #f87171;
    --_vak-series-1: #b0b6c2;
    --_vak-series-2: #22d3ee;
    --_vak-series-3: #fbbf24;
    --_vak-series-4: #f472b6;
    --_vak-series-5: #4ade80;
    --_vak-series-6: #c084fc;
    --_vak-shadow: none;
    --_vak-shadow-hover: 0 2px 6px rgb(0 0 0 / 0.06);
  }
}
:host([theme="dark"]) {
  color-scheme: dark;
  --_vak-bg: #0f1013;
  --_vak-surface: #181a1f;
  --_vak-surface-2: #202329;
  --_vak-fg: #ececf0;
  --_vak-muted: #9a9cab;
  --_vak-border: #292c33;
  --_vak-accent: #d4d7dd;
  --_vak-accent-fg: #0f1013;
  --_vak-accent-soft: #272a30;
  --_vak-info: #60a5fa;
  --_vak-success: #4ade80;
  --_vak-warning: #fbbf24;
  --_vak-danger: #f87171;
  --_vak-series-1: #b0b6c2;
  --_vak-series-2: #22d3ee;
  --_vak-series-3: #fbbf24;
  --_vak-series-4: #f472b6;
  --_vak-series-5: #4ade80;
  --_vak-series-6: #c084fc;
  --_vak-shadow: none;
  --_vak-shadow-hover: 0 2px 6px rgb(0 0 0 / 0.06);
}

*, *::before, *::after { box-sizing: border-box; }
.root { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
.title { margin: 0 0 2px; font-size: 1.05em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); letter-spacing: -0.01em; }
p, h3, h4, h5, h6, ul, ol, pre { margin: 0 0 0.6em; }
:is(p, ul, ol, pre):last-child { margin-bottom: 0; }
a { color: var(--vak-accent, var(--_vak-accent)); }
code { font-family: var(--vak-mono, var(--_vak-mono)); font-size: 0.88em; background: var(--vak-surface-2, var(--_vak-surface-2)); padding: 0.1em 0.35em; border-radius: 5px; }
pre { background: var(--vak-surface-2, var(--_vak-surface-2)); padding: 12px 14px; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); overflow-x: auto; }
pre code { background: none; padding: 0; }

/* ---- layout ---------------------------------------------------------- */
.stack { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.stack.horizontal { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
.stack.horizontal > * { flex: 1 1 auto; min-width: 0; }
.stack.horizontal > :is(.btn, .chip) { flex: 0 0 auto; }
.stack.align-start { align-items: flex-start; } .stack.align-center { align-items: center; }
.stack.align-end { align-items: flex-end; } .stack.align-stretch { align-items: stretch; }

.grid-box { container-type: inline-size; min-width: 0; }
.grid {
  display: grid;
  align-items: var(--vak-grid-align, start);
  gap: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, max(var(--min), (100% - (var(--cols) - 1) * var(--gap)) / var(--cols))), 1fr));
}
/* Explicit grids keep their requested track rhythm when the final row is sparse. */
.grid.fixed-columns { grid-template-columns: repeat(auto-fill, minmax(min(100%, max(var(--min), (100% - (var(--cols) - 1) * var(--gap)) / var(--cols))), 1fr)); }
/* Semantic measures constrain any component, including flex/grid children. */
.measure-sm { width: 100%; max-width: 320px; }
.measure-md { width: 100%; max-width: 720px; }
.measure-lg { width: 100%; max-width: 1040px; }
.measure-full { width: 100%; max-width: none; }
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
  .stack.horizontal:not(.wrap) { flex-direction: column; }
  .stack.horizontal:not(.wrap):not(:is(.align-start, .align-center, .align-end, .align-stretch)) { align-items: stretch; }
  .p-primary { order: -1; }
  .p-tertiary { order: 1; }
}

.section { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
.section > header h3 { margin: 0; font-size: 1em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); letter-spacing: -0.01em; }
.section > header p { margin: 2px 0 0; color: var(--vak-muted, var(--_vak-muted)); font-size: 0.92em; }

.tabs { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
.tablist { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--vak-border, var(--_vak-border)); scrollbar-width: none; }
.tablist button {
  appearance: none; border: 0; background: none; color: var(--vak-muted, var(--_vak-muted)); font: inherit; font-weight: var(--vak-weight-label, var(--_vak-weight-label));
  padding: 8px 12px; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; white-space: nowrap;
}
.tablist button[aria-selected="true"] { color: var(--vak-fg, var(--_vak-fg)); border-bottom-color: var(--vak-accent, var(--_vak-accent)); }

/* ---- content --------------------------------------------------------- */
.card {
  position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius));
  box-shadow: var(--vak-shadow, var(--_vak-shadow)); transition: border-color 160ms ease;
}
/* Informational cards stay still; hover feedback belongs to their controls. */
.card > img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: var(--vak-surface-2, var(--_vak-surface-2)); }
.card .body { display: flex; flex-direction: column; gap: var(--gap-sm); padding: var(--vak-card-padding, var(--_vak-card-padding)); flex: 1; }
.card .head { display: flex; align-items: flex-start; gap: 10px; justify-content: space-between; }
.card h3 { margin: 0; font-size: 1em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); letter-spacing: -0.01em; line-height: 1.3; }
.card .sub { margin: 2px 0 0; color: var(--vak-muted, var(--_vak-muted)); font-size: 0.9em; }
.card .md { color: var(--vak-fg, var(--_vak-fg)); font-size: 0.95em; }
.card .kids { display: flex; flex-direction: column; align-items: flex-start; gap: var(--gap-sm); margin-top: auto; }
.card .kids > :not(.btn) { align-self: stretch; }
.card.tone-info { border-top: 3px solid var(--vak-info, var(--_vak-info)); }
.card.tone-success { border-top: 3px solid var(--vak-success, var(--_vak-success)); }
.card.tone-warning { border-top: 3px solid var(--vak-warning, var(--_vak-warning)); }
.card.tone-danger { border-top: 3px solid var(--vak-danger, var(--_vak-danger)); }
.badge {
  flex: none; font-size: 0.74em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); letter-spacing: 0.02em; padding: 3px 9px; border-radius: 999px;
  background: var(--vak-accent-soft, var(--_vak-accent-soft)); color: var(--vak-accent, var(--_vak-accent)); white-space: nowrap;
}

.text.heading { font-size: 1.2em; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); letter-spacing: -0.02em; line-height: 1.25; }
.text.subheading { font-size: 1em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.text.caption { font-size: 0.85em; color: var(--vak-muted, var(--_vak-muted)); }
.text.code { font-family: var(--vak-mono, var(--_vak-mono)); font-size: 0.9em; }

.stat {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  padding: var(--vak-card-padding, var(--_vak-card-padding)); background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius));
}
.card .stat { padding: 0; border: 0; background: none; }
.stat .label { color: var(--vak-muted, var(--_vak-muted)); font-size: 0.86em; font-weight: var(--vak-weight-label, var(--_vak-weight-label)); }
.stat .value { font-size: 1.55em; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.15; overflow-wrap: anywhere; }
.card .stat .value { font-size: 1.2em; }
.stat .delta { font-size: 0.86em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); color: var(--vak-muted, var(--_vak-muted)); }
.stat .delta.up { color: var(--vak-success, var(--_vak-success)); } .stat .delta.down { color: var(--vak-danger, var(--_vak-danger)); }

.alert {
  display: flex; gap: 12px; padding: 12px 14px; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm));
  background: var(--vak-surface-2, var(--_vak-surface-2)); border: 1px solid var(--vak-border, var(--_vak-border)); border-left: 4px solid var(--vak-muted, var(--_vak-muted));
}
.alert.tone-info { border-left-color: var(--vak-info, var(--_vak-info)); }
.alert.tone-success { border-left-color: var(--vak-success, var(--_vak-success)); }
.alert.tone-warning { border-left-color: var(--vak-warning, var(--_vak-warning)); }
.alert.tone-danger { border-left-color: var(--vak-danger, var(--_vak-danger)); }
.alert strong { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); display: block; margin-bottom: 2px; }

.list { margin: 0; padding-left: 1.25em; display: flex; flex-direction: column; gap: 4px; }
.image { display: block; max-width: 100%; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); }
hr.divider { border: 0; border-top: 1px solid var(--vak-border, var(--_vak-border)); margin: 4px 0; width: 100%; }

/* table → stacked rows on narrow containers */
.table-box { container-type: inline-size; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); background: var(--vak-surface, var(--_vak-surface)); overflow: hidden; }
.table-scroll { overflow-x: auto; }
/* Local interactions: filter, sort, page (no model turn). */
.filter { display: block; width: calc(100% - 16px); margin: 8px; font: inherit; font-size: 0.88em; color: var(--vak-fg, var(--_vak-fg)); background: var(--vak-bg, var(--_vak-bg)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); padding: 6px 10px; }
.list-box > .filter, .grid-box > .filter { width: 100%; margin: 0 0 var(--gap-sm); }
.filter:focus { outline: 2px solid var(--vak-accent, var(--_vak-accent)); outline-offset: -1px; }
th .sort { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
th .sort::after { content: "↕"; opacity: 0.35; font-size: 0.9em; }
th[aria-sort="ascending"] .sort::after { content: "↑"; opacity: 1; }
th[aria-sort="descending"] .sort::after { content: "↓"; opacity: 1; }
th .sort:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); border-radius: 4px; }
tfoot .totals td { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); border-top: 2px solid var(--vak-border, var(--_vak-border)); border-bottom: 0; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 6px 10px; font-size: 0.82em; color: var(--vak-muted, var(--_vak-muted)); border-top: 1px solid var(--vak-border, var(--_vak-border)); }
.pager[hidden] { display: none; }
.pager .page { font: inherit; width: 28px; height: 26px; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: 6px; background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg)); cursor: pointer; }
.pager .page:disabled { opacity: 0.4; cursor: default; }
.none { color: var(--vak-muted, var(--_vak-muted)); font-style: italic; }
/* timeline, steps, code, places, gallery */
.timeline { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--vak-border, var(--_vak-border)); display: flex; flex-direction: column; gap: var(--gap-md); }
.timeline li { position: relative; }
.timeline li::before { content: ""; position: absolute; left: -24px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: var(--vak-accent, var(--_vak-accent)); box-shadow: 0 0 0 3px var(--vak-surface, var(--_vak-surface)); }
.tl-date { font-size: 0.78em; color: var(--vak-muted, var(--_vak-muted)); font-variant-numeric: tabular-nums; }
.tl-title { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.step { display: flex; gap: 12px; padding: 8px 0; }
.step-mark { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 0.8em; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); border: 2px solid var(--vak-border, var(--_vak-border)); color: var(--vak-muted, var(--_vak-muted)); }
.step.done .step-mark { background: var(--vak-success, var(--_vak-success)); border-color: var(--vak-success, var(--_vak-success)); color: var(--vak-surface, var(--_vak-surface)); }
.step.current .step-mark { border-color: var(--vak-accent, var(--_vak-accent)); color: var(--vak-accent, var(--_vak-accent)); }
.step.failed .step-mark { border-color: var(--vak-danger, var(--_vak-danger)); color: var(--vak-danger, var(--_vak-danger)); }
.step.skipped .step-title { text-decoration: line-through; color: var(--vak-muted, var(--_vak-muted)); }
.step-title { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.step.todo .step-title { color: var(--vak-muted, var(--_vak-muted)); font-weight: 500; }
.code-box { border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); overflow: hidden; background: var(--vak-surface-2, var(--_vak-surface-2)); }
.code-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; font-size: 0.78em; color: var(--vak-muted, var(--_vak-muted)); border-bottom: 1px solid var(--vak-border, var(--_vak-border)); }
.code-copy { font: inherit; border: 1px solid var(--vak-border, var(--_vak-border)); background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg)); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
pre.code { margin: 0; padding: 12px; overflow-x: auto; font: 0.85em/1.5 var(--vak-mono, var(--_vak-mono)); }
.places { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); background: var(--vak-surface, var(--_vak-surface)); }
.place { display: flex; gap: 12px; align-items: center; padding: 10px 14px; }
.place + .place { border-top: 1px solid var(--vak-border, var(--_vak-border)); }
.place > div { flex: 1; min-width: 0; }
.place-pin { color: var(--vak-accent, var(--_vak-accent)); font-size: 1.1em; }
.place-name { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.place-addr, .place-note { font-size: 0.85em; color: var(--vak-muted, var(--_vak-muted)); }
.place-open { font-size: 0.82em; color: var(--vak-accent, var(--_vak-accent)); white-space: nowrap; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--gap-sm); }
.gallery figure { margin: 0; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); overflow: hidden; background: var(--vak-surface-2, var(--_vak-surface-2)); }
.gallery img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.gallery figcaption { font-size: 0.8em; color: var(--vak-muted, var(--_vak-muted)); padding: 6px 8px; }
table { width: 100%; border-collapse: collapse; font-size: 0.93em; font-variant-numeric: tabular-nums; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--vak-border, var(--_vak-border)); vertical-align: top; }
th { font-size: 0.86em; color: var(--vak-muted, var(--_vak-muted)); font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); background: var(--vak-surface-2, var(--_vak-surface-2)); }
tr:last-child td { border-bottom: 0; }
.a-end { text-align: right; } .a-center { text-align: center; }
@container (max-width: 520px) {
  table, tbody, tr, td { display: block; width: 100%; }
  thead { display: none; }
  tr { padding: 10px 14px; border-bottom: 1px solid var(--vak-border, var(--_vak-border)); }
  tr:last-child { border-bottom: 0; }
  td { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border: 0; text-align: right; }
  td::before { content: attr(data-label); color: var(--vak-muted, var(--_vak-muted)); font-size: 0.85em; text-align: left; }
}

.chart-box { width: 100%; max-width: var(--vak-chart-max-width, 720px); min-width: 0; }
.chart-box.measure-sm { max-width: 320px; }
.chart-box.measure-lg { max-width: 1040px; }
.chart-box.measure-full { max-width: none; }
.chart { margin: 0; padding: 14px 14px 10px; background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); min-width: 0; }
.card .chart { padding: 0; border: 0; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart svg.pie { aspect-ratio: 1; max-width: 240px; margin: 0 auto; }
.chart .gridline { stroke: var(--vak-border, var(--_vak-border)); stroke-width: 1; vector-effect: non-scaling-stroke; }
.chart .axis { fill: var(--vak-muted, var(--_vak-muted)); font-size: 11px; font-family: var(--vak-font, var(--_vak-font)); }
.graph { margin: 0; padding: 14px; background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); min-width: 0; }
.card .graph { padding: 0; border: 0; }
.graph-tools { display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin-bottom: 8px; }
.graph-btn { font: inherit; font-size: 0.82em; min-width: 30px; min-height: var(--vak-control-height, var(--_vak-control-height)); padding: 0 8px; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: 7px; background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg)); cursor: pointer; }
.graph-btn:hover { border-color: var(--vak-muted, var(--_vak-muted)); }
.graph-find { font: inherit; font-size: 0.84em; min-height: var(--vak-control-height, var(--_vak-control-height)); flex: 1; max-width: 240px; margin-right: auto; padding: 0 8px; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: 7px; background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg)); }
.graph-frame { position: relative; height: clamp(200px, var(--graph-h, 320px), 70vh); border-radius: calc(var(--vak-radius, var(--_vak-radius)) - 4px); background: color-mix(in srgb, var(--vak-border, var(--_vak-border)) 22%, var(--vak-surface, var(--_vak-surface))); overflow: hidden; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.graph-frame.dragging { cursor: grabbing; }
.graph-frame:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); outline-offset: 2px; }
.graph-frame svg { display: block; width: 100%; height: 100%; font-family: var(--vak-font, var(--_vak-font)); }
.graph .dim { opacity: 0.22; }
.graph-node.match rect { stroke: var(--vak-accent, var(--_vak-accent)); stroke-width: 3; }
.graph-edge { stroke: var(--vak-muted, var(--_vak-muted)); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.graph-arrow { fill: var(--vak-muted, var(--_vak-muted)); }
.graph-edge-label { font-size: 11px; fill: var(--vak-muted, var(--_vak-muted)); paint-order: stroke; stroke: var(--vak-surface, var(--_vak-surface)); stroke-width: 4px; stroke-linejoin: round; }
.graph-node { cursor: pointer; outline: none; transition: opacity 0.15s; }
.graph-node rect { --node: var(--vak-accent, var(--_vak-accent)); fill: color-mix(in srgb, var(--node) 14%, var(--vak-surface, var(--_vak-surface))); stroke: var(--node); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.graph-node text { font-size: 12.5px; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); fill: var(--vak-fg, var(--_vak-fg)); pointer-events: none; }
.graph-node:hover rect, .graph-node.selected rect { stroke-width: 2.5; fill: color-mix(in srgb, var(--node) 26%, var(--vak-surface, var(--_vak-surface))); }
.graph-node:focus-visible rect { stroke-width: 3; }
.graph-detail { margin-top: 10px; font-size: 0.88em; color: var(--vak-muted, var(--_vak-muted)); text-align: center; }
.graph-detail b { color: var(--vak-fg, var(--_vak-fg)); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 0.84em; color: var(--vak-muted, var(--_vak-muted)); justify-content: center; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

/* ---- everyday components --------------------------------------------- */
.w-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.w-muted { color: var(--vak-muted, var(--_vak-muted)); font-size: 0.88em; margin: 4px 0; }
.w-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; }
.w-btn, .w-seg button { font: inherit; font-size: 0.84em; min-width: 32px; min-height: var(--vak-control-height, var(--_vak-control-height)); padding: 0 10px; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: 8px; background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg)); cursor: pointer; }
.w-btn:hover, .w-seg button:hover { border-color: var(--vak-muted, var(--_vak-muted)); }
.w-btn:focus-visible, .w-seg button:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); outline-offset: 1px; }
.w-seg { display: inline-flex; margin-left: auto; }
.w-seg button { border-radius: 0; margin-left: -1px; }
.w-seg button:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
.w-seg button:last-child { border-radius: 0 8px 8px 0; }
.w-seg button[aria-pressed="true"] { background: var(--vak-accent-soft, var(--_vak-accent-soft)); border-color: var(--vak-accent, var(--_vak-accent)); color: var(--vak-accent, var(--_vak-accent)); position: relative; }
.cal, .board, .prog, .acc, .cmp, .timer, .tree-box, .diff, .gantt, .math { min-width: 0; }
.cal, .tree-box, .gantt, .timer, .prog, .math:not(.inline) { padding: 14px; background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); }
.card :is(.cal, .tree-box, .gantt, .timer, .prog, .math) { padding: 0; border: 0; }
.cal-title { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); padding: 0 4px; }
.cal-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--vak-border, var(--_vak-border)); border-left: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); overflow: hidden; }
.cal-wd { font-size: 0.75em; color: var(--vak-muted, var(--_vak-muted)); padding: 4px 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.cal-month .cal-wd { border-right: 1px solid var(--vak-border, var(--_vak-border)); border-bottom: 1px solid var(--vak-border, var(--_vak-border)); background: var(--vak-surface-2, var(--_vak-surface-2)); }
.cal-cell { position: relative; min-height: 84px; padding: 4px; border-right: 1px solid var(--vak-border, var(--_vak-border)); border-bottom: 1px solid var(--vak-border, var(--_vak-border)); cursor: pointer; outline: none; min-width: 0; }
.cal-cell.out { background: color-mix(in srgb, var(--vak-surface-2, var(--_vak-surface-2)) 60%, transparent); color: var(--vak-muted, var(--_vak-muted)); }
.cal-cell:hover { background: var(--vak-surface-2, var(--_vak-surface-2)); }
.cal-cell:focus-visible { box-shadow: inset 0 0 0 2px var(--vak-accent, var(--_vak-accent)); }
.cal-cell.picked { background: var(--vak-accent-soft, var(--_vak-accent-soft)); }
.cal-num { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 12px; font-size: 0.82em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.cal-cell.today .cal-num { background: var(--vak-accent, var(--_vak-accent)); color: var(--vak-accent-fg, var(--_vak-accent-fg)); }
.cal-evs { display: grid; gap: 2px; }
.cal-ev { display: flex; gap: 6px; align-items: baseline; padding: 2px 6px; border-radius: 6px; font-size: 0.78em; background: var(--vak-accent-soft, var(--_vak-accent-soft)); border-left: 3px solid var(--vak-accent, var(--_vak-accent)); overflow: hidden; }
.cal-ev-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-ev.t-success { border-left-color: var(--vak-success, var(--_vak-success)); } .cal-ev.t-warning { border-left-color: var(--vak-warning, var(--_vak-warning)); } .cal-ev.t-danger { border-left-color: var(--vak-danger, var(--_vak-danger)); } .cal-ev.t-info { border-left-color: var(--vak-info, var(--_vak-info)); }
.cal-time { color: var(--vak-muted, var(--_vak-muted)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cal-more { font-size: 0.74em; color: var(--vak-muted, var(--_vak-muted)); padding-left: 6px; }
.cal-dot { display: none; }
.cal-day-list { margin-top: 12px; display: grid; gap: 6px; }
.cal-day-list h4 { margin: 0; font-size: 0.92em; }
.cal-day-list .cal-ev { font-size: 0.88em; padding: 6px 10px; flex-wrap: wrap; }
.cal-day-list .cal-ev-title { white-space: normal; }
.cal-note { flex-basis: 100%; color: var(--vak-muted, var(--_vak-muted)); font-size: 0.82em; }
.cal-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.cal-wcol { display: grid; align-content: start; gap: 4px; min-height: 120px; padding: 4px; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); background: var(--vak-surface-2, var(--_vak-surface-2)); }
.cal-wcol.today { box-shadow: inset 0 0 0 2px var(--vak-accent, var(--_vak-accent)); }
.cal-wcol .cal-ev { flex-wrap: wrap; }
.cal-wcol .cal-ev-title { white-space: normal; }
@container vak-surface (max-width: 560px) {
  .cal-cell { min-height: 48px; text-align: center; }
  .cal-evs { display: none; }
  .cal-dot { display: block; width: 6px; height: 6px; border-radius: 3px; margin: 2px auto 0; background: var(--vak-accent, var(--_vak-accent)); }
  .cal-week { grid-template-columns: 1fr; }
  .cal-wcol { min-height: 0; }
  .w-seg { margin-left: 0; }
}
.board-lanes { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x proximity; }
.board-col { display: flex; flex-direction: column; min-width: 0; background: var(--vak-surface-2, var(--_vak-surface-2)); border-radius: var(--vak-radius, var(--_vak-radius)); padding: 10px; scroll-snap-align: start; }
.board-head { display: flex; justify-content: space-between; align-items: center; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); font-size: 0.9em; margin-bottom: 8px; }
.board-count { font-size: 0.78em; color: var(--vak-muted, var(--_vak-muted)); background: var(--vak-surface, var(--_vak-surface)); border-radius: 10px; padding: 1px 8px; }
.board-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; align-content: start; flex: 1; min-height: 48px; }
.board-card { background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); padding: 10px 12px; box-shadow: var(--vak-shadow, var(--_vak-shadow)); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
.board-card:hover { box-shadow: var(--vak-shadow-hover, var(--_vak-shadow-hover)); }
.board-card:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); outline-offset: 1px; }
.board-card.grabbed { outline: 2px dashed var(--vak-accent, var(--_vak-accent)); transform: rotate(-1deg); }
.board-card.dragging { opacity: 0.35; }
.board-title { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); font-size: 0.92em; }
.board-note { color: var(--vak-muted, var(--_vak-muted)); font-size: 0.84em; margin-top: 2px; }
.board-tag { display: inline-block; margin-top: 6px; font-size: 0.74em; padding: 1px 8px; border-radius: 10px; background: var(--vak-accent-soft, var(--_vak-accent-soft)); color: var(--vak-accent, var(--_vak-accent)); }
.board-empty { color: var(--vak-muted, var(--_vak-muted)); font-size: 0.82em; text-align: center; padding: 12px; border: 1.5px dashed var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); }
.board-marker { height: 4px; border-radius: 2px; background: var(--vak-accent, var(--_vak-accent)); }
.board-ghost { position: fixed; left: 0; top: 0; z-index: 10; pointer-events: none; box-shadow: var(--vak-shadow-hover, var(--_vak-shadow-hover)); opacity: 0.95; }
.prog-head { display: flex; justify-content: space-between; gap: 10px; font-size: 0.9em; margin-bottom: 6px; }
.prog-label { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.prog-val { color: var(--vak-muted, var(--_vak-muted)); font-variant-numeric: tabular-nums; font-size: 0.88em; }
.prog { --tone: var(--vak-accent, var(--_vak-accent)); }
.prog.t-success { --tone: var(--vak-success, var(--_vak-success)); } .prog.t-warning { --tone: var(--vak-warning, var(--_vak-warning)); } .prog.t-danger { --tone: var(--vak-danger, var(--_vak-danger)); } .prog.t-info { --tone: var(--vak-info, var(--_vak-info)); }
.prog-track { height: 10px; border-radius: 5px; background: var(--vak-surface-2, var(--_vak-surface-2)); overflow: hidden; }
.prog-fill { height: 100%; border-radius: 5px; background: var(--tone); transition: width 0.4s ease; }
.prog-dial { display: block; width: 100%; max-width: 180px; margin: 0 auto; }
.prog-bg { fill: none; stroke: var(--vak-surface-2, var(--_vak-surface-2)); stroke-width: 12; stroke-linecap: round; }
.prog-arc { fill: none; stroke: var(--tone, var(--vak-accent, var(--_vak-accent))); stroke-width: 12; stroke-linecap: round; transition: stroke-dasharray 0.4s ease; }
.prog-pct { font-size: 22px; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); fill: var(--vak-fg, var(--_vak-fg)); font-family: var(--vak-font, var(--_vak-font)); }
.prog:is(.k-ring, .k-gauge) .prog-val { text-align: center; }
.prog-stars { display: inline-flex; gap: 2px; font-size: 1.4em; margin-right: 8px; vertical-align: middle; }
.prog-stars .star, .stars-in .star { color: transparent; background: linear-gradient(90deg, var(--vak-warning, var(--_vak-warning)) var(--fill, 0%), var(--vak-border, var(--_vak-border)) var(--fill, 0%)); -webkit-background-clip: text; background-clip: text; }
.stars-in { display: inline-flex; gap: 2px; }
.stars-in .star { font-size: 1.6em; line-height: 1; padding: 2px; border: 0; background-color: transparent; cursor: pointer; --fill: 0%; border-radius: 6px; }
.stars-in .star.on { --fill: 100%; }
.stars-in:hover .star { --fill: 100%; }
.stars-in .star:hover ~ .star { --fill: 0%; }
.stars-in .star:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); }
.range-in { display: flex; align-items: center; gap: 12px; }
.range-in input[type="range"] { flex: 1; accent-color: var(--vak-accent, var(--_vak-accent)); min-height: 32px; }
.range-val { min-width: 3.5em; text-align: end; font-variant-numeric: tabular-nums; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.file-in { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1.5px dashed var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); cursor: pointer; color: var(--vak-muted, var(--_vak-muted)); font-size: 0.9em; }
.file-in.over { border-color: var(--vak-accent, var(--_vak-accent)); background: var(--vak-accent-soft, var(--_vak-accent-soft)); }
.file-in input { max-width: 110px; font-size: 0.82em; }
.acc { display: grid; gap: 8px; }
.acc-tools { margin-bottom: 0; justify-content: flex-end; }
.acc-kids { display: contents; }
.acc-item { background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); }
.acc-item > summary { list-style: none; cursor: pointer; padding: 12px 14px; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); display: flex; justify-content: space-between; gap: 10px; min-height: 24px; }
.acc-item > summary::-webkit-details-marker { display: none; }
.acc-item > summary::after { content: "▾"; color: var(--vak-muted, var(--_vak-muted)); transition: transform 0.2s; }
.acc-item[open] > summary::after { transform: rotate(180deg); }
.acc-item > summary:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); outline-offset: -2px; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); }
.acc-item > :not(summary) { padding: 0 14px 12px; }
.acc-item > .section { border: 0; padding-top: 0; }
.cmp { display: grid; gap: 12px; }
.cmp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.cmp-card { position: relative; padding: 14px; background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); }
.cmp-card.best { border-color: var(--vak-success, var(--_vak-success)); }
.cmp-badge { position: absolute; top: -10px; right: 12px; font-size: 0.74em; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); padding: 2px 10px; border-radius: 10px; background: var(--vak-success, var(--_vak-success)); color: var(--vak-surface, var(--_vak-surface)); }
.cmp-card { display: flex; flex-direction: column; }
.cmp-card h4 { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); margin: 0 0 4px; font-size: 1em; }
/* Pick buttons line up at the bottom of cards of unequal length. */
.cmp-pick { margin-top: auto; align-self: flex-start; }
.cmp-card:has(> .cmp-pick) > :nth-last-child(2) { margin-bottom: 12px; }
.cmp-price { font-weight: var(--vak-weight-value, var(--_vak-weight-value)); font-size: 1.05em; margin-bottom: 6px; }
.cmp-pc { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; font-size: 0.88em; }
.cmp-pc li::before { display: inline-block; width: 1.3em; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); }
.cmp-pc .pro::before { content: "✓"; color: var(--vak-success, var(--_vak-success)); }
.cmp-pc .con::before { content: "✗"; color: var(--vak-danger, var(--_vak-danger)); }
.cmp-table td.best, .cmp-table th.best { background: color-mix(in srgb, var(--vak-success, var(--_vak-success)) 10%, transparent); }
.cmp-table tr.same td { color: var(--vak-muted, var(--_vak-muted)); }
.timer { display: grid; justify-items: center; gap: 10px; outline: none; }
.timer:focus-visible { box-shadow: 0 0 0 2px var(--vak-accent, var(--_vak-accent)); }
.timer-label { font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.timer-face { position: relative; width: min(200px, 60vw); aspect-ratio: 1; display: grid; place-items: center; }
.timer-ring { position: absolute; inset: 0; width: 100%; height: 100%; }
.timer-ring .prog-arc { stroke-width: 8; transition: none; }
.timer-ring .prog-bg { stroke-width: 8; }
.timer-digits { font-size: clamp(1.6em, 6cqi, 2.6em); font-weight: var(--vak-weight-value, var(--_vak-weight-value)); font-variant-numeric: tabular-nums; }
.m-countdown .timer-digits { font-size: clamp(1.3em, 5cqi, 2.1em); }
.timer.done .timer-digits { color: var(--vak-danger, var(--_vak-danger)); animation: vak-pulse 1s ease-in-out 3; }
.timer-tools { justify-content: center; margin: 0; }
.timer-laps { margin: 0; padding-left: 1.6em; font-variant-numeric: tabular-nums; color: var(--vak-muted, var(--_vak-muted)); font-size: 0.88em; columns: 2; }
@keyframes vak-pulse { 50% { opacity: 0.35; } }
.tree { list-style: none; margin: 0; padding: 0; font-size: 0.92em; }
.tree ul { list-style: none; margin: 0; padding: 0; }
.tree li[aria-expanded="false"] > ul { display: none; }
.tree li { outline: none; }
.tree-row { display: flex; align-items: baseline; gap: 6px; padding: 4px 8px 4px calc(8px + var(--depth) * 18px); border-radius: 6px; cursor: pointer; min-height: 24px; }
.tree-row:hover { background: var(--vak-surface-2, var(--_vak-surface-2)); }
.tree li:focus-visible > .tree-row { box-shadow: inset 0 0 0 2px var(--vak-accent, var(--_vak-accent)); }
.tree-twisty { width: 1em; text-align: center; font-weight: var(--vak-weight-value, var(--_vak-weight-value)); color: var(--vak-muted, var(--_vak-muted)); transition: transform 0.15s; flex: none; }
.tree li[aria-expanded="true"] > .tree-row .tree-twisty { transform: rotate(90deg); }
.tree-note { color: var(--vak-muted, var(--_vak-muted)); font-size: 0.82em; }
.math { margin: 0; overflow-x: auto; text-align: center; font-size: 1.05em; }
.math.inline { display: inline; padding: 0; font-size: inherit; }
.math figcaption { font-size: 0.84em; color: var(--vak-muted, var(--_vak-muted)); margin-top: 6px; }
.math-unknown { color: var(--vak-danger, var(--_vak-danger)); }
.diff { border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius)); overflow: hidden; background: var(--vak-surface, var(--_vak-surface)); }
.diff .code-bar { gap: 10px; }
.diff .w-seg { margin-left: auto; }
.diff-stat { font-size: 0.8em; color: var(--vak-muted, var(--_vak-muted)); font-family: var(--vak-mono, var(--_vak-mono)); }
.diff-scroll { overflow-x: auto; }
.diff-table { width: 100%; border-collapse: collapse; font: 0.82em/1.5 var(--vak-mono, var(--_vak-mono)); }
.diff-table td { padding: 0 8px; vertical-align: top; border: 0; white-space: pre; }
.diff-table td.no { width: 1%; color: var(--vak-muted, var(--_vak-muted)); text-align: end; user-select: none; -webkit-user-select: none; opacity: 0.7; }
.diff-table td.txt code { font: inherit; background: none; padding: 0; }
.diff-table .sig { display: inline-block; width: 1.2em; color: var(--vak-muted, var(--_vak-muted)); user-select: none; -webkit-user-select: none; }
.diff-table td.add { background: color-mix(in srgb, var(--vak-success, var(--_vak-success)) 12%, transparent); }
.diff-table td.del { background: color-mix(in srgb, var(--vak-danger, var(--_vak-danger)) 12%, transparent); }
.diff-table td.add mark { background: color-mix(in srgb, var(--vak-success, var(--_vak-success)) 32%, transparent); color: inherit; border-radius: 2px; }
.diff-table td.del mark { background: color-mix(in srgb, var(--vak-danger, var(--_vak-danger)) 32%, transparent); color: inherit; border-radius: 2px; }
.diff-table.v-split td.txt { width: 49%; }
.diff-table tr.hunk td, .diff-table tr.fold td { background: var(--vak-surface-2, var(--_vak-surface-2)); color: var(--vak-muted, var(--_vak-muted)); padding: 2px 8px; }
.diff-more { font: inherit; border: 0; background: none; color: var(--vak-accent, var(--_vak-accent)); cursor: pointer; padding: 2px 0; }
@container (max-width: 520px) {
  .diff-table { display: table; } .diff-table tbody { display: table-row-group; } .diff-table tr { display: table-row; padding: 0; }
  .diff-table td { display: table-cell; width: auto; text-align: left; padding: 0 8px; } .diff-table td::before { content: none; }
}
@container vak-surface (max-width: 560px) { .diff-table.v-split td.txt { white-space: pre-wrap; word-break: break-all; } }
.gantt-frame { display: grid; grid-template-columns: minmax(90px, 28%) 1fr; border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); overflow: hidden; outline: none; }
.gantt-frame:focus-visible { outline: 2px solid var(--vak-accent, var(--_vak-accent)); }
.gantt-names { border-right: 1px solid var(--vak-border, var(--_vak-border)); background: var(--vak-surface-2, var(--_vak-surface-2)); min-width: 0; }
.gantt-name { height: 34px; display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--vak-border, var(--_vak-border)); cursor: pointer; }
.gantt-name.head { height: 26px; cursor: default; }
.gantt-group { font-size: 0.72em; color: var(--vak-muted, var(--_vak-muted)); }
.gantt-track { overflow-x: auto; position: relative; touch-action: pan-x pan-y; cursor: grab; }
.gantt-track.dragging { cursor: grabbing; user-select: none; -webkit-user-select: none; }
.gantt-inner { position: relative; min-width: 100%; }
.gantt-scale { position: relative; height: 26px; border-bottom: 1px solid var(--vak-border, var(--_vak-border)); }
.gantt-tick { position: absolute; top: 0; bottom: 0; padding: 5px 4px; font-size: 0.72em; color: var(--vak-muted, var(--_vak-muted)); border-left: 1px solid var(--vak-border, var(--_vak-border)); white-space: nowrap; }
.gantt-tick.month { color: var(--vak-fg, var(--_vak-fg)); font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); }
.gantt-row { position: relative; height: 34px; border-bottom: 1px solid color-mix(in srgb, var(--vak-border, var(--_vak-border)) 60%, transparent); }
.gantt-bar { position: absolute; top: 7px; height: 20px; border-radius: 6px; background: color-mix(in srgb, var(--c) 30%, var(--vak-surface, var(--_vak-surface))); border: 1.5px solid var(--c); overflow: hidden; outline: none; }
.gantt-bar:focus-visible { box-shadow: 0 0 0 2px var(--vak-accent, var(--_vak-accent)); }
.gantt-bar.milestone { width: 14px; height: 14px; top: 10px; border-radius: 2px; transform: translateX(-7px) rotate(45deg); background: var(--c); }
.gantt-done { position: absolute; inset: 0 auto 0 0; background: var(--c); opacity: 0.55; }
.gantt-bar-label { position: relative; padding: 0 6px; font-size: 0.74em; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); line-height: 17px; white-space: nowrap; }
.gantt-today { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--vak-danger, var(--_vak-danger)); opacity: 0.7; z-index: 1; pointer-events: none; }
.chart svg.radar { max-width: 360px; margin: 0 auto; }
.chart svg.heat { max-width: 100%; height: auto; }
.heat-v { font-size: 10.5px; fill: var(--vak-fg, var(--_vak-fg)); font-family: var(--vak-font, var(--_vak-font)); pointer-events: none; }
.heat-v.on { fill: var(--vak-accent-fg, var(--_vak-accent-fg)); }
@media (prefers-reduced-motion: reduce) { .prog-fill, .prog-arc, .tree-twisty, .acc-item > summary::after { transition: none; } .timer.done .timer-digits { animation: none; } }

/* ---- interaction ----------------------------------------------------- */
.btn {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-weight: var(--vak-weight-heading, var(--_vak-weight-heading)); font-size: 0.92em; line-height: 1.3; padding: 7px 12px; min-height: var(--vak-control-height, var(--_vak-control-height));
  border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); border: 1px solid var(--vak-border, var(--_vak-border)); background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg));
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
}
.btn:hover { background: var(--vak-surface-2, var(--_vak-surface-2)); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, .chip:focus-visible, .seg button:focus-visible {
  outline: 2px solid var(--vak-accent, var(--_vak-accent)); outline-offset: 2px;
}
.btn.primary { background: var(--vak-accent, var(--_vak-accent)); border-color: var(--vak-accent, var(--_vak-accent)); color: var(--vak-accent-fg, var(--_vak-accent-fg)); }
.btn.primary:hover { filter: brightness(1.08); background: var(--vak-accent, var(--_vak-accent)); }
.btn.danger { color: var(--vak-danger, var(--_vak-danger)); }
.btn.link { border-color: transparent; background: none; color: var(--vak-accent, var(--_vak-accent)); padding-inline: 4px; }
.btn[disabled] { opacity: 0.55; cursor: progress; }

.form {
  display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0;
  padding: var(--vak-card-padding, var(--_vak-card-padding)); background: var(--vak-surface, var(--_vak-surface)); border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius, var(--_vak-radius));
}
.card .form { padding: 0; border: 0; background: none; }
.form-box { container-type: inline-size; }
.fields { display: grid; gap: 14px 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
.fields > .wide { grid-column: 1 / -1; }
.form .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
@container (max-width: 420px) { .form .actions .btn { flex: 1; } }

.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field > label, .field > .label { font-size: 0.9em; font-weight: var(--vak-weight-label, var(--_vak-weight-label)); color: var(--vak-fg, var(--_vak-fg)); }
.field .req { color: var(--vak-danger, var(--_vak-danger)); margin-left: 2px; }
input, select, textarea {
  font: inherit; color: var(--vak-fg, var(--_vak-fg)); background: var(--vak-surface, var(--_vak-surface)); width: 100%;
  border: 1px solid var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm)); padding: 7px 10px; min-height: var(--vak-control-height, var(--_vak-control-height));
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
input:hover, select:hover, textarea:hover { border-color: color-mix(in srgb, var(--vak-muted, var(--_vak-muted)) 45%, var(--vak-border, var(--_vak-border))); }
textarea { min-height: 92px; resize: vertical; }
.field.invalid :is(input, select, textarea) { border-color: var(--vak-danger, var(--_vak-danger)); }
.field .err { color: var(--vak-danger, var(--_vak-danger)); font-size: 0.82em; }
.range { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; color: var(--vak-muted, var(--_vak-muted)); }
.check { display: flex; align-items: center; gap: 10px; font-weight: 500; cursor: pointer; }
.check input { width: 18px; height: 18px; min-height: 0; accent-color: var(--vak-accent, var(--_vak-accent)); }

.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg button, .chip {
  appearance: none; font: inherit; font-size: 0.9em; font-weight: var(--vak-weight-label, var(--_vak-weight-label)); padding: 7px 12px; border-radius: var(--vak-radius-sm, var(--_vak-radius-sm));
  border: 1px solid var(--vak-border, var(--_vak-border)); background: var(--vak-surface, var(--_vak-surface)); color: var(--vak-fg, var(--_vak-fg)); cursor: pointer;
}
.seg button[aria-pressed="true"], .chip[aria-pressed="true"] { background: var(--vak-accent-soft, var(--_vak-accent-soft)); border-color: var(--vak-accent, var(--_vak-accent)); color: var(--vak-accent, var(--_vak-accent)); }

@media (pointer: coarse) {
  .btn, .w-btn, .w-seg button, .seg button, .chip, .tablist button,
  .code-copy, .graph-btn, .pager .page, .diff-more, .place-open {
    min-height: max(44px, var(--vak-control-height, var(--_vak-control-height)));
  }
  .pager .page { min-width: 44px; }
}

/* ---- streaming + errors ---------------------------------------------- */
.pending {
  min-height: 64px; border-radius: var(--vak-radius, var(--_vak-radius));
  background: linear-gradient(90deg, var(--vak-surface-2, var(--_vak-surface-2)) 0%, var(--vak-surface, var(--_vak-surface)) 50%, var(--vak-surface-2, var(--_vak-surface-2)) 100%) 0 0 / 200% 100%;
  animation: shimmer 1.2s linear infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .pending { animation: none; } .card { transition: none; } }
.invalid-node {
  padding: 10px 12px; border: 1px dashed var(--vak-border, var(--_vak-border)); border-radius: var(--vak-radius-sm, var(--_vak-radius-sm));
  color: var(--vak-muted, var(--_vak-muted)); font-size: 0.85em;
}
.enter { animation: enter 220ms ease both; }
@keyframes enter { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .enter { animation: none; } }
`;
