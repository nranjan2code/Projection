// <vak-surface>: renders a VPS surface from a SurfaceStore into Shadow DOM.
//
// - Keyed reconciliation: nodes whose props did not change keep their DOM
//   (so inputs keep focus and caret while the model streams more nodes).
// - Two-way binding: inputs write into the store's data model; bindings,
//   visibleIf and interpolations re-resolve on the next frame.
// - Actions validate locally (same named checks as the server) and dispatch a
//   `vak-action` event with the action and the surface data model.

import { getAt, isRequired, type ResolvedNode, type SurfaceStore, type VpsAction } from "@vak/core";
import { normalizeChart, renderChart } from "./chart.ts";
import { renderMarkdown } from "./markdown.ts";
import { surfaceCss } from "./styles.ts";

export interface VakActionDetail {
  action: VpsAction;
  /** Surface data model at the time of the action, for server sync. */
  data: Record<string, unknown>;
}

interface Built {
  el: HTMLElement;
  /** Where children go, if the component has any. */
  host?: HTMLElement;
  sig: string;
  /** Push live values (input value, etc.) without rebuilding. */
  sync?: (node: ResolvedNode) => void;
}

const GAP: Record<string, string> = { sm: "var(--gap-sm)", md: "var(--gap-md)", lg: "var(--gap-lg)" };
const MIN_W: Record<string, string> = { sm: "180px", md: "240px", lg: "320px" };

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function md(text: unknown, cls = "md"): HTMLElement {
  const div = h("div", cls);
  div.append(renderMarkdown(str(text)));
  return div;
}

function reconcile(host: HTMLElement, els: HTMLElement[]): void {
  let i = 0;
  for (const el of els) {
    const cur = host.childNodes[i] ?? null;
    if (cur !== el) host.insertBefore(el, cur);
    i++;
  }
  while (host.childNodes.length > els.length) host.lastChild!.remove();
}

type Option = { label: string; value: string };
function options(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      const value = str(r.value ?? r.label ?? r.name);
      return { label: str(r.label ?? r.name ?? r.value), value };
    }
    return { label: str(o), value: str(o) };
  });
}

let uid = 0;

export class VakSurfaceElement extends HTMLElement {
  #store?: SurfaceStore;
  #surfaceId?: string;
  #shadow: ShadowRoot;
  #rootEl: HTMLElement;
  #cache = new Map<string, Built>();
  #errors: Record<string, string[]> = {};
  #tabs = new Map<string, number>();
  #frame = 0;
  #busyKey?: string;
  #busyVersion = -1;
  #seen = new Set<string>();

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = surfaceCss;
    this.#rootEl = h("div", "root");
    this.#shadow.append(style, this.#rootEl);
  }

  /** Bind to a store + surface id and render. */
  attach(store: SurfaceStore, surfaceId: string): void {
    this.#store = store;
    this.#surfaceId = surfaceId;
    this.refresh();
  }

  get surfaceId(): string | undefined {
    return this.#surfaceId;
  }

  /** Schedule a re-render on the next animation frame. */
  refresh(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }

  /** Render synchronously (tests, SSR snapshots). */
  renderNow(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#render();
  }

  #render(): void {
    const store = this.#store;
    const id = this.#surfaceId;
    if (!store || !id) return;
    const surface = store.resolve(id);
    if (!surface) {
      reconcile(this.#rootEl, []);
      return;
    }
    if (this.#busyKey && surface.version !== this.#busyVersion) this.#busyKey = undefined;
    const els: HTMLElement[] = [];
    if (surface.title) {
      const t = (this.#cache.get("$title")?.el as HTMLElement | undefined) ?? h("h2", "title");
      t.textContent = surface.title;
      this.#cache.set("$title", { el: t, sig: surface.title });
      els.push(t);
    }
    const live = new Set<string>();
    if (surface.root) els.push(this.#node(surface.root, live));
    reconcile(this.#rootEl, els);
    for (const key of this.#cache.keys()) if (!live.has(key) && key !== "$title") this.#cache.delete(key);
  }

  #node(node: ResolvedNode, live: Set<string>): HTMLElement {
    live.add(node.key);
    const { value: _value, ...stable } = node.props;
    const sig = JSON.stringify([
      node.type,
      stable,
      node.error,
      this.#errors[node.key],
      node.type === "tabs" ? [this.#tabs.get(node.key), node.children.map((c) => str(c.props.title))] : 0,
      this.#busyKey === node.key,
    ]);
    let built = this.#cache.get(node.key);
    if (!built || built.sig !== sig) {
      built = { ...this.#build(node), sig };
      const { span, priority } = node.props;
      if (span !== undefined) built.el.classList.add(span === "full" || Number(span) >= 5 ? "span-full" : `span-${Math.max(1, Math.min(4, Number(span) || 1))}`);
      if (typeof priority === "string") built.el.classList.add(`p-${priority}`);
      if (!this.#seen.has(node.key)) {
        built.el.classList.add("enter");
        this.#seen.add(node.key);
      }
      this.#cache.set(node.key, built);
    }
    built.sync?.(node);
    if (built.host) {
      const kids = node.type === "tabs" ? this.#activeTab(node) : node.children;
      reconcile(built.host, kids.map((c) => this.#node(c, live)));
    }
    return built.el;
  }

  #activeTab(node: ResolvedNode): ResolvedNode[] {
    const i = Math.min(this.#tabs.get(node.key) ?? 0, Math.max(node.children.length - 1, 0));
    return node.children[i] ? [node.children[i]] : [];
  }

  // -------------------------------------------------------------------------
  // Interaction

  #setValue(path: string | undefined, key: string, value: unknown): void {
    if (!path || !this.#store || !this.#surfaceId) return;
    this.#store.setValue(this.#surfaceId, path, value);
    if (this.#errors[key]) delete this.#errors[key];
    this.dispatchEvent(new CustomEvent("vak-change", { detail: { surface: this.#surfaceId, path, value }, bubbles: true, composed: true }));
    this.refresh();
  }

  #act(key: string): void {
    const store = this.#store;
    const id = this.#surfaceId;
    if (!store || !id || this.#busyKey) return;
    const res = store.submit(id, key, "web");
    this.#errors = res.errors;
    if (!res.action) {
      this.renderNow();
      const first = this.#shadow.querySelector<HTMLElement>(".field.invalid :is(input, select, textarea, button)");
      first?.focus();
      return;
    }
    this.#busyKey = key;
    this.#busyVersion = store.get(id)?.version ?? -1;
    this.renderNow();
    const detail: VakActionDetail = { action: res.action, data: structuredClone(store.get(id)!.data) };
    this.dispatchEvent(new CustomEvent("vak-action", { detail, bubbles: true, composed: true }));
  }

  // -------------------------------------------------------------------------
  // Components

  #build(node: ResolvedNode): Omit<Built, "sig"> {
    const p = node.props;
    const gap = GAP[str(p.gap)] ?? "var(--gap-md)";
    switch (node.type) {
      case "stack": {
        const el = h("div", `stack ${p.direction === "horizontal" ? "horizontal" : ""} ${p.wrap ? "wrap" : ""} ${p.align ? `align-${str(p.align)}` : ""}`);
        el.style.setProperty("--gap", gap);
        return { el, host: el };
      }
      case "grid": {
        const box = h("div", "grid-box");
        const grid = h("div", "grid");
        const cols = Number(p.columns);
        grid.style.setProperty("--cols", String(Number.isFinite(cols) && cols > 0 ? Math.min(cols, 6) : 4));
        grid.style.setProperty("--min", MIN_W[str(p.minItemWidth)] ?? MIN_W.md!);
        grid.style.setProperty("--gap", gap);
        box.append(grid);
        return { el: box, host: grid };
      }
      case "split": {
        const box = h("div", "split-box");
        const ratio = ["1:1", "2:1", "1:2", "3:1", "1:3"].includes(str(p.ratio)) ? str(p.ratio) : "2:1";
        const split = h("div", `split r-${ratio.replace(":", "-")}`);
        split.style.setProperty("--gap", gap);
        box.append(split);
        return { el: box, host: split };
      }
      case "section": {
        const el = h("section", "section");
        if (p.title || p.description) {
          const head = h("header");
          if (p.title) head.append(h("h3", undefined, str(p.title)));
          if (p.description) head.append(h("p", undefined, str(p.description)));
          el.append(head);
        }
        const host = h("div", "stack");
        host.style.setProperty("--gap", "var(--gap-md)");
        el.append(host);
        return { el, host };
      }
      case "tabs": {
        const el = h("div", "tabs");
        const list = h("div", "tablist");
        list.setAttribute("role", "tablist");
        const active = this.#tabs.get(node.key) ?? 0;
        node.children.forEach((c, i) => {
          const b = h("button", undefined, str(c.props.title ?? c.props.label) || `Tab ${i + 1}`);
          b.setAttribute("role", "tab");
          b.setAttribute("aria-selected", String(i === active));
          b.addEventListener("click", () => {
            this.#tabs.set(node.key, i);
            this.renderNow();
          });
          list.append(b);
        });
        const host = h("div");
        host.setAttribute("role", "tabpanel");
        el.append(list, host);
        return { el, host };
      }
      case "card": {
        const el = h("article", `card ${p.tone && p.tone !== "neutral" ? `tone-${str(p.tone)}` : ""}`);
        if (typeof p.image === "string" && /^(https?:|data:image\/)/.test(p.image)) {
          const img = h("img");
          img.src = p.image;
          img.alt = str(p.title);
          img.loading = "lazy";
          img.addEventListener("error", () => img.remove(), { once: true });
          el.append(img);
        }
        const body = h("div", "body");
        if (p.title || p.badge || p.subtitle) {
          const head = h("div", "head");
          const titles = h("div");
          if (p.title) titles.append(h("h3", undefined, str(p.title)));
          if (p.subtitle) titles.append(h("p", "sub", str(p.subtitle)));
          head.append(titles);
          if (p.badge) head.append(h("span", "badge", str(p.badge)));
          body.append(head);
        }
        if (p.body) body.append(md(p.body));
        const kids = h("div", "kids");
        body.append(kids);
        el.append(body);
        return { el, host: kids };
      }
      case "text": {
        const variant = str(p.variant) || "body";
        const el = variant === "code" ? h("pre", "text code") : md(p.content ?? "", `text ${variant}`);
        if (variant === "code") el.append(h("code", undefined, str(p.content)));
        return { el };
      }
      case "stat": {
        const el = h("div", "stat");
        el.append(h("span", "label", str(p.label)), h("span", "value", str(p.value)));
        if (p.delta !== undefined && p.delta !== "") {
          const trend = str(p.trend) || (/^\s*-/.test(str(p.delta)) ? "down" : /^\s*\+/.test(str(p.delta)) ? "up" : "flat");
          el.append(h("span", `delta ${trend}`, `${trend === "up" ? "▲ " : trend === "down" ? "▼ " : ""}${str(p.delta)}`));
        }
        return { el };
      }
      case "table":
        return { el: this.#table(p) };
      case "list": {
        const el = h(p.ordered ? "ol" : "ul", "list");
        for (const item of Array.isArray(p.items) ? p.items : []) {
          const li = h("li");
          li.append(renderMarkdown(str(item)));
          // renderMarkdown wraps text in <p>; unwrap single paragraphs.
          if (li.childNodes.length === 1 && li.firstElementChild?.tagName === "P") li.replaceChildren(...li.firstElementChild.childNodes);
          el.append(li);
        }
        return { el };
      }
      case "chart":
        return this.#chart(normalizeChart(p));
      case "alert": {
        const el = h("div", `alert ${p.tone ? `tone-${str(p.tone)}` : ""}`);
        el.setAttribute("role", p.tone === "danger" || p.tone === "warning" ? "alert" : "status");
        const body = h("div");
        if (p.title) body.append(h("strong", undefined, str(p.title)));
        if (p.body) body.append(md(p.body));
        el.append(body);
        return { el };
      }
      case "image": {
        const img = h("img", "image");
        if (typeof p.src === "string" && /^(https?:|data:image\/)/.test(p.src)) img.src = p.src;
        img.alt = str(p.alt);
        img.loading = "lazy";
        return { el: img };
      }
      case "divider":
        return { el: h("hr", "divider") };
      case "button": {
        const style = str(p.style) || "secondary";
        const b = h("button", `btn ${style}`, str(p.label) || "OK");
        b.type = "button";
        if (this.#busyKey === node.key) b.disabled = true;
        b.addEventListener("click", () => this.#act(node.key));
        return { el: b };
      }
      case "form": {
        const box = h("div", "form-box");
        const form = h("form", "form");
        form.noValidate = true;
        const fields = h("div", "fields");
        const actions = h("div", "actions");
        const submit = h("button", "btn primary", str(p.submitLabel) || "Submit");
        submit.type = "submit";
        if (this.#busyKey === node.key) submit.disabled = true;
        actions.append(submit);
        form.append(fields, actions);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          this.#act(node.key);
        });
        box.append(form);
        return { el: box, host: fields };
      }
      case "input":
      case "textarea":
      case "date":
      case "select":
      case "checkbox":
        return this.#field(node);
      case "$pending":
        return { el: h("div", "pending") };
      default: {
        const el = h("div", "invalid-node", node.error ? `⚠ ${node.error}` : `Unsupported: ${node.type}`);
        return { el };
      }
    }
  }

  /** Charts re-render at their real width so labels stay legible in narrow columns. */
  #chart(spec: ReturnType<typeof normalizeChart>): Omit<Built, "sig"> {
    const box = h("div");
    let lastWidth = 0;
    const draw = (w: number) => {
      lastWidth = w;
      box.replaceChildren(renderChart(spec, document, w - 28));
    };
    draw(640);
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0 && Math.abs(w - lastWidth) > 24) draw(w);
    });
    ro.observe(box);
    return { el: box };
  }

  #table(p: Record<string, unknown>): HTMLElement {
    const box = h("div", "table-box");
    const rows = (Array.isArray(p.rows) ? p.rows : []) as unknown[];
    let cols = (Array.isArray(p.columns) ? p.columns : []).map((c) =>
      c && typeof c === "object" ? (c as Record<string, unknown>) : { key: str(c), label: str(c) },
    );
    if (!cols.length && rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
      cols = Object.keys(rows[0] as object).map((k) => ({ key: k, label: k }));
    }
    const table = h("table");
    const thead = h("thead");
    const hr = h("tr");
    for (const c of cols) {
      const th = h("th", c.align === "end" ? "a-end" : c.align === "center" ? "a-center" : undefined, str(c.label ?? c.key));
      th.scope = "col";
      hr.append(th);
    }
    thead.append(hr);
    const tbody = h("tbody");
    for (const row of rows) {
      const tr = h("tr");
      cols.forEach((c, i) => {
        const v = Array.isArray(row) ? row[i] : row && typeof row === "object" ? (row as Record<string, unknown>)[str(c.key)] : row;
        const td = h("td", c.align === "end" ? "a-end" : c.align === "center" ? "a-center" : undefined, str(v));
        td.dataset.label = str(c.label ?? c.key);
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    box.append(table);
    return box;
  }

  #field(node: ResolvedNode): Omit<Built, "sig"> {
    const p = node.props;
    const id = `f${++uid}`;
    const errors = this.#errors[node.key] ?? [];
    const wrap = h("div", `field ${errors.length ? "invalid" : ""} ${node.type === "textarea" ? "wide" : ""}`);
    const label = h("label", undefined, str(p.label));
    label.htmlFor = id;
    if (isRequired(p.checks)) label.append(h("span", "req", "*"));
    const set = (v: unknown) => this.#setValue(node.bindPath, node.key, v);
    let sync: Built["sync"];
    const focused = (el: Element) => this.#shadow.activeElement === el;

    if (node.type === "checkbox") {
      const l = h("label", "check");
      const box = h("input");
      box.type = "checkbox";
      box.id = id;
      box.addEventListener("change", () => set(box.checked));
      l.append(box, document.createTextNode(str(p.label)));
      wrap.append(l);
      sync = (n) => (box.checked = Boolean(n.props.value));
    } else if (node.type === "select") {
      const opts = options(p.options);
      const caption = h("span", "label", str(p.label));
      if (isRequired(p.checks)) caption.append(h("span", "req", "*"));
      wrap.append(caption);
      if (p.multiple || (opts.length > 0 && opts.length <= 6)) {
        const seg = h("div", "seg");
        seg.setAttribute("role", p.multiple ? "group" : "radiogroup");
        const buttons = opts.map((o) => {
          const b = h("button", undefined, o.label);
          b.type = "button";
          b.addEventListener("click", () => {
            const cur = node.bindPath ? getAt(this.#store?.get(this.#surfaceId!)?.data, node.bindPath) : undefined;
            if (p.multiple) {
              const arr = Array.isArray(cur) ? cur.map(str) : [];
              set(arr.includes(o.value) ? arr.filter((v) => v !== o.value) : [...arr, o.value]);
            } else set(o.value);
          });
          seg.append(b);
          return { b, o };
        });
        wrap.append(seg);
        sync = (n) => {
          const v = n.props.value;
          const sel = Array.isArray(v) ? v.map(str) : [str(v)];
          for (const { b, o } of buttons) b.setAttribute("aria-pressed", String(sel.includes(o.value)));
        };
      } else {
        wrap.replaceChildren(label);
        const sel = h("select");
        sel.id = id;
        sel.append(Object.assign(h("option", undefined, "Choose…"), { value: "" }));
        for (const o of opts) sel.append(Object.assign(h("option", undefined, o.label), { value: o.value }));
        sel.addEventListener("change", () => set(sel.value));
        wrap.append(sel);
        sync = (n) => {
          if (!focused(sel)) sel.value = str(n.props.value);
        };
      }
    } else if (node.type === "date" && p.range) {
      wrap.append(label);
      const r = h("div", "range");
      const a = h("input");
      const b = h("input");
      a.type = b.type = "date";
      a.id = id;
      a.setAttribute("aria-label", `${str(p.label)} start`);
      b.setAttribute("aria-label", `${str(p.label)} end`);
      const push = () => set([a.value, b.value]);
      a.addEventListener("input", push);
      b.addEventListener("input", push);
      r.append(a, h("span", undefined, "→"), b);
      wrap.append(r);
      sync = (n) => {
        const v = Array.isArray(n.props.value) ? n.props.value : [];
        if (!focused(a)) a.value = str(v[0]);
        if (!focused(b)) b.value = str(v[1]);
      };
    } else {
      wrap.append(label);
      const ctl = node.type === "textarea" ? h("textarea") : h("input");
      ctl.id = id;
      if (ctl instanceof HTMLInputElement) {
        const kind = node.type === "date" ? "date" : str(p.kind) || "text";
        ctl.type = ["text", "email", "number", "tel", "url", "date"].includes(kind) ? kind : "text";
        if (kind === "email") ctl.autocomplete = "email";
      }
      if (p.placeholder) ctl.placeholder = str(p.placeholder);
      ctl.addEventListener("input", () => {
        const v = ctl instanceof HTMLInputElement && ctl.type === "number" && ctl.value !== "" ? Number(ctl.value) : ctl.value;
        set(v);
      });
      wrap.append(ctl);
      sync = (n) => {
        if (!focused(ctl)) ctl.value = str(n.props.value);
      };
    }
    if (errors.length) {
      const err = h("div", "err", errors.join(" · "));
      err.id = `${id}-err`;
      err.setAttribute("role", "alert");
      wrap.append(err);
      wrap.querySelector("input, select, textarea")?.setAttribute("aria-describedby", err.id);
      wrap.querySelector("input, select, textarea")?.setAttribute("aria-invalid", "true");
    }
    return { el: wrap, sync };
  }
}

export function defineVakElements(): void {
  if (!customElements.get("vak-surface")) customElements.define("vak-surface", VakSurfaceElement);
}
