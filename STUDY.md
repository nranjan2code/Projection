# Study: how others project LLM output into UI (Oct 2026)

What we take from each system, and what we leave behind. We build none of this on their code. These notes are design input only.

## A2UI v0.9.1 (Google; v1.0 RC targeted for Q4 2026)

**How it works**
- A JSONL stream of envelopes `{version, createSurface | updateComponents | updateDataModel | deleteSurface}`.
- A **surface** is one independent UI region (`surfaceId`, `catalogId`, `theme`, `sendDataModel`).
- Components form a **flat adjacency list**: `{id, component, ...props, children:[ids] | child:id}`. Exactly one `id:"root"` is allowed, and components may arrive in any order.
- **One data model per surface**, updated with `{path (JSON Pointer), value}`. Omitting `value` deletes the key.
- Props can be a literal, `{path}`, or `{call, args}`. Strings interpolate with `${/user/name}`.
- Lists use templated children: `{path:"/items", componentId:"tpl"}`, and relative paths inside the template resolve per item.
- Validation uses `checks:[{call:"required", args, message}]`, which are **named client functions, never code**. Buttons auto-disable when a check fails.
- Actions are either a server `event{name, context}` or a local `functionCall`. The client sends `action{name, surfaceId, sourceComponentId, timestamp, context}`, plus the data model when `sendDataModel` is set.
- The catalog is negotiated per surface.

**Take:** surfaces; flat id-addressed nodes; a separate data model with JSON Pointer binding; templated lists; named-function checks; action envelopes that carry context; the "data, not code" safety stance.
**Leave:** verbosity, the version envelope on every line, and catalog negotiation (overkill for v1).

## json-render (Vercel Labs, v0.19)

**How it works**
- The catalog (component → prop schema + description) is the *single contract*. It generates the prompt and the validator.
- A registry maps catalog entries to real components, and components `emit(action)`.
- State binding uses `{"$state":"/user/name"}` and `{"$computed":"fn"}`. Elements can have visibility conditions.
- It streams progressively (SpecStream / JSON Patch).
- In its own phrasing, only components in the catalog can render.

**Take:** **one catalog definition generates everything**: tool JSON Schema, prompt text, runtime validator and renderer registration. Visibility conditions. Strict catalog enforcement.
**Leave:** lowest structural validity in the benchmarks as screens grow (82.8%), because deep nesting is fragile for LLMs. That pushes us toward flat nodes.

## OpenUI Lang (Thesys)

**How it works**
- A line DSL in which each line is `name = Component(positional, args)`.
- **Root first, with forward references**, so the skeleton paints before the details arrive.
- Roughly 2× fewer tokens than JSON formats (vendor benchmark).
- Invalid fragments are discarded, not fatal.

**Take:** token economy matters for latency and cost; emit the root and structure first, then fill in; **degrade per node, never crash the surface**.
**Leave:** a DSL can't ride the native JSON-Schema tool calling that every provider supports, so the LLM would have to free-text it.

## AG-UI (CopilotKit)

**How it works**
- A typed event stream: `RUN_STARTED/FINISHED/ERROR`, `TEXT_MESSAGE_START/CONTENT/END`, `TOOL_CALL_START/ARGS/END/RESULT`, `STATE_SNAPSHOT`, `STATE_DELTA` (JSON Patch, RFC 6902), `MESSAGES_SNAPSHOT`, `ACTIVITY_*`.
- It is transport-agnostic (SSE, WebSocket, webhook).

**Take:** the event taxonomy for our wire protocol, snapshot + delta state, and streaming tool-call args as deltas.
**Leave:** nothing structural; we simply implement our own.

## MCP Apps (SEP-1865, stable 2026-01-26)

**How it works**
- A tool's `_meta.ui.resourceUri` points to a `ui://` resource containing HTML, served as `text/html;profile=mcp-app`.
- It renders in a sandboxed iframe and talks JSON-RPC over postMessage.
- It is not streamed.

**Take:** a later export target (render our surface into a `ui://` bundle so it shows up in Claude/ChatGPT); a **sandboxed escape-hatch node** for one-off creative HTML.
**Leave:** using it as the primary path, because it can't be streamed and has no shared design system.

## Chat platforms (projection targets, not specs)

- **Slack Block Kit:** the richest of the three. In April 2026 Slack added agent-oriented blocks (card, alert, carousel, data_table, possibly chart). Modals offer real forms. Limits: about 50 blocks per message and 100 per modal.
- **Discord Components V2:** the `IS_COMPONENTS_V2` flag (`1<<15`) turns on containers, sections, text displays and media galleries, but disables `content`/`embeds`. Modals allow at most 5 text inputs. A message budget is roughly 40 components and 4,000 chars.
- **Telegram Bot API 10.x:** text, media and inline keyboards. There are no native forms; `callback_data` is at most 64 bytes, so state must live server-side. **Mini Apps** give a full web view, which is our web renderer.
- **Lesson:** design the spec around **semantics** (card, form, choice) rather than layout. Every projector needs a **capability profile** plus a **degradation ladder**, and the web renderer serves as the universal high-fidelity fallback.

Sources: [Slack: richer agent experiences with Block Kit](https://slack.dev/build-richer-agent-experiences-with-block-kit) · [Slack Block Kit limits](https://skills.sh/ccheney/robust-skills/slack-block-kit) · [Discord component reference](https://docs.discord.com/developers/components/reference.md) · [Discord.Net Components V2](https://docs.discordnet.dev/guides/components_v2/advanced.html) · [Telegram Bot API 2026 guide](https://messengerbot.app/pl/telegram-bot-api-in-2026-how-to-create-link-and-deploy-telegram-bots-step/) · [OpenClaw portable rich messages](https://docs.openclaw.ai/channels/slack/rich-messages)

## Design principles distilled for vakProjection

1. **Catalog is the single source of truth.** It generates tool schemas, prompts, validators and the renderer registry.
2. **Flat, id-addressed nodes**, root first. Shallow structures are what LLMs produce reliably.
3. **Structure and data are separate.** Nodes bind into a surface data model by JSON Pointer, so updates are cheap.
4. **Data, not code.** Behavior comes only from named client functions and declared actions.
5. **Stream everything**, by incrementally parsing tool-call args and rendering each node as soon as it is valid.
6. **Degrade per node.** A bad node becomes a placeholder and an error is reported back to the model so it can self-correct.
7. **Ride native tool calling** on every provider, using JSON Schema that is short-keyed but still readable.
8. **Interaction closes the loop.** An action becomes a tool result carrying its context and data, and the model continues.

Sources: [A2UI v0.9 spec](https://a2ui.org/specification/v0.9-a2ui/) · [A2UI repo](https://github.com/a2ui-project/a2ui) · [CopilotKit on A2UI v0.9](https://www.copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec) · [json-render](https://ai-tldr.dev/tools/json-render/) · [OpenUI Lang](https://mer.vin/2026/05/openui-lang-mit-generative-ui-that-cuts-llm-output-tokens-versus-json/) · [GenUI benchmark](https://www.openui.com/benchmarks) · [State of GenUI 2026](https://www.openui.com/blog/state-of-generative-ui-report) · [AG-UI events](https://docs.ag-ui.com/sdk/js/core/events) · [MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
