# SPECS.md: vak Projection

vak gives any LLM tools to answer with rich, interactive UI (cards, tables, charts, forms, buttons) and projects that UI onto any surface: web (responsive, multi-column), Telegram, Slack, Discord, plain text. Scope and research: [SCOPE.md](SCOPE.md), [STUDY.md](STUDY.md).

## 1. Vak Projection Spec (VPS)

A **surface** is one interface: `{ surface, title?, nodes, data? }`.

- **Nodes:** `{ id, type, props?, children? }`, root first (`id: "root"`).
  - `children` is a list of child ids or inline child nodes (inline is the default authoring, see §4).
  - It can also be a list template, `{ "each": "/path", "template": "<node id>" }`, which repeats the template node once per item.
- **Data:** a separate JSON model. Props bind with JSON Pointer placeholders:
  - `"{/path}"`: absolute.
  - `"{name}"`: relative to the current list item, or to the surface's own top-level `name` outside a list.
  - `"{.}"`: a plain-value item itself.
  - `\{`: escapes a brace.
  - A string that is exactly one placeholder yields the raw value; otherwise values are stringified, and lists of plain values read "a, b".
- **Inputs:** `bind` a pointer; named checks (`"required"`, `"email"`, `"minLength:3"`); `visibleIf`.
- **Actions:** buttons and forms submit. The model receives `[ui action] {action, surface, source, target, data}`, with data scoped to the form or the item.

**Tools:**
- `vak_render`: create or replace a surface.
- `vak_update`: patch nodes by id, and data via an object merge or ops.
- `vak_remove`: remove a surface, or nodes by id.

In MCP there is also `vak_wait_action`.

## 2. Catalog: the single source of truth

`packages/core/src/basic-catalog.ts` defines 21 components with JSON Schema props and vak extensions:
- `aliases`, `enumAliases`, `default`, `format: "markdown"`, `pattern`
- `namesComponent` on a prop: a value outside its enum that names another component retypes the node (input `kind: "date"` → `date`)
- component-level `normalize`, `defaults`, `finalize` (e.g. the chart's `normalize` reads bare number lists as a series and drops a series with no numbers beside real ones)
- `role` (`form`/`action`) and `tier` (`core`/`extended`)
- worked `examples`, which must render with zero diagnostics

`toWireSchema` strips the extensions before schemas go to providers. Targets narrow the catalog with a `CapabilityProfile`: native, degraded or none per component.

## 3. Engine pipeline

1. **Lenient streaming JSON parser** (`partial-json.ts`).
   - Handles prefixes, comments, single quotes (and a key opened with one quote and closed with the other), unquoted keys and Python literals.
   - Missing quotes: a word missing its opening quote (`"type":select"`), prose missing it (`"content": **Bold** ...",` runs to the first quote a delimiter follows), key and value in one string (`"type:section"`, `"type:=","select"`, and `"type: stat"` right after a single-token value such as an id), and a colon inside the key's quotes (`"id: "x"`).
   - A `key:` inside an array, quoted or not, ends the array.
   - An object holding only one quoted pointer (`{"/data/values"}`) is that binding.
   - Mismatched closers are read as a typo, an omitted closer or a stray extra, whichever the following closers fit. When no closers follow it directly, the reading under which the rest of the text's closers line up best wins.
   - Values after a closed top-level list (`[a], b` or `[a]}, b`) continue it.
   - A keyless value, or a value after a stray colon, continues the previous member.
   - JSON written inside a string without escaping is read as a structure.
   - A `{` where an object key belongs, inside an array, ends the object: its `}` was omitted and the array's next element begins.
   - A key repeated in one object whose values are both lists of objects (`"children"` twice) concatenates; other repeats are last-wins.
   - A closed string that escapes its own quotes stays a string (the embedded-JSON reading is for unescaped JSON).
2. **Call recovery** (`SurfaceStore.apply`):
   - Members written inside the nodes string after the list (`"[...], \"data\": {...}"`) belong to the call.
   - An unknown argument holding node-shaped objects (`"chart": "{...}, {...}]"`), or a second node-list key (`"children": [...]` after `"nodes"`), joins the nodes list; an unknown argument's name types a node that has none.
3. **Normalizer** (`normalize.ts`).
   - Type resolution: name → alias → schema-scored inference. A `namesComponent` prop whose value names another component (by name or alias, with its presets) makes the node that component when the result validates; the prop is dropped.
   - Node keys: `prop`, `properties`, `attributes`, `attrs` mean `props`. `null` props are omitted. A typeless `{"data": {...}}` in a nodes list is surface data, and so is an id-less, typeless object whose keys describe no component (a form's starting values written as a child). A leaf component whose only child is a bare `{props}` object owns those props.
   - Prop preparation: `{{path}}` → `{path}`, presets, bare pointers (`"/items"`) where a string isn't valid, at any depth, become `{/items}`, coercion, defaults, HTML → markdown, double-escaped `\n` repair.
   - An inline node reusing an id already written in the same call gets its own id (`actions_2`) instead of replacing the first.
   - Structure repair:
     - prose children become text
     - a missing root is synthesized; orphans are attached to it
     - a list template listed as a plain child is removed
     - a node with two parents keeps the first
     - an object of node settings only (`{"priority": "secondary"}`) in a children list applies to the node before it
     - layout containers below the root with no children and no text of their own are removed (warning)
4. **Update semantics:** nodes a patch cuts out of the tree are removed, and the model gets a warning naming them.
5. **Lint** (diagnostics go back to the model as the tool result). Errors are:
   - invalid props
   - missing children
   - inputs nothing submits
   - an empty surface: nothing reachable but layout containers with no text of their own
   - placeholders that can never fill
   - an input bound under data that can't hold it (`/todos/new` while `/todos` is a list)
6. **Resolve** → `ResolvedSurface` (bindings, templates, visibility).
   - A list path inside an item falls back to the item's own field.
   - A pointer that finds nothing is retried with dots as separators (`/data.visitors`) and without a leading `/data` step.
   - A whole-string bare pointer that names existing data is that data (a stat's `"/visitors"`).
   - A currency sign before a placeholder whose value starts with it is not repeated.
   - Before lint, a top-level `{name}` with no surface data of that name, where exactly one input's bind path ends in `/name`, binds to that input's value.

## 4. Providers, agent loop, policy

- **Adapters over `fetch`:** Anthropic, OpenAI (Responses API and Chat Completions), Gemini, Ollama. Each implements `describeModel()`.
- **`runAgent` generation modes:**
  - `tools`: the projection tools.
  - `constrained`: grammar-decoded `{reply, render}`.

  A clean projection ends the turn.
- **History window** (`history: N`): the model sees the last N turns (a turn starts at a typed message or a `[ui action]`, so a tool call never loses its result). The window's first message carries a note with each surface still shown: id, title, text view and data. The full history stays saved. Default: everything (bench and replay gate unchanged).
- **Plan** (`policy.ts`) is `{ generation, tier, examples, authoring, maxSteps }`, each choice with a reason.
  - Declared facts set the default; for tool calling that's `authoring: "inline"`.
  - Calibration (`.vak/models.json`) replaces it only when clearly better: its 95% Wilson interval sits above the declared configuration's.
- **Authoring:**
  - `inline`: children are written inside their parent. It's the default after the A/B test (+14 points mean check score, paired 95% CI [+3, +26]).
  - `flat`: children are referenced by id.

## 5. Projectors

| Target | Package | Shape |
|---|---|---|
| Web | `@vak/web` | `<vak-surface>` Web Component, container queries, keyed reconciliation, SVG charts |
| Telegram | `@vak/telegram` | Bot API rich message (HTML); forms as one question per message; edits in place; verified media |
| Slack | `@vak/slack` | Block Kit message; forms as modals with native inputs; per-field errors |
| Discord | `@vak/discord` | Components V2 message; tables as monospace; forms as paged modals (≤5 fields) |
| Text | `@vak/core` | `projectText` (logs, tests, fallback) |

Shared chat logic lives in `core/chat.ts`: form fields, reading typed answers, tables and charts as text. Every projector keeps within its platform limits and cuts with a note rather than send something the platform rejects. Model text is always escaped; only `https`/`mailto` links survive.

## 6. Telegram bot

- Per-chat store and conversation, saved in `.vak/telegram/<chat>.state.json` after every update. Unfinished updates replay on restart.
- Button taps are answered immediately, with a "still working" note while a reply runs.
- Answered choice buttons are replaced by the answer. A removed surface keeps its message, without buttons. A deleted message is re-sent.
- Fallback chain: rich → rich without media → text with an inline keyboard.
- The model sees the last 6 turns (`history` option). `/start` clears the chat's conversation, surfaces and buttons; old buttons answer "That button has expired."
- Text the model writes after the engine reports an error is addressed to the engine and is not sent to the user.

## 7. MCP server

`@vak/mcp`: stdio, no SDK, dual protocol era (2026-07-28 `server/discover` and legacy `initialize`). Tools are backed by the playground viewer (`/api/project`, `/api/actions`). Registered for Claude Code in `.mcp.json`. Teaches inline children by default, like the playground and Telegram; `VAK_AUTHORING=flat` (or the `authoring` option) switches the prompt and tool schema to flat. The engine reads both styles either way.

## 8. Benchmark

- `@vak/bench`: 30 single- and multi-turn scenarios, a rubric DSL, a simulated user, Wilson intervals.
- Baselines and cassettes live in `packages/bench/data/`.
- The replay gate (part of `npm test`) re-scores recorded outputs through the current engine and fails on any drop.
- Current version: `BENCH_VERSION = 2`.
