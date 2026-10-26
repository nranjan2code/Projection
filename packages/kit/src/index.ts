// createVak(): the engine, a model and a projector in one call, for any
// project that wants a model to answer with UI:
//
//   const vak = createVak({ model: "ollama:qwen3.5:4b-mlx" });
//   const reply = await vak.ask("Compare three laptops for a student");
//   console.log(vak.render("terminal"));          // or "markdown", "text"
//   const mail = vak.email({ openUrl });           // { subject, html, text }
//   await vak.act({ surface, source, data });      // a button or form, answered
//
// Keys come from the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...) the
// same way everywhere in vak. Tools (MCP integrations) pass straight through.

import { tmpdir } from "node:os";
import path from "node:path";
import { type AgentEvent, basicCatalog, type Catalog, projectAnsi, projectMarkdown, projectText, type ResolvedSurface, SurfaceStore, type VpsAction } from "@vak/core";
import { type EmailOptions, type EmailProjection, projectEmail } from "@vak/email";
import { actionMessage, type AgentTool, choosePlan, hardenNetwork, type Message, ProfileCache, type ProjectionPlan, type Provider, providersFromEnv, resolveProfile, runAgent } from "@vak/providers";

export interface VakOptions {
  /** "provider:model" (e.g. "anthropic:claude-opus-5-5", "ollama:qwen3.5:4b-mlx"), or a provider object with `model`. */
  model: string;
  provider?: Provider;
  instructions?: string;
  catalog?: Catalog;
  tools?: AgentTool[];
  /** Recent turns the model sees (default 10; the whole history is kept). */
  history?: number;
  /** Where model profiles are cached (default: the system temp folder). */
  profilesPath?: string;
  env?: Record<string, string | undefined>;
  /** Every event of every turn (text deltas, surfaces as they stream, tool calls). */
  onEvent?: (e: AgentEvent) => void;
}

export interface Reply {
  text: string;
  /** Surfaces created or changed in this turn, resolved (bindings filled). */
  surfaces: ResolvedSurface[];
  stop: string;
}

export type Target = "text" | "markdown" | "terminal";

export interface Vak {
  readonly store: SurfaceStore;
  readonly messages: Message[];
  ask(message: string, opts?: { signal?: AbortSignal }): Promise<Reply>;
  /** Answer a button press or form submission on one of the surfaces. */
  act(action: { surface: string; source: string; data?: Record<string, unknown> }, opts?: { signal?: AbortSignal }): Promise<Reply>;
  /** Every surface (or one), projected for a target. */
  render(target: Target, surface?: string, opts?: { width?: number; color?: boolean }): string;
  email(opts?: EmailOptions & { surface?: string }): EmailProjection;
}

const DEFAULT_INSTRUCTIONS = `Answer with rich UI when the answer has structure the user will scan, compare or act on (options, comparisons, metrics, steps, forms); keep the accompanying text to one short sentence, the UI carries the content.
Answer conversation and short answers in plain text, without UI: greetings, thanks, small talk, a fact or an explanation of a few sentences, or whatever the user asks for as text.
When you lack real data, use realistic sample data and say it is sample data in a caption.
When you receive a "[ui action]" message, the user interacted with your UI: respond to it, usually by updating that surface (vak_update) or rendering a confirmation.`;

export function createVak(opts: VakOptions): Vak {
  hardenNetwork();
  const sep = opts.model.indexOf(":");
  const providerId = opts.provider ? opts.provider.id : opts.model.slice(0, sep);
  const model = opts.provider ? opts.model : opts.model.slice(sep + 1);
  let provider = opts.provider;
  if (!provider) {
    if (sep < 1) throw new Error(`model must be "provider:model", e.g. "ollama:qwen3.5:4b-mlx" (got "${opts.model}")`);
    const entry = providersFromEnv(opts.env).find((p) => p.id === providerId);
    if (!entry) throw new Error(`unknown provider "${providerId}"`);
    if (!entry.available) throw new Error(`${entry.label} is not available: ${entry.reason ?? "missing configuration"}`);
    provider = entry.make();
  }
  const store = new SurfaceStore(opts.catalog ?? basicCatalog);
  const messages: Message[] = [];
  const profiles = new ProfileCache(opts.profilesPath ?? path.join(tmpdir(), "vak-models.json"));
  let plan: Promise<ProjectionPlan | undefined> | undefined;

  async function turn(signal?: AbortSignal): Promise<Reply> {
    plan ??= resolveProfile(providerId, provider!, model, profiles, AbortSignal.timeout(8000))
      .then((profile) => choosePlan(profile, { userTools: Boolean(opts.tools?.length) }))
      .catch(() => undefined);
    let text = "";
    const touched = new Set<string>();
    const res = await runAgent({
      provider: provider!,
      model,
      store,
      messages,
      plan: await plan,
      instructions: opts.instructions ?? DEFAULT_INSTRUCTIONS,
      tools: opts.tools,
      history: opts.history ?? 10,
      signal,
      emit: (e) => {
        if (e.type === "text_delta") text += e.delta;
        if (e.type === "surface") touched.add(e.snapshot.id);
        opts.onEvent?.(e);
      },
    });
    return { text, stop: res.stop, surfaces: [...touched].map((id) => store.resolve(id)).filter((s): s is ResolvedSurface => Boolean(s)) };
  }

  const surfacesFor = (id?: string) => (id ? [store.resolve(id)] : store.list().map((s) => store.resolve(s.id))).filter((s): s is ResolvedSurface => Boolean(s));

  return {
    store,
    messages,
    async ask(message, o = {}) {
      messages.push({ role: "user", content: message });
      return turn(o.signal);
    },
    async act(action, o = {}) {
      if (action.data) store.setData(action.surface, action.data);
      const result = store.submit(action.surface, action.source, "kit");
      if (!result.action) throw new Error(`action rejected: ${JSON.stringify(result.errors)}`);
      messages.push(actionMessage(result.action as VpsAction));
      return turn(o.signal);
    },
    render(target, surface, o = {}) {
      const project = target === "markdown" ? projectMarkdown : target === "terminal" ? (s: ResolvedSurface) => projectAnsi(s, o) : projectText;
      return surfacesFor(surface).map(project).join("\n\n");
    },
    email(o = {}) {
      const [first] = surfacesFor(o.surface);
      if (!first) throw new Error("nothing to send: no surface yet");
      return projectEmail(first, o);
    },
  };
}
