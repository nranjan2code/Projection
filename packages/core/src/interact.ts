// Interactions a projector runs on its own, with no model turn: sorting,
// filtering and paging a table or list, and computed totals. Sorting a table
// used to cost a round trip to the model (about 24 s on the local 4B model)
// and could come back wrong; arithmetic in a totals row often did. These are
// shared here so every projector sorts, filters and sums the same way.

/** A cell read for comparison: a number when the text is one ("$1,299", "12.5%", "1.2k", "-3"), else a date, else text. */
export type CellValue = { kind: "number"; n: number } | { kind: "date"; t: number } | { kind: "text"; s: string } | { kind: "empty" };

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, t: 1e12 };

export function cellValue(v: unknown): CellValue {
  if (v === null || v === undefined || v === "") return { kind: "empty" };
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "number", n: v } : { kind: "empty" };
  if (typeof v === "boolean") return { kind: "number", n: v ? 1 : 0 };
  const s = String(v).trim();
  // Currency and unit signs around a number: "$1,299.00", "€ 12", "12.5%", "1.2k", "(45)".
  const m = /^\(?([-+−]?)\s*[$€£¥₹]?\s*([-+−]?)(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:(k|m|bn|b|t)(?![a-z]))?\s*(%|[a-z/]{1,6})?\)?$/i.exec(s);
  if (m) {
    const neg = (m[1] || m[2]) === "-" || (m[1] || m[2]) === "−" || (s.startsWith("(") && s.endsWith(")"));
    const n = Number(m[3]!.replace(/,/g, "")) * (SUFFIX[(m[4] ?? "").toLowerCase()] ?? 1);
    if (Number.isFinite(n)) return { kind: "number", n: neg ? -n : n };
  }
  // ISO dates and "Nov 3, 2026" style; a bare year stays a number above.
  if (/\d{4}-\d{2}-\d{2}|[a-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [a-z]{3,9}\.? \d{4}/i.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return { kind: "date", t };
  }
  return { kind: "text", s: s.toLowerCase() };
}

const RANK: Record<CellValue["kind"], number> = { number: 0, date: 1, text: 2, empty: 3 };

/** Numbers by value, dates by time, text in locale order; empty cells last whichever way. */
export function compareCells(a: unknown, b: unknown): number {
  const x = cellValue(a);
  const y = cellValue(b);
  if (x.kind !== y.kind) return RANK[x.kind] - RANK[y.kind];
  if (x.kind === "number" && y.kind === "number") return x.n - y.n;
  if (x.kind === "date" && y.kind === "date") return x.t - y.t;
  if (x.kind === "text" && y.kind === "text") return x.s.localeCompare(y.s, undefined, { numeric: true });
  return 0;
}

export type Row = Record<string, unknown> | unknown[];
export interface Column {
  key: string;
  label?: string;
}

export function cell(row: unknown, col: Column, index: number): unknown {
  return Array.isArray(row) ? row[index] : row && typeof row === "object" ? (row as Record<string, unknown>)[col.key] : row;
}

/** Rows sorted by one column; a stable sort, so equal rows keep the model's order. */
export function sortRows<T>(rows: T[], cols: Column[], key: string, dir: "asc" | "desc"): T[] {
  const i = cols.findIndex((c) => c.key === key);
  if (i < 0) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, at) => ({ r, at }))
    .sort((a, b) => {
      const x = cell(a.r, cols[i]!, i);
      const y = cell(b.r, cols[i]!, i);
      const ex = cellValue(x).kind === "empty";
      const ey = cellValue(y).kind === "empty";
      if (ex || ey) return ex === ey ? a.at - b.at : ex ? 1 : -1;
      return sign * compareCells(x, y) || a.at - b.at;
    })
    .map((x) => x.r);
}

/** Rows where every word of the query appears in some shown cell (case-insensitive). */
export function filterRows<T>(rows: T[], cols: Column[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const text = cols.map((c, i) => String(cell(r, c, i) ?? "")).join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export function filterItems(items: unknown[], query: string): unknown[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? items.filter((it) => words.every((w) => String(it ?? "").toLowerCase().includes(w))) : items;
}

export function pageRows<T>(rows: T[], page: number, size: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(p * size, (p + 1) * size), page: p, pages };
}

/**
 * When a projector offers each interaction without being asked: sorting for
 * any table worth sorting, a filter once scanning by eye gets slow, paging
 * once a table no longer fits. An explicit prop (sortable, searchable,
 * pageSize) always wins.
 */
export const INTERACT = { sortFrom: 2, searchTableFrom: 8, searchListFrom: 12, searchItemsFrom: 8, pageOver: 25, pageSize: 20 } as const;

export interface TableInteraction {
  sortable: boolean;
  searchable: boolean;
  /** 0: no paging. */
  pageSize: number;
}

export function tableInteraction(props: Record<string, unknown>, rowCount: number): TableInteraction {
  const flag = (v: unknown, auto: boolean) => (typeof v === "boolean" ? v : auto);
  const size = Number(props.pageSize);
  return {
    sortable: flag(props.sortable, rowCount >= INTERACT.sortFrom),
    searchable: flag(props.searchable, rowCount >= INTERACT.searchTableFrom),
    pageSize: Number.isFinite(size) && size > 0 ? Math.floor(size) : size === 0 ? 0 : rowCount > INTERACT.pageOver ? INTERACT.pageSize : 0,
  };
}

/**
 * A totals row: the sum of each column whose cells are all numbers (not
 * percentages), written
 * in the column's own format ("$", "%", decimals, thousands separators) and
 * labelled in the first text column. Undefined when no column sums.
 */
export function totalsRow(rows: Row[], cols: Column[]): Record<string, unknown> | undefined {
  if (!rows.length) return undefined;
  const out: Record<string, unknown> = {};
  let summed = false;
  cols.forEach((c, i) => {
    // The first column names the rows (a label, a year, an id): it says "Total", it is never summed.
    if (i === 0 && cols.length > 1) return;
    const cells = rows.map((r) => cell(r, c, i)).filter((v) => cellValue(v).kind !== "empty");
    const values = cells.map(cellValue);
    if (!cells.length || values.some((v) => v.kind !== "number")) return;
    // Percentages are rates as often as shares: a sum of growth rates means
    // nothing (a 30-city table summed to 199%), so they get no total.
    if (cells.some((v) => /%\s*\)?$/.test(String(v)))) return;
    const total = values.reduce((sum, v) => sum + (v as { n: number }).n, 0);
    out[c.key] = formatLike(cells[0], total);
    summed = true;
  });
  if (!summed) return undefined;
  out[cols[0]!.key] ??= "Total";
  return out;
}

/** A number written the way `sample` was: same currency sign, percent, decimals, separators. */
export function formatLike(sample: unknown, n: number): unknown {
  if (typeof sample === "number") return Math.round(n * 1e6) / 1e6;
  const s = String(sample).trim();
  const prefix = /^[-+−]?\s*([$€£¥₹])/.exec(s)?.[1] ?? "";
  const pct = /%\s*\)?$/.test(s) ? "%" : "";
  // "1.2k" sums as thousands and is written in thousands.
  const unit = /\d\s*(k|m|bn|b|t)(?![a-z])/i.exec(s)?.[1] ?? "";
  const scaled = unit ? n / (SUFFIX[unit.toLowerCase()] ?? 1) : n;
  const decimals = /\.(\d+)/.exec(s)?.[1]?.length ?? 0;
  const grouped = /\d,\d{3}/.test(s);
  const body = Math.abs(scaled).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
  return `${n < 0 ? "-" : ""}${prefix}${body}${unit}${pct}`;
}
