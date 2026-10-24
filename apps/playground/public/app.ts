import type { AgentEvent, SurfaceSnapshot } from "@vak/core";
import { defineVakElements, renderMarkdown, type VakActionDetail, VakClient, type VakSurfaceElement } from "@vak/web";

defineVakElements();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const thread = $<HTMLElement>("thread");
const input = $<HTMLTextAreaElement>("input");
const send = $<HTMLButtonElement>("send");
const providerSel = $<HTMLSelectElement>("provider");
const modelInput = $<HTMLInputElement>("model");
const modelList = $<HTMLDataListElement>("models");

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`vak:${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(`vak:${k}`, v);
    } catch {
      /* storage unavailable */
    }
  },
};

const params = new URLSearchParams(location.search);
let session = params.get("session") ?? crypto.randomUUID();
$<HTMLElement>("session-label").textContent = `session ${session}`;
const client = new VakClient("/api/chat");
const mounted = new Map<string, VakSurfaceElement>();
let running: AbortController | undefined;

// --- samples ------------------------------------------------------------------
const SAMPLES: [string, string][] = [
  ["Hotels in Kyoto", "Compare three hotels in Kyoto for a week in November and let me book one"],
  ["Sales dashboard", "Show a Q3 sales dashboard: KPIs, a monthly revenue chart and top 5 products"],
  ["Workout plan", "Plan a 5-day beginner workout routine, one tab per day"],
  ["Newsletter signup", "Make a newsletter signup form with name, email, topics and frequency"],
];
for (const [title, prompt] of SAMPLES) {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = "<b></b><span></span>";
  b.querySelector("b")!.textContent = title;
  b.querySelector("span")!.textContent = prompt;
  b.addEventListener("click", () => submit(prompt));
  $<HTMLElement>("samples").append(b);
}

// --- providers / models ------------------------------------------------------------
interface ProviderInfo { id: string; label: string; available: boolean; reason?: string; defaultModel?: string }

async function loadProviders(): Promise<void> {
  const list = (await (await fetch("/api/providers")).json()) as ProviderInfo[];
  providerSel.replaceChildren(
    ...list.map((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.available ? p.label : `${p.label} (${p.reason})`;
      o.disabled = !p.available;
      return o;
    }),
  );
  const saved = store.get("provider");
  providerSel.value = list.find((p) => p.id === saved && p.available)?.id ?? list.find((p) => p.available)?.id ?? "";
  await loadModels();
}

async function loadModels(): Promise<void> {
  const provider = providerSel.value;
  store.set("provider", provider);
  modelList.replaceChildren();
  const saved = store.get(`model:${provider}`);
  modelInput.value = saved ?? "";
  modelInput.placeholder = "model id";
  const typed = modelInput.value;
  try {
    const res = (await (await fetch(`/api/models?provider=${encodeURIComponent(provider)}`)).json()) as { models: string[]; default?: string };
    // The user may have switched provider or typed while the list loaded.
    if (providerSel.value !== provider) return;
    for (const m of res.models) modelList.append(Object.assign(document.createElement("option"), { value: m }));
    if (modelInput.value === typed && !typed && res.default) modelInput.value = res.default;
    if (!modelInput.value) modelInput.placeholder = res.models.length ? `choose one of ${res.models.length} models` : "model id";
  } catch {
    /* keep whatever is typed */
  }
}
providerSel.addEventListener("change", loadModels);
modelInput.addEventListener("input", () => store.set(`model:${providerSel.value}`, modelInput.value));

// --- viewport + settings ---------------------------------------------------------------
document.body.dataset.w = store.get("viewport") ?? "fluid";
for (const b of document.querySelectorAll<HTMLButtonElement>("#viewport button")) {
  b.setAttribute("aria-pressed", String(b.dataset.w === document.body.dataset.w));
  b.addEventListener("click", () => {
    document.body.dataset.w = b.dataset.w!;
    store.set("viewport", b.dataset.w!);
    for (const x of document.querySelectorAll("#viewport button")) x.setAttribute("aria-pressed", String(x === b));
  });
}
const settingsToggle = $<HTMLButtonElement>("settings-toggle");
settingsToggle.addEventListener("click", () => {
  const el = $<HTMLElement>("settings");
  el.hidden = !el.hidden;
  settingsToggle.setAttribute("aria-expanded", String(!el.hidden));
});
$<HTMLButtonElement>("reset").addEventListener("click", async () => {
  running?.abort();
  await fetch("/api/reset", { method: "POST", body: JSON.stringify({ session }) });
  session = crypto.randomUUID();
  $<HTMLElement>("session-label").textContent = `session ${session}`;
  mounted.clear();
  for (const s of client.store.list()) client.store.remove({ surface: s.id });
  thread.replaceChildren($<HTMLElement>("empty") ?? document.createElement("div"));
  watch();
});

// --- thread rendering ---------------------------------------------------------------------
function add(el: HTMLElement): HTMLElement {
  $<HTMLElement>("empty")?.remove();
  thread.append(el);
  el.scrollIntoView({ block: "end", behavior: "smooth" });
  return el;
}

function userBubble(text: string): void {
  const m = document.createElement("div");
  m.className = "msg user";
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  m.append(b);
  add(m);
}

function eventChip(text: string): void {
  const m = document.createElement("div");
  m.className = "msg event";
  const c = document.createElement("span");
  c.className = "chip";
  c.textContent = text;
  m.append(c);
  add(m);
}

interface Turn { root: HTMLElement; text: HTMLElement; surfaces: HTMLElement; status: HTMLElement }

function newTurn(label: string): Turn {
  const root = document.createElement("div");
  root.className = "msg assistant";
  const text = document.createElement("div");
  text.className = "text";
  const stage = document.createElement("div");
  stage.className = "stage";
  const surfaces = document.createElement("div");
  surfaces.className = "surfaces";
  stage.append(surfaces);
  const status = document.createElement("div");
  status.className = "status";
  status.innerHTML = '<span class="dot"></span><span class="label"></span>';
  status.querySelector(".label")!.textContent = label;
  root.append(text, stage, status);
  add(root);
  return { root, text, surfaces, status };
}

function setStatus(turn: Turn, text: string, state?: "done" | "error"): void {
  turn.status.className = `status ${state ?? ""}`;
  turn.status.querySelector(".label")!.textContent = text;
}

function mount(turn: Turn, snap: SurfaceSnapshot): void {
  let el = mounted.get(snap.id);
  if (!el) {
    el = document.createElement("vak-surface") as VakSurfaceElement;
    mounted.set(snap.id, el);
    turn.surfaces.append(el);
    el.attach(client.store, snap.id);
  } else el.refresh();
}

async function runTurn(req: { message?: string; action?: VakActionDetail["action"] & { data: Record<string, unknown> } }): Promise<void> {
  running?.abort();
  const ctrl = new AbortController();
  running = ctrl;
  send.disabled = true;
  const turn = newTurn("Thinking…");
  const started = performance.now();
  let text = "";
  let frame = 0;
  const provider = providerSel.value;
  const model = modelInput.value.trim();
  store.set(`model:${provider}`, model);

  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case "text_delta":
        text += e.delta;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            turn.text.replaceChildren(renderMarkdown(text));
          });
        }
        break;
      case "tool_start":
        setStatus(turn, e.name.startsWith("vak_") ? "Projecting interface…" : `Running ${e.name}…`);
        break;
      case "surface":
        mount(turn, e.snapshot);
        break;
      case "surface_removed":
        mounted.get(e.id)?.remove();
        mounted.delete(e.id);
        break;
      case "tool_end":
        if (e.isError || e.result !== "ok") {
          const d = document.createElement("details");
          d.className = "diag";
          d.innerHTML = "<summary></summary><pre></pre>";
          d.querySelector("summary")!.textContent = `${e.name}: engine notes (sent back to the model)`;
          d.querySelector("pre")!.textContent = e.result;
          turn.root.insertBefore(d, turn.status);
        }
        break;
      case "error":
        setStatus(turn, e.message, "error");
        break;
      case "run_end":
        if (!turn.status.classList.contains("error")) {
          setStatus(turn, `${provider} · ${model} · ${((performance.now() - started) / 1000).toFixed(1)}s${e.stop === "max_steps" ? " · step limit" : ""}`, "done");
        }
        break;
    }
  };

  try {
    await client.turn(
      {
        session,
        provider,
        model,
        think: $<HTMLInputElement>("think").checked,
        schemaMode: $<HTMLSelectElement>("schema").value,
        generation: $<HTMLSelectElement>("generation").value,
        effort: $<HTMLSelectElement>("effort").value || undefined,
        ...req,
      },
      onEvent,
      ctrl.signal,
    );
  } catch (err) {
    if (!ctrl.signal.aborted) setStatus(turn, (err as Error).message, "error");
  } finally {
    if (running === ctrl) {
      running = undefined;
      send.disabled = false;
    }
    if (frame) cancelAnimationFrame(frame);
    turn.text.replaceChildren(renderMarkdown(text));
  }
}

function submit(text: string): void {
  const t = text.trim();
  if (!t || !modelInput.value.trim()) return;
  userBubble(t);
  input.value = "";
  autosize();
  void runTurn({ message: t });
}

// UI actions from any surface go back to the model.
document.addEventListener("vak-action", (e) => {
  const { action, data } = (e as CustomEvent<VakActionDetail>).detail;
  eventChip(`▸ ${action.action}`);
  void runTurn({ action: { ...action, data } });
});

// --- composer --------------------------------------------------------------------------
function autosize(): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit(input.value);
  }
});
$<HTMLFormElement>("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  submit(input.value);
});

// --- external projections (POST /api/project) ---------------------------------------
let source: EventSource | undefined;
let externalTurn: Turn | undefined;
function watch(): void {
  source?.close();
  source = new EventSource(`/api/events?session=${encodeURIComponent(session)}`);
  source.addEventListener("surface", (m) => {
    const e = JSON.parse((m as MessageEvent).data) as Extract<AgentEvent, { type: "surface" }>;
    client.store.load(e.snapshot);
    if (!mounted.has(e.snapshot.id)) {
      externalTurn = newTurn("");
      setStatus(externalTurn, "projected via /api/project", "done");
    }
    mount(externalTurn ?? newTurn(""), e.snapshot);
  });
  source.addEventListener("surface_removed", (m) => {
    const e = JSON.parse((m as MessageEvent).data) as { id: string };
    mounted.get(e.id)?.remove();
    mounted.delete(e.id);
  });
}

watch();
void loadProviders();
input.focus();
