// Everyday components drawn natively: calendar, board, progress, accordion,
// compare, timer, tree, diff and gantt. Each takes canonical props (the
// catalog's finalize) and a per-node state object the element keeps across
// rebuilds, so a view the user moved to (a month, an open branch, a running
// timer) survives the model streaming more of the surface. Dependency-free.

import { clockText, dayLabel, diffOf } from "@vak/core";

export interface WidgetCtx {
  /** Kept per node key across rebuilds. */
  state: Record<string, unknown>;
  /** Write a value at the node's bind path (board moves); absent when unbound. */
  set?: (value: unknown) => void;
}

type Rec = Record<string, unknown>;
const NS = "http://www.w3.org/2000/svg";
const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const recs = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is Rec => !!x && typeof x === "object");

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function btn(text: string, label?: string, cls = "w-btn"): HTMLButtonElement {
  const b = h("button", cls, text);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  return b;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
/** Polite announcements for screen readers (moves, timers). */
function live(): HTMLElement {
  const el = h("div", "w-live");
  el.setAttribute("aria-live", "polite");
  return el;
}

// --- dates (ISO strings, UTC arithmetic so a day never shifts) -------------

const DAY = 86_400_000;
const toT = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(toT(iso) + n * DAY);
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const weekStart = (iso: string) => addDays(iso, -((new Date(toT(iso)).getUTCDay() + 6) % 7));
const monthName = (iso: string) => new Date(toT(iso)).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// --- calendar --------------------------------------------------------------

export function renderCalendar(p: Rec, ctx: WidgetCtx): HTMLElement {
  const events = recs(p.events);
  const st = ctx.state as { view?: string; cursor?: string; picked?: string };
  st.view ??= ["month", "week", "day", "agenda"].includes(str(p.view)) ? str(p.view) : "month";
  st.cursor ??= str(p.date) || todayIso();
  const byDay = new Map<string, Rec[]>();
  for (const e of events) if (e.date) byDay.set(str(e.date), [...(byDay.get(str(e.date)) ?? []), e]);
  const box = h("div", "cal");
  const draw = (focusDay?: string) => {
    box.replaceChildren();
    const view = st.view!, cur = st.cursor!;
    const bar = h("div", "w-tools");
    const step = (n: number) => {
      st.cursor = view === "month" ? (() => { const d = new Date(toT(cur)); d.setUTCMonth(d.getUTCMonth() + n, 1); return toIso(d.getTime()); })() : addDays(cur, n * (view === "week" ? 7 : 1));
      draw();
    };
    const prev = btn("‹", `Previous ${view}`), next = btn("›", `Next ${view}`), today = btn("Today");
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    today.onclick = () => ((st.cursor = todayIso()), draw());
    const title = h("strong", "cal-title", view === "month" ? monthName(cur) : view === "week" ? `${dayLabel(weekStart(cur)).replace(/ \d{4}$/, "")} – ${dayLabel(addDays(weekStart(cur), 6))}` : view === "day" ? dayLabel(cur) : "Agenda");
    const views = h("div", "w-seg");
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "View");
    for (const v of ["month", "week", "day", "agenda"]) {
      const b = btn(v[0]!.toUpperCase() + v.slice(1));
      b.setAttribute("aria-pressed", String(v === view));
      b.onclick = () => ((st.view = v), draw());
      views.append(b);
    }
    if (view === "agenda") bar.append(title, views);
    else bar.append(prev, today, next, title, views);
    box.append(bar);
    const chip = (e: Rec) => {
      const c = h("div", `cal-ev${e.tone ? ` t-${str(e.tone)}` : ""}`);
      if (e.start) c.append(h("span", "cal-time", `${str(e.start)}${e.end ? `–${str(e.end)}` : ""}`));
      c.append(h("span", "cal-ev-title", str(e.title)));
      if (e.note) c.title = str(e.note);
      return c;
    };
    const dayList = (iso: string, list: Rec[]) => {
      const sec = h("section", "cal-day-list");
      sec.append(h("h4", undefined, dayLabel(iso)));
      if (!list.length) sec.append(h("p", "w-muted", "Nothing planned"));
      for (const e of list) {
        const row = chip(e);
        if (e.note) row.append(h("span", "cal-note", str(e.note)));
        sec.append(row);
      }
      return sec;
    };
    if (view === "month") {
      const grid = h("div", "cal-month");
      grid.setAttribute("role", "grid");
      grid.setAttribute("aria-label", monthName(cur));
      for (const d of WD) grid.append(h("div", "cal-wd", d));
      const first = cur.slice(0, 8) + "01";
      let day = weekStart(first);
      const cells: HTMLElement[] = [];
      for (let i = 0; i < 42; i++, day = addDays(day, 1)) {
        if (i === 35 && day.slice(0, 7) !== cur.slice(0, 7)) break;
        const iso = day;
        const list = byDay.get(iso) ?? [];
        const cell = h("div", `cal-cell${iso.slice(0, 7) !== cur.slice(0, 7) ? " out" : ""}${iso === todayIso() ? " today" : ""}${iso === st.picked ? " picked" : ""}`);
        cell.setAttribute("role", "gridcell");
        cell.tabIndex = iso === (focusDay ?? st.picked ?? cur) ? 0 : -1;
        cell.dataset.day = iso;
        cell.setAttribute("aria-label", `${dayLabel(iso)}${list.length ? `, ${list.length} event${list.length > 1 ? "s" : ""}` : ""}`);
        cell.append(h("span", "cal-num", String(Number(iso.slice(8)))));
        const evs = h("div", "cal-evs");
        list.slice(0, 3).forEach((e) => evs.append(chip(e)));
        if (list.length > 3) evs.append(h("span", "cal-more", `+${list.length - 3} more`));
        cell.append(evs);
        if (list.length) cell.append(h("span", "cal-dot", ""));
        cell.onclick = () => ((st.picked = iso), draw(iso));
        cell.onkeydown = (e) => {
          const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (move) {
            e.preventDefault();
            const to = addDays(iso, move);
            if (to.slice(0, 7) !== cur.slice(0, 7)) st.cursor = to;
            st.picked = to;
            draw(to);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            st.picked = iso;
            draw(iso);
          } else if (e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            step(e.key === "PageUp" ? -1 : 1);
          }
        };
        cells.push(cell);
        grid.append(cell);
      }
      box.append(grid);
      if (st.picked) box.append(dayList(st.picked, byDay.get(st.picked) ?? []));
      if (focusDay) queueMicrotask(() => cells.find((c) => c.dataset.day === focusDay)?.focus());
    } else if (view === "week") {
      const wk = h("div", "cal-week");
      for (let i = 0, d = weekStart(cur); i < 7; i++, d = addDays(d, 1)) {
        const col = h("div", `cal-wcol${d === todayIso() ? " today" : ""}`);
        col.append(h("div", "cal-wd", `${WD[i]} ${Number(d.slice(8))}`));
        for (const e of byDay.get(d) ?? []) col.append(chip(e));
        wk.append(col);
      }
      box.append(wk);
    } else if (view === "day") box.append(dayList(cur, byDay.get(cur) ?? []));
    else {
      const days = [...byDay.keys()].sort();
      if (!days.length && !events.length) box.append(h("p", "w-muted", "No events"));
      for (const d of days) box.append(dayList(d, byDay.get(d)!));
      const undated = events.filter((e) => !e.date);
      if (undated.length) {
        const sec = h("section", "cal-day-list");
        sec.append(h("h4", undefined, "Unscheduled"));
        for (const e of undated) sec.append(chip({ ...e, title: `${str(e.title)}${e.when ? ` (${str(e.when)})` : ""}` }));
        box.append(sec);
      }
    }
  };
  draw();
  return box;
}

// --- board -----------------------------------------------------------------

export function renderBoard(p: Rec, ctx: WidgetCtx): { el: HTMLElement; sync: (value: unknown) => void } {
  const columns = recs(p.columns);
  const st = ctx.state as { cards?: Rec[]; focus?: string; grabbed?: string };
  const fromModel = recs(p.cards);
  let cards = st.cards ?? fromModel;
  const box = h("div", "board");
  const say = live();
  const commit = (next: Rec[], focus: string, msg: string) => {
    cards = st.cards = next;
    st.focus = focus;
    say.textContent = msg;
    draw();
    ctx.set?.(next.map((c) => ({ ...c })));
  };
  const colTitle = (id: string) => str(columns.find((c) => c.id === id)?.title ?? id);
  const move = (id: string, column: string, index: number) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const rest = cards.filter((c) => c.id !== id);
    const inCol = rest.filter((c) => c.column === column);
    const before = inCol[index];
    const at = before ? rest.indexOf(before) : inCol.length ? rest.indexOf(inCol.at(-1)!) + 1 : rest.length;
    rest.splice(at, 0, { ...card, column });
    commit(rest, id, `${str(card.title)} moved to ${colTitle(column)}, position ${Math.min(index, inCol.length) + 1}`);
  };
  const draw = () => {
    const lanes = h("div", "board-lanes");
    for (const col of columns) {
      const id = str(col.id);
      const list = cards.filter((c) => c.column === id);
      const lane = h("section", "board-col");
      lane.dataset.col = id;
      const head = h("header", "board-head");
      head.append(h("span", undefined, str(col.title)), h("span", "board-count", String(list.length)));
      const ul = h("ul", "board-cards");
      ul.setAttribute("aria-label", str(col.title));
      for (const c of list) {
        const li = h("li", `board-card${st.grabbed === c.id ? " grabbed" : ""}`);
        li.tabIndex = 0;
        li.dataset.id = str(c.id);
        li.setAttribute("aria-roledescription", "card; Space to pick up, arrows to move");
        li.append(h("div", "board-title", str(c.title)));
        if (c.note) li.append(h("div", "board-note", str(c.note)));
        if (c.tag) li.append(h("span", "board-tag", str(c.tag)));
        li.addEventListener("keydown", (e) => {
          const cid = str(c.id);
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            st.grabbed = st.grabbed === cid ? undefined : cid;
            st.focus = cid;
            say.textContent = st.grabbed ? `Picked up ${str(c.title)}. Arrows move it; Space drops.` : `Dropped ${str(c.title)}.`;
            draw();
            return;
          }
          if (e.key === "Escape" && st.grabbed) return void ((st.grabbed = undefined), draw());
          const ci = columns.findIndex((k) => k.id === c.column);
          const ri = list.indexOf(c);
          if (st.grabbed === cid) {
            const to = { ArrowLeft: [ci - 1, 0], ArrowRight: [ci + 1, 0], ArrowUp: [ci, ri - 1], ArrowDown: [ci, ri + 1] }[e.key];
            if (!to) return;
            e.preventDefault();
            const [nc, nr] = to as [number, number];
            if (nc < 0 || nc >= columns.length || nr < 0) return;
            move(cid, str(columns[nc]!.id), nc === ci ? nr : cards.filter((k) => k.column === columns[nc]!.id).length);
          } else {
            // Unheld: arrows walk the board.
            const target = e.key === "ArrowDown" ? list[ri + 1] : e.key === "ArrowUp" ? list[ri - 1] : e.key === "ArrowRight" || e.key === "ArrowLeft" ? cards.find((k) => k.column === columns[ci + (e.key === "ArrowRight" ? 1 : -1)]?.id) : undefined;
            if (target) {
              e.preventDefault();
              box.querySelector<HTMLElement>(`[data-id="${CSS.escape(str(target.id))}"]`)?.focus();
            }
          }
        });
        li.addEventListener("pointerdown", (e) => drag(e, li, str(c.id)));
        ul.append(li);
      }
      if (!list.length) ul.append(h("li", "board-empty", "Drop here"));
      lane.append(head, ul);
      lanes.append(lane);
    }
    box.replaceChildren(lanes, say);
    if (st.focus) box.querySelector<HTMLElement>(`[data-id="${CSS.escape(st.focus)}"]`)?.focus({ preventScroll: true });
  };
  /** Pointer drag (mouse, pen and touch alike); a press that never moves stays a click. */
  const drag = (e: PointerEvent, li: HTMLElement, id: string) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost: HTMLElement | undefined, marker: HTMLElement | undefined, target: { col: string; index: number } | undefined;
    const r = li.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        ghost = li.cloneNode(true) as HTMLElement;
        ghost.classList.add("board-ghost");
        ghost.style.width = `${r.width}px`;
        box.append(ghost);
        li.classList.add("dragging");
        marker = h("li", "board-marker");
        li.setPointerCapture?.(ev.pointerId);
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - sx + r.left}px, ${ev.clientY - sy + r.top}px) rotate(2deg)`;
      const lane = [...box.querySelectorAll<HTMLElement>(".board-col")].find((l) => {
        const b = l.getBoundingClientRect();
        return ev.clientX >= b.left && ev.clientX <= b.right;
      });
      if (!lane) return;
      const ul = lane.querySelector("ul")!;
      const others = [...ul.querySelectorAll<HTMLElement>(".board-card:not(.dragging)")];
      const index = others.filter((o) => o.getBoundingClientRect().top + o.offsetHeight / 2 < ev.clientY).length;
      target = { col: lane.dataset.col!, index };
      ul.insertBefore(marker!, others[index] ?? null);
      // Edge auto-scroll for boards wider than their frame.
      const lb = box.querySelector(".board-lanes")!;
      const fb = lb.getBoundingClientRect();
      if (ev.clientX > fb.right - 40) lb.scrollLeft += 12;
      else if (ev.clientX < fb.left + 40) lb.scrollLeft -= 12;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!ghost) return;
      ghost.remove();
      marker?.remove();
      li.classList.remove("dragging");
      if (target) move(id, target.col, target.index);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  draw();
  return {
    el: box,
    // A bound board shows the data model's cards: the user's moves, or the model's own update.
    sync: (value) => {
      const next = Array.isArray(value) ? recs(value) : undefined;
      if (next && JSON.stringify(next) !== JSON.stringify(cards)) {
        cards = st.cards = next.map((c, i) => ({ ...c, id: str(c.id) || `c${i + 1}`, column: str(c.column) || str(columns[0]?.id) }));
        draw();
      }
    },
  };
}

// --- progress --------------------------------------------------------------

export function renderProgress(p: Rec): HTMLElement {
  const v = Number(p.value) || 0, max = Number(p.max) || 100;
  const f = Math.max(0, Math.min(1, v / max));
  const kind = str(p.kind) || "bar";
  const unit = str(p.unit);
  const amount = (x: number) => {
    const n = (+x.toFixed(2)).toLocaleString();
    return unit.length === 1 && !/[%a-z]/i.test(unit) ? `${unit}${n}` : `${n}${unit ? ` ${unit}` : ""}`;
  };
  // Over the limit reads as danger unless the model set a tone.
  const tone = str(p.tone) || (v > max && kind !== "rating" ? "danger" : "");
  const box = h("div", `prog k-${kind}${tone ? ` t-${tone}` : ""}`);
  const meter = h("div", "prog-meter");
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", String(max));
  meter.setAttribute("aria-valuenow", String(v));
  meter.setAttribute("aria-label", str(p.label) || "Progress");
  const text = kind === "rating" ? `${+v.toFixed(1)} / ${max}` : `${amount(v)} of ${amount(max)}`;
  meter.setAttribute("aria-valuetext", text);
  const head = h("div", "prog-head");
  if (p.label) head.append(h("span", "prog-label", str(p.label)));
  if (kind === "bar") head.append(h("span", "prog-val", `${text} · ${Math.round((v / max) * 100)}%`));
  if (kind === "rating") {
    const stars = h("span", "prog-stars");
    for (let i = 1; i <= Math.round(max); i++) {
      const s = h("span", "star", "★");
      s.style.setProperty("--fill", `${Math.max(0, Math.min(1, v - i + 1)) * 100}%`);
      stars.append(s);
    }
    meter.append(stars, h("span", "prog-val", text));
  } else if (kind === "bar") {
    const track = h("div", "prog-track");
    const fill = h("div", "prog-fill");
    fill.style.width = `${f * 100}%`;
    track.append(fill);
    meter.append(track);
  } else {
    const ring = kind === "ring";
    const s = svg("svg", { viewBox: ring ? "0 0 120 120" : "0 0 120 70", class: "prog-dial", "aria-hidden": "true" });
    const r = 50, c = ring ? 2 * Math.PI * r : Math.PI * r;
    const d = ring ? undefined : "M10,62 A50,50 0 0 1 110,62";
    const track = ring ? svg("circle", { cx: 60, cy: 60, r, class: "prog-bg" }) : svg("path", { d: d!, class: "prog-bg" });
    const arc = ring ? svg("circle", { cx: 60, cy: 60, r, class: "prog-arc", transform: "rotate(-90 60 60)" }) : svg("path", { d: d!, class: "prog-arc" });
    arc.setAttribute("stroke-dasharray", `${c * f} ${c}`);
    const label = svg("text", { x: 60, y: ring ? 66 : 58, "text-anchor": "middle", class: "prog-pct" });
    label.textContent = `${Math.round((v / max) * 100)}%`;
    s.append(track, arc, label);
    meter.append(s, h("div", "prog-val", text));
  }
  box.append(head, meter);
  if (p.note) box.append(h("div", "w-muted", str(p.note)));
  return box;
}

// --- accordion -------------------------------------------------------------

/** Items as native details/summary (keyboard and find-in-page for free). */
export function renderAccordion(p: Rec, ctx: WidgetCtx, md: (text: unknown) => HTMLElement): { el: HTMLElement; host: HTMLElement; after: () => void } {
  const st = ctx.state as { open?: Record<string, boolean> };
  st.open ??= {};
  const single = p.multiple === false;
  const box = h("div", "acc");
  const items = recs(p.items);
  const host = h("div", "acc-kids");
  const all: HTMLDetailsElement[] = [];
  const panel = (key: string, title: string, body: () => HTMLElement | undefined, i: number) => {
    const d = h("details", "acc-item");
    d.open = st.open![key] ?? (i === 0 && items.length + host.childElementCount <= 1);
    const s = h("summary", undefined, title);
    d.append(s);
    const b = body();
    if (b) d.append(b);
    d.addEventListener("toggle", () => {
      st.open![key] = d.open;
      if (single && d.open) for (const o of all) if (o !== d) o.open = false;
    });
    all.push(d);
    return d;
  };
  items.forEach((it, i) => box.append(panel(`i${i}`, str(it.title), () => (it.body ? md(it.body) : undefined), i)));
  const tools = h("div", "w-tools acc-tools");
  const toggle = btn("Expand all");
  toggle.onclick = () => {
    const open = all.some((d) => !d.open);
    for (const d of all) d.open = open;
    toggle.textContent = open ? "Collapse all" : "Expand all";
  };
  tools.append(toggle);
  box.append(host);
  box.prepend(tools);
  return {
    el: box,
    host,
    // Child sections fold under their own heading.
    after: () => {
      tools.hidden = single || all.length + host.childElementCount < 3;
      [...host.children].forEach((child, i) => {
        const el = child as HTMLElement;
        if (el.dataset.acc) return;
        el.dataset.acc = "1";
        const head = el.querySelector(":scope > header");
        if (!head) return;
        const key = `c${i}`;
        const d = panel(key, head.querySelector("h3")?.textContent ?? `Section ${i + 1}`, () => undefined, items.length + i);
        head.querySelector("h3")?.remove();
        el.replaceWith(d);
        d.append(el);
      });
    },
  };
}

// --- compare ---------------------------------------------------------------

/** `pick(i)` sends the node's action for option i; buttons appear only when the model gave an action. */
export function renderCompare(p: Rec, md: (text: unknown) => HTMLElement, pick?: (i: number) => void, busy?: string): HTMLElement {
  const opts = recs(p.options);
  const box = h("div", "cmp");
  const cards = h("div", "cmp-cards");
  cards.style.setProperty("--n", String(Math.max(1, Math.min(opts.length, 4))));
  opts.forEach((o, i) => {
    const c = h("article", `cmp-card${o.best ? " best" : ""}`);
    if (o.best) c.append(h("span", "cmp-badge", "Best pick"));
    c.append(h("h4", undefined, str(o.name)));
    if (o.price) c.append(h("div", "cmp-price", str(o.price)));
    const pros = (o.pros as string[] | undefined) ?? [], cons = (o.cons as string[] | undefined) ?? [];
    if (pros.length || cons.length) {
      const ul = h("ul", "cmp-pc");
      for (const x of pros) ul.append(Object.assign(h("li", "pro"), { textContent: x, ariaLabel: `Pro: ${x}` }));
      for (const x of cons) ul.append(Object.assign(h("li", "con"), { textContent: x, ariaLabel: `Con: ${x}` }));
      c.append(ul);
    }
    if (o.note) c.append(md(o.note));
    if (pick && str(p.action)) {
      const b = btn(`${str(p.actionLabel) || "Choose"}`, `${str(p.actionLabel) || "Choose"} ${str(o.name)}`, `btn ${o.best ? "primary" : "secondary"} cmp-pick`);
      b.disabled = busy !== undefined;
      if (busy === String(i)) b.textContent = "…";
      b.onclick = () => pick(i);
      c.append(b);
    }
    cards.append(c);
  });
  box.append(cards);
  const keys = [...new Set(opts.flatMap((o) => Object.keys((o.specs as object | undefined) ?? {})))];
  if (keys.length) {
    const frame = h("div", "table-box");
    const scroll = h("div", "table-scroll");
    const t = h("table", "cmp-table");
    const hr = h("tr");
    hr.append(h("th", undefined, ""));
    for (const o of opts) hr.append(Object.assign(h("th", o.best ? "best" : undefined, str(o.name)), { scope: "col" }));
    const thead = h("thead");
    thead.append(hr);
    const tb = h("tbody");
    for (const k of keys) {
      const tr = h("tr");
      const vals = opts.map((o) => str((o.specs as Rec | undefined)?.[k]));
      tr.append(Object.assign(h("th", undefined, k), { scope: "row" }));
      // Rows where options differ stand out; identical ones recede.
      if (new Set(vals).size === 1) tr.className = "same";
      vals.forEach((v, i) => {
        const td = h("td", opts[i]!.best ? "best" : undefined, v || "—");
        td.dataset.label = str(opts[i]!.name);
        tr.append(td);
      });
      tb.append(tr);
    }
    t.append(thead, tb);
    scroll.append(t);
    frame.append(scroll);
    box.append(frame);
  }
  return box;
}

// --- timer -----------------------------------------------------------------

function beep(): void {
  try {
    const A = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!A) return;
    const ac = new A();
    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.35 + 0.25);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.35);
      o.stop(ac.currentTime + i * 0.35 + 0.3);
    }
    setTimeout(() => void ac.close(), 1500);
  } catch {
    // Sound is a courtesy; the visual and the announcement carry the alert.
  }
}

/** Timer (duration), countdown (until) or stopwatch (neither). Time is wall-clock, so a hidden tab stays right. */
export function renderTimer(p: Rec, ctx: WidgetCtx): HTMLElement {
  const st = ctx.state as { total?: number; left?: number; endsAt?: number; startedAt?: number; elapsed?: number; laps?: number[]; done?: boolean };
  const duration = Number(p.duration) || 0;
  const until = str(p.until) ? Date.parse(str(p.until)) : NaN;
  const mode = Number.isFinite(until) ? "countdown" : duration ? "timer" : "stopwatch";
  if (st.total !== duration) Object.assign(st, { total: duration, left: duration, endsAt: undefined, done: false });
  const box = h("div", `timer m-${mode}`);
  box.tabIndex = 0;
  box.setAttribute("aria-label", `${str(p.label) || mode}; Space starts or pauses, R resets`);
  if (p.label) box.append(h("div", "timer-label", str(p.label)));
  const face = h("div", "timer-face");
  const digits = h("div", "timer-digits");
  digits.setAttribute("role", "timer");
  const say = live();
  const ring = svg("svg", { viewBox: "0 0 120 120", class: "timer-ring", "aria-hidden": "true" });
  const C = 2 * Math.PI * 54;
  const arc = svg("circle", { cx: 60, cy: 60, r: 54, class: "prog-arc", transform: "rotate(-90 60 60)" });
  ring.append(svg("circle", { cx: 60, cy: 60, r: 54, class: "prog-bg" }), arc);
  face.append(ring, digits);
  const tools = h("div", "w-tools timer-tools");
  const go = btn("Start"), reset = btn("Reset"), plus = btn("+1 min"), lap = btn("Lap");
  const laps = h("ol", "timer-laps");
  box.append(face, tools, laps, say);
  const running = () => st.endsAt !== undefined || st.startedAt !== undefined;
  let tick: ReturnType<typeof setInterval> | undefined, shownOnce = false;
  const paint = () => {
    shownOnce ||= box.isConnected;
    // Removed from the page (the surface changed): stop ticking.
    if (shownOnce && !box.isConnected && tick) {
      clearInterval(tick);
      tick = undefined;
      return;
    }
    let shown: number, frac = 1;
    if (mode === "countdown") {
      shown = Math.max(0, (until - Date.now()) / 1000);
      const d = Math.floor(shown / 86400);
      digits.textContent = `${d ? `${d}d ` : ""}${clockText(shown % 86400)}`;
      frac = 1;
      if (shown === 0 && !st.done) ((st.done = true), box.classList.add("done"), (say.textContent = `${str(p.label) || "Countdown"}: time is up`), beep());
    } else if (mode === "timer") {
      if (st.endsAt !== undefined) st.left = Math.max(0, (st.endsAt - Date.now()) / 1000);
      shown = Math.ceil(st.left!);
      frac = st.left! / (st.total || 1);
      digits.textContent = clockText(shown);
      if (st.left === 0 && st.endsAt !== undefined) {
        st.endsAt = undefined;
        st.done = true;
        box.classList.add("done");
        say.textContent = `${str(p.label) || "Timer"}: time is up`;
        beep();
      }
    } else {
      shown = (st.elapsed ?? 0) + (st.startedAt !== undefined ? (Date.now() - st.startedAt) / 1000 : 0);
      digits.textContent = `${clockText(Math.floor(shown))}.${Math.floor((shown % 1) * 10)}`;
      frac = (shown % 60) / 60;
    }
    arc.setAttribute("stroke-dasharray", `${C * frac} ${C}`);
    go.textContent = running() ? "Pause" : st.done && mode === "timer" ? "Restart" : "Start";
    box.classList.toggle("running", running());
    if (!running() && mode !== "countdown" && tick) ((clearInterval(tick)), (tick = undefined));
  };
  const loop = () => (tick ??= setInterval(paint, 100));
  const toggle = () => {
    if (mode === "timer") {
      if (st.endsAt !== undefined) st.endsAt = undefined;
      else {
        if (st.done || !st.left) ((st.left = st.total), (st.done = false), box.classList.remove("done"));
        st.endsAt = Date.now() + st.left! * 1000;
      }
    } else if (st.startedAt !== undefined) ((st.elapsed = (st.elapsed ?? 0) + (Date.now() - st.startedAt) / 1000), (st.startedAt = undefined));
    else st.startedAt = Date.now();
    loop();
    paint();
  };
  const doReset = () => {
    Object.assign(st, { left: st.total, endsAt: undefined, startedAt: undefined, elapsed: 0, laps: [], done: false });
    box.classList.remove("done");
    laps.replaceChildren();
    paint();
  };
  go.onclick = toggle;
  reset.onclick = doReset;
  plus.onclick = () => {
    st.left = (st.left ?? 0) + 60;
    st.total = Math.max(st.total ?? 0, st.left);
    if (st.endsAt !== undefined) st.endsAt += 60_000;
    paint();
  };
  lap.onclick = () => {
    const t = (st.elapsed ?? 0) + (st.startedAt !== undefined ? (Date.now() - st.startedAt) / 1000 : 0);
    st.laps = [...(st.laps ?? []), t];
    laps.append(h("li", undefined, clockText(Math.floor(t))));
  };
  for (const t of st.laps ?? []) laps.append(h("li", undefined, clockText(Math.floor(t))));
  if (mode === "timer") tools.append(go, plus, reset);
  else if (mode === "stopwatch") tools.append(go, lap, reset);
  box.addEventListener("keydown", (e) => {
    if (e.target !== box || mode === "countdown") return;
    if (e.key === " " || e.key === "Enter") ((e.preventDefault()), toggle());
    else if (e.key === "r" || e.key === "R") doReset();
  });
  if (mode === "countdown" || running() || (p.autostart === true && !st.done && st.left === st.total && (st.endsAt === undefined ? (toggle(), true) : true))) loop();
  paint();
  return box;
}

// --- tree ------------------------------------------------------------------

/** WAI tree pattern: roving focus, arrows open/close and walk, Home/End, * opens siblings. */
export function renderTree(p: Rec, ctx: WidgetCtx): HTMLElement {
  const st = ctx.state as { open?: Record<string, boolean>; focus?: string };
  st.open ??= {};
  const box = h("div", "tree-box");
  const tools = h("div", "w-tools");
  const expand = btn("Expand all"), collapse = btn("Collapse all");
  tools.append(expand, collapse);
  const root = h("ul", "tree");
  root.setAttribute("role", "tree");
  const paths: string[] = [];
  const isOpen = (path: string, depth: number) => st.open![path] ?? (p.expanded === false ? false : p.expanded === true || depth < 2);
  const build = (items: Rec[], into: HTMLElement, depth: number, prefix: string) => {
    items.forEach((it, i) => {
      const path = `${prefix}${i}`;
      const kids = recs(it.children);
      const li = h("li");
      li.setAttribute("role", "treeitem");
      li.dataset.path = path;
      li.setAttribute("aria-level", String(depth + 1));
      const row = h("div", "tree-row");
      row.style.setProperty("--depth", String(depth));
      row.append(h("span", "tree-twisty", kids.length ? "›" : ""), h("span", "tree-label", str(it.label)));
      if (it.note) row.append(h("span", "tree-note", str(it.note)));
      li.append(row);
      li.tabIndex = -1;
      paths.push(path);
      if (kids.length) {
        li.setAttribute("aria-expanded", String(isOpen(path, depth)));
        const ul = h("ul");
        ul.setAttribute("role", "group");
        build(kids, ul, depth + 1, `${path}.`);
        li.append(ul);
        row.onclick = () => ((st.open![path] = li.getAttribute("aria-expanded") !== "true"), (st.focus = path), li.setAttribute("aria-expanded", String(st.open![path])), li.focus());
      } else row.onclick = () => ((st.focus = path), li.focus());
      into.append(li);
    });
  };
  build(recs(p.items), root, 0, "");
  if (!paths.length) root.append(h("li", "w-muted", "Empty"));
  const visible = () => [...root.querySelectorAll<HTMLElement>("li[role=treeitem]")].filter((li) => !li.parentElement?.closest("li[aria-expanded=false]"));
  const focusOn = (li: HTMLElement | undefined) => {
    if (!li) return;
    for (const x of root.querySelectorAll<HTMLElement>("li[role=treeitem]")) x.tabIndex = -1;
    li.tabIndex = 0;
    st.focus = li.dataset.path;
    li.focus();
  };
  root.addEventListener("keydown", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[role=treeitem]");
    if (!li) return;
    const vis = visible();
    const i = vis.indexOf(li);
    const exp = li.getAttribute("aria-expanded");
    const set = (open: boolean) => ((st.open![li.dataset.path!] = open), li.setAttribute("aria-expanded", String(open)));
    const keys: Record<string, () => void> = {
      ArrowDown: () => focusOn(vis[i + 1]),
      ArrowUp: () => focusOn(vis[i - 1]),
      Home: () => focusOn(vis[0]),
      End: () => focusOn(vis.at(-1)),
      ArrowRight: () => (exp === "false" ? set(true) : exp === "true" ? focusOn(vis[i + 1]) : undefined),
      ArrowLeft: () => (exp === "true" ? set(false) : focusOn(li.parentElement?.closest<HTMLElement>("li[role=treeitem]") ?? undefined)),
      Enter: () => (exp !== null ? set(exp !== "true") : undefined),
      "*": () => li.parentElement?.querySelectorAll<HTMLElement>(":scope > li[aria-expanded]").forEach((s) => ((st.open![s.dataset.path!] = true), s.setAttribute("aria-expanded", "true"))),
    };
    const k = keys[e.key];
    if (k) ((e.preventDefault()), k());
  });
  const all = (open: boolean) => root.querySelectorAll<HTMLElement>("li[aria-expanded]").forEach((li) => ((st.open![li.dataset.path!] = open), li.setAttribute("aria-expanded", String(open))));
  expand.onclick = () => all(true);
  collapse.onclick = () => all(false);
  tools.hidden = !root.querySelector("li[aria-expanded]");
  box.append(tools, root);
  const first = root.querySelector<HTMLElement>(`li[data-path="${st.focus ?? "0"}"]`) ?? root.querySelector<HTMLElement>("li[role=treeitem]");
  if (first) first.tabIndex = 0;
  return box;
}

// --- diff ------------------------------------------------------------------

/** The changed middle of a line pair, for word-level marks. */
function inline(a: string, b: string): [number, number, number] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return [s, a.length - e, b.length - e];
}
function marked(text: string, from: number, to: number): HTMLElement {
  const code = h("code");
  if (from >= to || to - from > text.length * 0.8) code.textContent = text || " ";
  else code.append(text.slice(0, from), Object.assign(h("mark"), { textContent: text.slice(from, to) }), text.slice(to));
  return code;
}

export function renderDiff(p: Rec, ctx: WidgetCtx): HTMLElement {
  const st = ctx.state as { view?: string; shown?: Record<number, boolean> };
  st.view ??= str(p.view) || "unified";
  st.shown ??= {};
  const lines = diffOf(p);
  const box = h("div", "diff");
  const draw = () => {
    box.replaceChildren();
    const bar = h("div", "code-bar");
    const add = lines.filter((l) => l.op === "+").length, del = lines.filter((l) => l.op === "-").length;
    bar.append(h("span", "code-title", str(p.title || p.language || "Changes")), h("span", "diff-stat", `+${add} −${del}`));
    const seg = h("div", "w-seg");
    for (const v of ["unified", "split"]) {
      const b = btn(v === "unified" ? "Unified" : "Split");
      b.setAttribute("aria-pressed", String(st.view === v));
      b.onclick = () => ((st.view = v), draw());
      seg.append(b);
    }
    bar.append(seg);
    box.append(bar);
    // Rows: [op, oldNo, oldText, newNo, newText]; a - run followed by a + run pairs line by line.
    type Row = { op: string; a?: number; at?: string; b?: number; bt?: string; marks?: [number, number, number] };
    const rows: Row[] = [];
    let na = 0, nb = 0;
    for (let i = 0; i < lines.length; ) {
      const l = lines[i]!;
      if (l.op === "@") {
        const m = /-(\d+)(?:,\d+)? \+(\d+)/.exec(l.text);
        if (m) ((na = Number(m[1]) - 1), (nb = Number(m[2]) - 1));
        rows.push({ op: "@", at: l.text });
        i++;
      } else if (l.op === " ") rows.push({ op: " ", a: ++na, at: l.text, b: ++nb, bt: l.text }), i++;
      else {
        const dels: string[] = [], adds: string[] = [];
        while (lines[i]?.op === "-") dels.push(lines[i++]!.text);
        while (lines[i]?.op === "+") adds.push(lines[i++]!.text);
        for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
          const a = dels[k], b = adds[k];
          rows.push({ op: a !== undefined && b !== undefined ? "~" : a !== undefined ? "-" : "+", ...(a !== undefined ? { a: ++na, at: a } : {}), ...(b !== undefined ? { b: ++nb, bt: b } : {}), ...(a !== undefined && b !== undefined ? { marks: inline(a, b) } : {}) });
        }
      }
    }
    const table = h("table", `diff-table v-${st.view}`);
    const tb = h("tbody");
    const cell = (cls: string, text?: string | number) => h("td", cls, text === undefined ? "" : String(text));
    const emit = (r: Row) => {
      const out: HTMLTableRowElement[] = [];
      if (r.op === "@") {
        const tr = h("tr", "hunk");
        const td = cell("", r.at);
        td.colSpan = 4;
        tr.append(td);
        return [tr];
      }
      const side = (op: "-" | "+" | " ", no: number | undefined, text: string | undefined, from?: number, to?: number) => {
        const t = h("td", `txt ${op === "-" ? "del" : op === "+" ? "add" : ""}`);
        if (text !== undefined) t.append(h("span", "sig", op === " " ? " " : op), from !== undefined ? marked(text, from, to!) : Object.assign(h("code"), { textContent: text || " " }));
        return [cell("no", no), t];
      };
      if (st.view === "split") {
        const tr = h("tr");
        const [s0, e0, e1] = r.marks ?? [];
        tr.append(...side(r.op === " " ? " " : "-", r.a, r.at, s0, e0), ...side(r.op === " " ? " " : "+", r.b, r.bt, s0, e1));
        out.push(tr);
      } else {
        if (r.op === " ") {
          const tr = h("tr");
          tr.append(cell("no", r.a), ...side(" ", r.b, r.at));
          out.push(tr);
        } else {
          const [s0, e0, e1] = r.marks ?? [];
          if (r.at !== undefined) {
            const tr = h("tr");
            tr.append(cell("no", r.a), ...side("-", undefined, r.at, s0, e0));
            out.push(tr);
          }
          if (r.bt !== undefined) {
            const tr = h("tr");
            tr.append(cell("no", ""), ...side("+", r.b, r.bt, s0, e1));
            out.push(tr);
          }
        }
      }
      return out;
    };
    // Long unchanged runs fold, keeping 3 lines of context each side.
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (rows[j]?.op === " ") j++;
      if (j - i > 8 && !st.shown![i]) {
        const head = i === 0 ? 0 : 3, tail = j === rows.length ? 0 : 3;
        rows.slice(i, i + head).forEach((r) => tb.append(...emit(r)));
        const tr = h("tr", "fold");
        const td = h("td");
        td.colSpan = 4;
        const more = btn(`Show ${j - i - head - tail} unchanged lines`, undefined, "diff-more");
        const at = i;
        more.onclick = () => ((st.shown![at] = true), draw());
        td.append(more);
        tr.append(td);
        tb.append(tr);
        rows.slice(j - tail, j).forEach((r) => tb.append(...emit(r)));
        i = j;
      } else {
        const end = Math.max(j, i + 1);
        rows.slice(i, end).forEach((r) => tb.append(...emit(r)));
        i = end;
      }
    }
    table.append(tb);
    const scroll = h("div", "diff-scroll");
    scroll.append(table);
    box.append(scroll);
  };
  draw();
  return box;
}

// --- gantt -----------------------------------------------------------------

/** Bars on a date scale; zoom with buttons, +/−, ctrl-wheel or pinch; scroll or drag to pan. */
export function renderGantt(p: Rec, ctx: WidgetCtx): HTMLElement {
  const tasks = recs(p.tasks).filter((t) => t.start);
  const st = ctx.state as { px?: number; scroll?: number };
  const box = h("div", "gantt");
  if (!tasks.length) return Object.assign(box, { textContent: "No dated tasks" });
  const t0 = Math.min(...tasks.map((t) => toT(str(t.start)))) - 2 * DAY;
  const t1 = Math.max(...tasks.map((t) => toT(str(t.end || t.start)))) + 3 * DAY;
  const days = Math.round((t1 - t0) / DAY);
  const tools = h("div", "w-tools");
  const zin = btn("+", "Zoom in"), zout = btn("−", "Zoom out"), fit = btn("Fit"), today = btn("Today");
  tools.append(zout, zin, fit, today);
  const frame = h("div", "gantt-frame");
  frame.tabIndex = 0;
  frame.setAttribute("aria-label", "Timeline; arrows move between tasks, + and − zoom");
  const names = h("div", "gantt-names");
  const track = h("div", "gantt-track");
  frame.append(names, track);
  box.append(tools, frame);
  const groups = [...new Set(tasks.map((t) => str(t.group)))];
  const color = (t: Rec) => `var(--vak-series-${(Math.max(0, groups.indexOf(str(t.group))) % 6) + 1})`;
  const draw = () => {
    const px = st.px!;
    const inner = h("div", "gantt-inner");
    inner.style.width = `${days * px}px`;
    const scale = h("div", "gantt-scale");
    // Ticks: days when roomy, weeks (Mondays) when not, months when tight.
    for (let d = 0; d < days; d++) {
      const iso = toIso(t0 + d * DAY);
      const dt = new Date(t0 + d * DAY);
      // A Monday tick right after a month's own tick would overlap it.
      const month = dt.getUTCDate() === 1, monday = dt.getUTCDay() === 1 && (px >= 14 || ![-4, -3, -2, -1, 1, 2, 3, 4].some((k) => new Date(t0 + (d + k) * DAY).getUTCDate() === 1));
      if (px >= 28 || (px >= 6 && monday) || month) {
        const tick = h("span", `gantt-tick${month ? " month" : ""}`, px >= 28 ? String(dt.getUTCDate()) : month || px < 6 ? dt.toLocaleString(undefined, { month: "short", timeZone: "UTC" }) : `${dt.getUTCDate()} ${dt.toLocaleString(undefined, { month: "short", timeZone: "UTC" })}`);
        tick.style.left = `${d * px}px`;
        tick.title = iso;
        scale.append(tick);
      }
    }
    inner.append(scale);
    const now = toT(todayIso());
    if (now >= t0 && now <= t1) {
      const line = h("div", "gantt-today");
      line.style.left = `${((now - t0) / DAY) * px}px`;
      inner.append(line);
    }
    names.replaceChildren(h("div", "gantt-name head", ""));
    tasks.forEach((t, i) => {
      const s = toT(str(t.start)), e = toT(str(t.end || t.start)) + DAY;
      const milestone = str(t.end || t.start) === str(t.start) && !t.end;
      const row = h("div", "gantt-row");
      const bar = h("div", `gantt-bar${milestone ? " milestone" : ""}`);
      bar.style.left = `${((s - t0) / DAY) * px}px`;
      bar.style.width = milestone ? "" : `${Math.max(((e - s) / DAY) * px, 4)}px`;
      bar.style.setProperty("--c", color(t));
      bar.tabIndex = -1;
      bar.dataset.i = String(i);
      const label = `${str(t.title)}: ${dayLabel(str(t.start))}${milestone ? "" : ` to ${dayLabel(str(t.end))}`}${t.progress !== undefined ? `, ${Math.round(Number(t.progress))}% done` : ""}`;
      bar.setAttribute("aria-label", label);
      bar.title = label;
      if (t.progress !== undefined) {
        const f = h("span", "gantt-done");
        f.style.width = `${Number(t.progress)}%`;
        bar.append(f);
      }
      if (!milestone && ((e - s) / DAY) * px > 60) bar.append(h("span", "gantt-bar-label", str(t.title)));
      row.append(bar);
      inner.append(row);
      const n = h("div", "gantt-name", str(t.title));
      if (t.group) n.prepend(h("span", "gantt-group", str(t.group)));
      n.onclick = () => bar.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      names.append(n);
    });
    track.replaceChildren(inner);
  };
  const zoom = (factor: number, anchor = track.clientWidth / 2) => {
    const old = st.px!;
    const day = (track.scrollLeft + anchor) / old;
    st.px = Math.max(2, Math.min(80, old * factor));
    draw();
    track.scrollLeft = day * st.px - anchor;
  };
  const doFit = () => {
    st.px = Math.max(2, Math.min(80, (track.clientWidth || 600) / days));
    draw();
    track.scrollLeft = 0;
  };
  zin.onclick = () => zoom(1.5);
  zout.onclick = () => zoom(1 / 1.5);
  fit.onclick = doFit;
  today.onclick = () => (track.scrollLeft = ((toT(todayIso()) - t0) / DAY) * st.px! - track.clientWidth / 2);
  frame.addEventListener("keydown", (e) => {
    const bars = [...track.querySelectorAll<HTMLElement>(".gantt-bar")];
    const i = bars.indexOf(e.target as HTMLElement);
    if (e.key === "+" || e.key === "=") zoom(1.5);
    else if (e.key === "-") zoom(1 / 1.5);
    else if (e.key === "0") doFit();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const b = bars[i < 0 ? 0 : Math.max(0, Math.min(bars.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      b?.focus({ preventScroll: true });
      b?.scrollIntoView({ inline: "nearest", block: "nearest" });
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") track.scrollLeft += (e.key === "ArrowRight" ? 1 : -1) * 7 * st.px!;
    else return;
    e.preventDefault();
  });
  track.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - track.getBoundingClientRect().left);
  }, { passive: false });
  // Pinch with two pointers; one pointer pans (mouse drag; touch scrolls natively).
  const pts = new Map<number, number>();
  let pinch = 0, panFrom: number | undefined;
  track.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, e.clientX);
    if (pts.size === 2) pinch = Math.abs([...pts.values()].reduce((a, b) => a - b));
    else if (e.pointerType === "mouse") ((panFrom = e.clientX + track.scrollLeft), track.classList.add("dragging"));
  });
  track.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e.clientX);
    if (pts.size === 2 && pinch) {
      const d = Math.abs([...pts.values()].reduce((a, b) => a - b));
      if (d > 10 && Math.abs(d / pinch - 1) > 0.05) ((zoom(d / pinch, [...pts.values()].reduce((a, b) => a + b) / 2 - track.getBoundingClientRect().left)), (pinch = d));
    } else if (panFrom !== undefined) track.scrollLeft = panFrom - e.clientX;
  });
  const end = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    panFrom = undefined;
    track.classList.remove("dragging");
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("scroll", () => (st.scroll = track.scrollLeft));
  if (st.px) {
    draw();
    queueMicrotask(() => (track.scrollLeft = st.scroll ?? 0));
  } else {
    st.px = 18;
    draw();
    // Fit once the frame has a width.
    requestAnimationFrame(() => track.clientWidth && doFit());
  }
  return box;
}
