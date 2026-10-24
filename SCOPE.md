# vakProjection — Scope (v1)

_Drafted 2026-10-24._

## One-liner

A TypeScript engine that hands any LLM a set of **projection tools**. The model describes rich, interactive UI once (cards, forms, tables, stats, lists, charts) in a **target-neutral spec**. **Projectors** then turn that spec into the best native form for each surface: web, mobile and tablet, Telegram, Discord, Slack and others. User interactions on any surface flow back to the model in a full loop.

## Hard constraints

- **Zero third-party runtime dependencies.** We write the provider adapters, stream parser, validator, renderers, chat-platform clients (raw Bot/Web APIs over `fetch`) and transport ourselves. Other systems are studied for ideas (see [STUDY.md](STUDY.md)); nothing of theirs is imported.
- **Project anywhere.** The spec never assumes a screen, so every target is a projector plugin.
- **Multi-provider.** Anthropic, OpenAI (Responses + Chat Completions), Gemini, plus any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, OpenRouter).
- Dev-only tooling (TypeScript compiler, test runner) is allowed unless you say otherwise.

## Landscape (October 2026)

| Option | What it is | Status | Takeaway for us |
|---|---|---|---|
| **A2UI** (Google) | Surfaces, flat id components, data model, actions | v0.9.1 stable, v1.0 RC targeted for Q4 2026 | Best data model; verbose for LLMs |
| **json-render** (Vercel Labs) | Catalog → prompt + validator; many render targets | 0.19 | "One spec, many targets" proven; deep trees are fragile |
| **OpenUI Lang** (Thesys) | Line DSL, root first | Vendor-benchmarked at ~½ the tokens | Token economy; degrade per node |
| **AG-UI** (CopilotKit) | Event transport | Active (2026-10-21) | Event taxonomy for our wire |
| **MCP Apps** (SEP-1865) | `ui://` HTML in a sandboxed iframe | Stable 2026-01-26 | Later export target |

### What the chat platforms can render natively (to verify against official docs while building)

| | Layout | Inputs | Hard limits (third-party sourced) | Escape hatch |
|---|---|---|---|---|
| **Slack** Block Kit | sections, header, context, fields; new (Apr 2026) **card, alert, carousel, data_table, chart?** | full **modals** with inputs, selects, date pickers; buttons in messages | 50 blocks/msg, 100/modal, table ≤100×20, modal title 24 chars | App Home tab |
| **Discord** Components V2 | container, section (+thumbnail/button), text display, media gallery, separator | buttons, selects in message; **modal ≤5 text inputs** | ~40 components / 4,000 chars per msg; select ≤25 options | Activities (embedded web app) |
| **Telegram** Bot API (10.x) | HTML/Markdown text, media; possibly new "rich message blocks" in 10.2 (unverified) | **inline keyboards** (callback buttons), reply keyboards; **no native forms** | 4,096 chars/msg, 64-byte `callback_data` | **Mini Apps**: full web view |

**Key insight:** every chat platform has a web escape hatch (Telegram Mini Apps, Discord Activities, Slack link-outs), so **our web renderer doubles as the high-fidelity fallback on chat surfaces.**

## Architecture

```
 LLM (any provider)
   │  tools: vak_render · vak_update · vak_remove   (+ target capabilities in prompt)
   ▼
 [1] Provider adapters ── normalize streaming tool-call deltas
   ▼
 [2] Projection engine ── VPS → surface state (nodes + data model)
   │  partial-JSON parser, repair, validation; per-node degrade
   ▼
 [3] Projector registry ── one projector per target, each declares a
   │                       CapabilityProfile and maps VPS → native
   ├── web        → <vak-surface> Web Components (responsive: phone / tablet / desktop)
   ├── slack      → Block Kit messages + modals         (Web API + interactivity webhook)
   ├── discord    → Components V2 + modals              (REST + interactions endpoint)
   ├── telegram   → formatted text + inline keyboards,  (Bot API, webhook / long-poll)
   │                stepwise forms, or Mini App link
   ├── markdown / plain text / terminal / email  → text-first projections
   └── (later) whatsapp, teams, mcp-apps, native mobile
   ▼
 [4] Interaction adapters ── button press / modal submit / callback_query /
   │                         web form → one normalized VPS `action` event
   └──────────────► back to [1] as a tool result → model continues
```

### Capability profiles and the degradation ladder

Each projector declares what it supports: components, max inputs per form, streaming (edit-in-place vs. none), media, text limits and markup dialect. The engine uses that profile in two ways:

1. **Before generation:** the catalog sent to the LLM is narrowed to what the target can render, so the model doesn't plan a chart for a terminal.
2. **At projection:** anything unsupported degrades through a fixed ladder, never silently dropped.

| VPS node | web | Slack | Discord | Telegram | text |
|---|---|---|---|---|---|
| card | card | section/card block | container + section | bold title + body + buttons | heading + body |
| form (≤5 fields) | inline form | modal | modal | stepwise Q&A via keyboards, **or** Mini App | numbered prompts |
| form (>5 fields / rich) | inline form | modal | split modals **or** Activity link | Mini App | prompts |
| table | responsive table | data_table | monospace block / paged | `<pre>` table, paged with buttons | ASCII table |
| chart | SVG chart | chart block if available, else image | image | image | sparkline / table |
| select | select | static_select | string select | inline keyboard | numbered list |

Images (chart → PNG) need our own SVG rasterizer, which is a stretch goal. Until it exists, charts fall back to a table or a Mini App/web link on platforms without vector support.

**Streaming per target:** web renders node by node; Slack, Discord and Telegram stream by **editing the posted message** (rate-limited, debounced); text targets stream lines.

## Adaptive layout (not a single column)

Layout is semantic, so every projector can adapt it:
- **`grid`**: as many columns as fit (`columns` caps it at 1–6, `minItemWidth` sm|md|lg). It collapses to one column on phones.
- **`split`**: primary + secondary panes (`ratio` 1:1, 2:1, 1:2, 3:1, 1:3). They stack on narrow screens.
- **`stack`**: vertical or horizontal (`wrap` for toolbars and chip rows). Also `section` and `tabs`.
- **Common props on every node:** `span` (1–4 or `full`) for bento-style dashboards, and `priority` (primary|secondary|tertiary) to decide what survives on small screens and in what order chat targets flatten things.

The web renderer uses **container queries** rather than viewport media queries, so a surface adapts to the box it sits in (a side panel, a phone, a 4K dashboard). Linear targets (Telegram, text) flatten in `priority` order.

## Reliability is the engine's job

Ollama runs locally and is the primary test provider. When a model slips, we fix the engine, never "the model is too small". Repairs built so far, each covered by tests:
- A lenient parser handles code fences and prose, comments, trailing commas, single quotes, unquoted keys, Python literals and truncated streams.
- **Double-encoded args** (`"nodes": "[...]"`) are unwrapped.
- **Nested nodes** are flattened, **top-level props** are hoisted, type names are matched case-insensitively and missing ids are generated.
- **A missing `type` is inferred** from props (title+body → card, label+bind → input, …).
- **Schema-driven coercion** fixes wrong-shaped values: objects → their text field, numbers ↔ strings, a lone item → an array.
- **Orphaned nodes are attached to the root** (wrapped in a stack if needed) rather than hidden.
- A button outside a form collects the inputs in its nearest container.
- Diagnostics go back as the tool result, and the model self-corrects with `vak_update`. Invalid nodes keep being reported until they are fixed.

Smoke result (2026-10-24, `scripts/ollama-smoke.ts`): qwen3.5 0.8B rendered valid card/grid UIs 5/5 in ~3s; qwen3.5 4B rendered hotel cards + booking form in ~36s.

## Vak Projection Spec (VPS), as the LLM sees it

Three tools are generated from the catalog:

```jsonc
// vak_render: create or replace a surface. Nodes are flat, root first, children by id.
{
  "surface": "trip",
  "nodes": [
    { "id": "root", "type": "stack", "children": ["hdr", "f"] },
    { "id": "hdr",  "type": "card",  "props": { "title": "Plan your trip", "subtitle": "{/user/name}" } },
    { "id": "f",    "type": "form",  "props": { "submit": "book" }, "children": ["dest", "when"] },
    { "id": "dest", "type": "input", "props": { "label": "Destination", "bind": "/form/dest",
                                               "checks": ["required"] } },
    { "id": "when", "type": "date",  "props": { "label": "Dates", "bind": "/form/when", "range": true } }
  ],
  "data": { "user": { "name": "Nisheeth" }, "form": {} }
}

// vak_update: patch nodes and/or data on an existing surface
{ "surface": "trip", "nodes": [ { "id": "hdr", "props": { "title": "3 options found" } } ],
  "data": [ { "op": "replace", "path": "/results", "value": [ /* ... */ ] } ] }

// vak_remove: drop a surface or specific nodes
{ "surface": "trip", "ids": ["f"] }
```

What comes back to the model as a tool result is identical whatever the platform:

```json
{ "action": "book", "surface": "trip", "source": "f", "target": "telegram",
  "data": { "dest": "Kyoto", "when": ["2026-11-10","2026-11-17"] } }
```

**Core rules**
- `"{/path}"` interpolates data into strings, and `bind` is two-way.
- Lists use `{"each": "/results", "template": "tplId"}`.
- `checks` and `visibleIf` reference named functions only. Every projector runs them server-side, so Telegram and Discord get validation too.
- Presentation hints (`emphasis`, `tone`, `priority`) are semantic, not pixel values, so each projector can interpret them.
- An invalid node degrades to a placeholder, and the error goes back to the model.
- **Session state lives server-side** (surface id ↔ platform message ids ↔ data model), because chat platforms only round-trip tiny ids such as Telegram's 64-byte `callback_data`.

## Deliverables (phased)

**Phase 1: core and web**
1. `@vak/core`: VPS types, catalog, tool-schema generator, validator, streaming partial-JSON parser, surface state store, check functions, capability profiles, projector interface.
2. `@vak/providers`: fetch-based Anthropic, OpenAI, Gemini and OpenAI-compatible adapters plus the agent loop.
3. `@vak/web`: Web Components renderer that is responsive across phone, tablet and desktop via container queries, themeable, accessible, and progressively streamed.
4. `@vak/transport`: event protocol, SSE server helper and client.
5. Playground: chat UI with a provider picker and a **target preview switcher** (web / Slack / Discord / Telegram / text mock renderings side by side).

**Phase 2: chat projectors**
6. `@vak/telegram`, `@vak/slack`, `@vak/discord`: each has a projector, an interaction adapter (webhook verification, callback routing), message-edit streaming and a hand-written thin API client.
7. Web fallback hosting for Telegram Mini Apps and Discord Activities, reusing `@vak/web`.

**Phase 3: more surfaces**
8. Markdown/text/terminal and email projectors; then WhatsApp, Teams and an MCP Apps export.

### Starter component catalog
Card · Form + fields (input, textarea, select, checkbox, date, number) · Table · Stat/KPI · List · Chart (bar/line/pie) · Callout/Alert · Tabs · Stack/Grid · Text (markdown) · Button/Action · Image.

## Out of scope for v1
Native iOS/Android SDK renderers (the web renderer covers mobile and tablet responsively), auth/multi-tenant hosting, an OpenUI-style DSL.

## Open questions
1. Which chat platform comes first in Phase 2? Or should Phase 1 already include one?
2. Runtime: Node 24 is installed (Bun/Deno are not), so Node is the default; it runs TypeScript natively, which is why there is no build step.
3. Dev tooling: typescript (typecheck only) + @types/node; tests use the built-in node:test runner.
