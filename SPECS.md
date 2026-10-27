# SPECS.md: vak Projection

vak gives any LLM tools to answer with rich, interactive UI (cards, tables, charts, forms, buttons) and projects that UI onto any surface: web (responsive, multi-column), Telegram, Slack, Discord, plain text. The framework is `packages/*`, with the playground (`playground/`) as its viewer; apps built on it live in their own repositories (§10). Scope and research: [SCOPE.md](SCOPE.md), [STUDY.md](STUDY.md).

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
- **Actions:** buttons and forms submit. Distinct form bindings with repeated final field names use absolute pointer keys in action data (for example `/records/0/value` and `/records/1/value`); unique names use short keys. No submitted field is discarded by name flattening. The model receives `[ui action] {action, surface, source, target, data}`, with data scoped to the form or the item.

**Tools:**
- `vak_render`: create or replace a surface.
- `vak_update`: patch nodes by id, and data via an object merge or ops.
- `vak_remove`: remove a surface, or nodes by id.

In MCP there is also `vak_wait_action`.

## 2. Catalog: the single source of truth

Tables, charts and metrics can map one record collection directly: table `rows:{records:"{/records}",fields:["label","value"]}`, chart `series:{records:"{/records}",label:"label",fields:["value"]}` (optional numeric `x` field), and stat `value:{records:"{/records}",field:"value",aggregate:"sum"}`. Aggregates are sum/mean/min/max/count. Forms edit the same data via existing pointers. Resolution projects ordinary renderer values without persisting duplicate arrays or executing expression text. Fields must exist; chart/metric numeric values must be finite. Empty numeric metrics are explicit errors. Closed caller contracts offer record mappings instead of copied collection arrays where no compatible array-shaped dataset exists. Literal independent tables remain supported without such a contract; ordinary requested table totals also work after mapping.

For closed caller data contracts, collection-valued props with binding support reference a compatible declared data path when one is available, rather than copying independent values into view props. Record-template relative fields remain supported. Open dictionaries, unions and deeper dynamic structures retain ordinary runtime reference validation. These checks establish representational consistency, not source truth; immutable source values can be declared using ordinary schema constants. JSON Schema constants/enumerations compare JSON values structurally. Optional transactional `surfaceCount` declares the count of resulting canonical surfaces (1–16); initial decoding uses it, while later patches can update fewer surfaces without resubmitting everything. Final candidate validation preserves that count. No count is inferred from prose.

Transactional callers can declare `RunOptions.dataSchema` / `HostRunOptions.dataSchema`, an object JSON Schema using the existing supported subset. It describes every complete surface data object in that run, not UI layout or task success. Replacement tool schemas carry this contract into decoding where supported; all providers undergo the same runtime checks. Complete resulting state is checked after patches too, including existing surfaces. Invalid data is rejected without coercion or canonical mutation. Local root `$defs` are scoped away from catalog definitions. Callers with heterogeneous surfaces can use a schema union within the object contract or optional typed fields; only declare constraints the caller actually knows. This option requires `surfaceSubmission`; ordinary progressive calls reject it. Skills guide composition, while this trusted contract enforces known data structure. No schema is inferred from user prose or model facts.

Media results use `media {kind: image|audio|video, src, title?, description?, transcript?, alt?}`. The web target supplies local playback controls for audio/video, the voice agenda identifies their activation keys, and text/channel targets lower the content to descriptions and a public link where available. `mediaResolver` is an optional web-element callback for app-owned authenticated resources; credentials never belong in `src`. Playback is not a submitted agent action. Trusted apps can call `host.project` to publish on the canonical session after execution is idle; normal ownership and persistence apply.

`packages/core/src/basic-catalog.ts` defines 26 components with JSON Schema props and vak extensions (timeline, steps, code, map and gallery are extended tier, lowered to basic components for targets that don't draw them: `core/lower.ts`):
- `aliases`, `enumAliases`, `default`, `format: "markdown"`, `pattern`
- `literal` on a prop preserves embedded source braces through normalization, lint and resolution; a whole-value binding still loads source from data (used by `code.code`)
- `namesComponent` on a prop: a value outside its enum that names another component retypes the node (input `kind: "date"` → `date`)
- component-level `retype` rules use schema predicates to select a validated semantic variant (state-bearing timeline items become steps, including after data bindings resolve)
- component-level `normalize`, `defaults`, `finalize` (e.g. the chart's `normalize` reads bare number lists as a series and drops a series with no numbers beside real ones)
- `role` (`form`/`action`) and `tier` (`core`/`extended`)
- worked `examples`, which must render with zero diagnostics

**Local interactions** (`core/interact.ts`) are a projector's own, with no model turn: tables sort (by value: "$1,299", "12%", "1.2k", dates), filter and page; lists and card grids filter. Defaults come from size (sort from 2 rows, filter from 8, page over 25); `sortable`, `searchable`, `pageSize` only override. `totals: true` makes the catalog's `finalize` append a computed totals row (replacing one the model wrote; never summing percentages or the first column), so every projector shows the same numbers.

`toWireSchema` strips the extensions before schemas go to providers. Targets narrow the catalog with a `CapabilityProfile`: native, degraded or none per component.

## 3. Engine pipeline

1. **Lenient streaming JSON parser** (`partial-json.ts`).
   - In finalized input, a missing closing key quote before a complete primitive is recovered by token boundaries and standard JSON primitive validation. Proper quoted keys win; unfinished/ambiguous values are not inferred. Schema and application checks remain responsible for validity and factual assertions.
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
   - A keyless object group inside an object after an object-valued member, followed by the containing object's own closer, supplies disjoint members of that object. Colliding keys or a missing extra closer retain the omitted-closer sibling reading; anonymous valid nodes remain independent.
2. **Call recovery** (`SurfaceStore.apply`):
   - Members written inside the nodes string after the list (`"[...], \"data\": {...}"`) belong to the call.
   - An unknown argument holding node-shaped objects (`"chart": "{...}, {...}]"`), or a second node-list key (`"children": [...]` after `"nodes"`), joins the nodes list; an unknown argument's name types a node that has none.
3. **Normalizer** (`normalize.ts`).
   - Type resolution: name → alias → schema-scored inference. A `namesComponent` prop whose value names another component (by name or alias, with its presets) makes the node that component when the result validates; the prop is dropped.
   - Node keys: `prop`, `properties`, `attributes`, `attrs` mean `props`. `null` props are omitted. A typeless `{"data": {...}}` in a nodes list is surface data, and so is an id-less, typeless object whose keys describe no component (a form's starting values written as a child). A leaf component whose only child is a bare `{props}` object owns those props. Child records can fill a single matching required record-array prop when every record validates; explicit props and nested subtrees are retained.
   - A stringified explicit list-wrapped absolute binding (`"[{/path}]"`) is unwrapped before JSON coercion only where the prop schema declares array and binding alternatives. Literal source and explicit row-cell arrays remain unchanged; missing or incompatible targets are errors.
   - Prop preparation: quoted pointers such as `{"/data/rows}"` → `{/data/rows}` (literal source excluded), `{{path}}` → `{path}`, presets, bare pointers (`"/items"`) where a string isn't valid, at any depth, become `{/items}`, coercion, defaults, HTML → markdown, double-escaped `\n` repair.
   - Coercion reads a JSON-encoded sequence `{...},{...}` as a record array when every item validates, preserving every record; ambiguous strings retain the existing reading.
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
- **Tool dispatch:** `AgentTool.execute` returns text or `{text,isError}`; wrappers preserve explicit failure status. Supported argument schemas and object shape are validated before approval/execution. Incomplete native generations and duplicate/reserved tool names dispatch no external operations. HTTP Retry-After consumes finite transport retries; logical model-request counts remain distinct from wire attempts.
- **Run completion:** `runAgent` and public `host.run` default to ending on a clean projection. Opt-in `completion: "response"` uses tool generation and lets publication be progress; the same run continues until a response without tool calls, a step bound, error or cancellation. Direct constrained-only generation cannot express that workflow and rejects the combination. Completion of a run does not certify an application outcome.
- **`runAgent` generation modes:**
  - `tools`: the projection tools.
  - `constrained`: grammar-decoded `{reply, render}`.

  A clean projection ends the turn. Compact prompts include nested field schemas and enums. Explicitly requested catalog components have their exact props contract repeated after the examples, using only types available to the model; source, captions, units and ordering must be preserved.
- **Rejected tool syntax:** providers may throw `ToolGenerationError` when generated tool syntax is rejected before any usable output. Tool runs can correct it within their existing step budget only before any text/tool call was streamed, with a fresh provider invocation so caller admission/accounting applies again. Ollama classifies only its HTTP 500 generated-tool XML syntax rejection. No automatic replay of prior operations or retry of unrelated errors; failed-generation token usage remains unknown without provider measurements.
- **Trusted completion prose:** the optional `CompletionCheck` returns an issue array or `{issues, response?}`. If checks pass, `response` replaces emitted final text without another generation; original provider prose remains in private conversation/transcript records. Any issues or invalid decision withhold final text. An acknowledgement does not verify semantics, accept a task or authorize tools.
- **Correction data:** completion failures include a bounded ID/root-type inventory and recommend patches against existing IDs. Prompts initialize supplied control values at exact bind paths, preserve numeric units and requested labels, and distinguish independent output calls from whole-surface replacements. `vak_render` still replaces all nodes/data, while `vak_update` preserves omitted data; explicit empty lists are never silently undone.
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
| Markdown | `@vak/core` | `projectMarkdown`: GitHub-flavoured; pipe tables, alerts as `> [!NOTE]`; labels escaped |
| Terminal | `@vak/core` | `projectAnsi`: colour, boxes, width-fitted tables; every escape sequence from model text stripped |
| Email | `@vak/email` | `projectEmail` → `{subject, html, text}`: one 600 px table column, inline styles; controls become one "Open to respond" link |
| Answers (voice and any conversational target) | `@vak/core` | `agenda`, `resolveAnswer`, `fillAnswer`, `actOn`: what a surface waits for, answered in words, submitted as the same `VpsAction` a click sends |

Shared chat logic lives in `core/chat.ts`: form fields, reading typed answers, tables and charts as text. Every projector keeps within its platform limits and cuts with a note rather than send something the platform rejects. Model text is always escaped; only `https`/`mailto` links survive.

**Answers (`core/answer.ts`).** A conversational target (voice first) works on meaning, not widgets. `agenda(store, surface)` lists what a surface is waiting for: *decisions* (sibling buttons, a node's declared `choices`, per-item template buttons), each option with its control and the values that tell options apart; and *forms* (a form, or an action whose nearest container holds bound inputs), with `formFields`. Apps add *approvals* in the same shape; the framework never decides one. `resolveAnswer(item, text)` is deterministic: yes/no/cancel/repeat/back words, option names, ordinals, comparisons against declared values ("the cheapest", "the earliest", "the best"), and field values said aloud (number words, relative dates, spoken email). An approval that changes something needs its operation word ("allow the write"); mixed or unclear answers resolve to `unknown`, never to consent. `answerSchema(item)` is the only shape a model may return for an unresolved non-approval answer, and `readModelAnswer` runs it through the same field reading and checks. `fillAnswer` writes values with `setValue`, so every target shows them; `actOn` calls `store.submit`, so a spoken answer and a click produce identical actions. `question` and `readBack` give the spoken text.

## 6. Telegram bot

- Per-chat store and conversation, saved in `.vak/telegram/<chat>.state.json` after every update. Unfinished updates replay on restart.
- Button taps are answered immediately, with a "still working" note while a reply runs.
- Answered choice buttons are replaced by the answer. A removed surface keeps its message, without buttons. A deleted message is re-sent.
- Fallback chain: rich → rich without media → text with an inline keyboard.
- The model sees the last 6 turns (`history` option). `/start` clears the chat's conversation, surfaces and buttons; old buttons answer "That button has expired."
- Text the model writes after the engine reports an error is addressed to the engine and is not sent to the user.

## 7. MCP server

**Server.** `@vak/mcp`: stdio, no SDK, dual protocol era (2026-07-28 `server/discover` and legacy `initialize`). Tools are backed by the playground viewer (`/api/project`, `/api/actions`), or any app server exposing the same routes (`VAK_URL`). Registered for Claude Code in `.mcp.json`. Teaches inline children by default, like the playground and Telegram; `VAK_AUTHORING=flat` (or the `authoring` option) switches the prompt and tool schema to flat. The engine reads both styles either way.

**Client** (`@vak/mcp/client`): the agent loop's way to real data. Stdio (newline-delimited JSON-RPC) and Streamable HTTP (JSON or SSE replies, `Mcp-Session-Id` kept). Security is part of the contract:
- a child process gets PATH, a private HOME/TMPDIR/cwd and only the variables it declares, never the host's keys (`minimalEnv`)
- every tool has a policy, `allow` / `ask` / `off`, defaulting from its own annotations: read-only local tools allow; destructive, unknown or open-world (internet) tools ask; `off` tools are never offered to the model
- `ask` calls go through an approval hook (the host sends an `approval` event and waits for `POST /api/approvals/<id>`: allow, allow for this chat, deny; five minutes or a stopped turn mean deny)
- cancellation, timeout and close abort pending HTTP requests; JSON/SSE bodies and stdio frames are capped at 8 MiB before parsing
- results are capped at 12k characters and wrapped as `<tool_output>`, labelled as data not instructions
Built-in tools with the same shape: `webFetchServer` (https only, public addresses only, every redirect re-checked, 2 MB, text extracted) and `timeServer`.

**Integrations** (`Integrations` in `@vak/mcp/client`): installing, configuring and running the servers an app offers, so every app gets the same safety rules. The app passes its catalog (`CatalogEntry[]`: builtin, pinned npm, remote https, or local command), a `SecretStore` and the host's approval hook; the framework does the rest:
- npm servers install at an exact version (`pinnedInstallArgs` refuses ranges and tags) with `--ignore-scripts` and `--before=<today − PINNED_MIN_AGE_DAYS (14)>`, into `<dataDir>/integrations/<id>/pkg`
- each server runs with `<dataDir>/integrations/<id>/home` as its HOME and only its declared secrets (env or header)
- folder settings go through `checkFolders` (absolute, existing, never a system root or the home folder)
- per-tool policies persist in `<dataDir>/integrations.json`; "allow for this chat" lasts for that session; servers the user adds are `custom` (unverified, https or loopback only for remote); calls go to `<dataDir>/logs/tools.jsonl`
- changing configuration, policies, activation, installation or discovered metadata invalidates captured handles and session grants; authorization/cancellation are rechecked after approval before dispatch
- `view()` gives a settings screen everything it shows (status, missing setup, tools with policies, recent calls); `toolsFor(session)` gives a turn its tools

## 8. Host (`@vak/host`)

The HTTP + SSE API that runs the agent loop for a UI, on Node built-ins only, so any app can mount it (`createHost(options).handle(req, res)` returns false for paths that are not its own).
- Routes: providers, models, profile, chat (SSE), calibrate (SSE), project / actions / events (outside agents), sessions (list, view, rename, delete), approvals, reset.
- Options: `providers` (a function, re-read per request so key changes apply live), `profiles`, `instructions`, `transcripts` dir, `sessionsDir` (conversations saved as JSON and reloaded after a restart; session ids map to collision-free file names, and a tool's result is saved as a placeholder with its call id, never its output), `token` (bearer required on every route), `origins` (CORS allowlist), `hosts` (Host names accepted), `routes` (app routes after auth), `tools` (per-turn tools from the app: integrations; a turn with tools always uses tool calling).
- **Admission**, for every caller: the Host header must name loopback (or `hosts`), against DNS rebinding; a browser Origin must be the server itself or listed; POST/PUT bodies must be JSON, which forces a preflight unlisted origins fail. Without these, any web page could POST a text/plain body to a loopback port and spend the user's keys.
- A saved session holds the messages, the final surfaces and a **timeline** (user text, actions, replies with their surface ids, engine notes, status) so a UI redraws a reopened chat as it was shown. The list comes from an index read once and kept current; at most 24 sessions stay in memory (idle ones reload from disk).

## 9. Providers registry

`providersFromEnv` builds Ollama, Anthropic, OpenAI (Responses), Gemini, a generic OpenAI-compatible entry, and every lab in `COMPATIBLE_PRESETS`: Mistral, xAI, DeepSeek, Groq, Cerebras, OpenRouter, Together, Fireworks, Moonshot, Qwen (DashScope), LM Studio. A preset declares its base URL, key variable, a default model only where the lab has a stable alias, and the server's differences (`maxTokensParam`, `streamUsage`); `/models` is read as `{data}` or a bare list. `PROVIDER_SETTINGS` lists every variable the registry reads, with the provider it belongs to, so settings screens are generated, not hand-kept.

## 10. Apps built on the framework

Apps live in their own repositories and consume the framework one way: they import `@vak/*`, and nothing in this repository imports, builds or tests them.

- **[Vakyartha](https://github.com/nranjan2code/vakyartha)**, the desktop app (Tauri 2 shell, Vite UI, the engine as a Node sidecar on `@vak/host`), split out of this repository on 2026-10-25 with its history. It pins Projection as a git submodule (`framework/`) and links `framework/packages/*` as npm workspaces. App-only features (FinOps, Canvas and Artifacts, integrations marketplace, channels) are specified in its own SPECS.md.
- **What belongs where:** a mechanism or safety default that every app needs is the framework's; a policy or product choice (which servers to offer, UX, pricing, identity, where keys are stored) is the app's. Two tests: would a second app have to copy this code? Does the framework's SECURITY.md promise it? If either is yes, it belongs here. Example: `Integrations` (how servers are installed and run) is the framework's; Vakyartha's catalog (which servers, versions and descriptions) is the app's.
- **What an app may rely on:** each package's `exports` (`@vak/core`, `@vak/web`, `@vak/host`, `@vak/providers`, `@vak/mcp/client`, `@vak/telegram`, …). A change that breaks one is called out in CHANGELOG.md so the app can move its pin deliberately.
- **The playground** (`playground/`) is the framework's own viewer, not an app: `@vak/host` plus one page of `<vak-surface>` on loopback :5177. `@vak/mcp` and `bench report` project into it (`/api/project`, `/api/actions`, `/api/events`); `?session=` and `?model=` pick the session and model.

## 11. Kit and packaging

- `@vak/kit`: `createVak({ model: "provider:model" })` → `ask(message)`, `act(action)`, `render("text" | "markdown" | "terminal")`, `email()`; tools pass through; history defaults to 10 turns.
- `node scripts/build-packages.ts` builds every package into `packages/*/dist` (JS, `.d.ts` with `.js` specifiers, a package.json with sibling `@vak/*` dependencies found from imports, `engines` for Node-only packages). The repo keeps running the TypeScript sources. Nothing is published by the script.
- `examples/`: terminal chat, email digest, the smallest web page.

## 12. Speed

- Anthropic: cache breakpoints on the system prompt, the tool list and the newest message. OpenAI: a stable `prompt_cache_key` per prompt and tools. Ollama: `keep_alive: 30m`.
- Measured on the 4B (`scripts/profile-turn.ts`): ~3k tokens in, ~1.3k out, ~25 tok/s overall; Ollama returns a tool call whole at the end, so the UI shows elapsed time while it writes. Output length is the lever left.

## 13. Benchmark

- `@vak/bench`: 36 single- and multi-turn scenarios, a rubric DSL, a simulated user, Wilson intervals.
- Baselines and cassettes live in `packages/bench/data/`.
- The replay gate (part of `npm test`) re-scores recorded outputs through the current engine and fails on any drop.
- Current version: `BENCH_VERSION = 3` (six additive scenarios: timeline, steps, code, map, gallery and table totals). Property checks inspect resolved payloads, alongside the text the user sees; totals arithmetic, currency retention and percentage exclusion are separate checks.
- The component slice uses `tools/extended/examples/inline` to expose all five new components to the 4B model. Latest reliability baseline: `components-contract` (11/12 live runs fully passing, 94% mean check score; all 12 replay fully after fixing the final quoted-pointer failure). The initial `components-v3` baseline and all intermediate recordings are retained. The replay gate still protects the unchanged v2 scenarios; v2 live baselines remain historical and need re-recording before a v3 live comparison.


Trusted apps may supply `validateEdits` to in-process host/agent execution: after a surface-edit batch, canonical snapshots are checked and bounded issues are sent before the next generation, alongside component diagnostics. This avoids correcting a local component in a way that contradicts the caller's output contract. The callback returns only issues; it grants no external permission or acceptance. `validateCompletion` remains the final completion gate. No extra provider request or separate execution loop is introduced.

Trusted `HostRunOptions.surfaceSubmission` / `RunOptions.surfaceSubmission` offers one transactional `vak_submit` instead of separately mutating surface tools. Its `surfaces` entries are `replace` (inline `root` and complete `data`), `patch` (canonical node IDs and existing merge/JSON Patch data), or `remove` (surface or listed node IDs). Unmentioned surfaces remain. New surface IDs are omitted in the model-facing creation schema and generated deterministically; existing IDs select replacement/patch/removal. Complete replacement data and required component props are mandatory in the request schema. Descendant IDs may be omitted on initial construction; generated `__vak_` identities are positional, while explicit IDs preserve identity across reordering. Collection templates are inline node objects and normalize into the same canonical graph.

A submission is strict JSON, at most 512,000 characters, 16 distinct target surfaces, 1,024 replacement nodes / 32 tree levels and 1,024 nodes per patch. The submission schema uses one local $defs/$ref node definition for roots and descendants, avoiding a duplicated catalog. A supplied root ID must be root; runtime admission enforces it. Schema-capable providers decode the actual offered tool contract through responseSchema; other providers use native calls followed by the same recursive validation. Request schemas restrict patch/remove targets to canonical IDs. Runtime compilation still enforces total node/depth/byte bounds. Grammar controls structure, not source truth or authorization. The private candidate uses the current canonical snapshots, structural checks and optional caller completion check. Snapshot identity is checked from request construction through asynchronous validation to synchronous commit. Rejected or stale candidates never change canonical state/events. A mixed submission/external-tool batch, missing terminal event or unsuccessful provider stop executes no operation. Accepted changes all commit before surface events and end the run with the checked acknowledgement. Plain prose cannot bypass submission. Identical rejected candidates remain bounded by the unchanged-repair stop and normal budgets. Ordinary progressive rendering, external effects/approvals and UI actions retain their owners; no second persistent surface store exists.


### Source inputs and skill-led authoring

Source access and provenance remain the caller's responsibility. Selected snapshots or governed tool results enter the ordinary agent context as untrusted data. Skills guide interpretation, calculations and view selection; all authored results use the same transactional graph/data API and shared record mappings. The framework no longer exposes source-specific derive/prepare/workspace compilation or automatically creates report/form layouts. Mapping aggregates are deterministic; arbitrary per-record calculations require an offered computation tool or model-authored results followed by independent checking. Neither a skill nor a schema verifies source truth. Source calculations and continuations remain outcome gates, without carrying forward an earlier deleted implementation's success.

### Prompt and execution contracts

Transactional prompting is assembled once by the provider agent. Ordinary progressive prompting uses the catalog helper; a turn receives only its active protocol. Host/agent runtime no longer exposes a compact/strict schema selector. Component tool descriptors are typed; shared record data remains dynamic JSON unless a trusted caller supplies an optional dataSchema. This does not claim native tool schemas enforce decoding on providers that do not support it. Catalog normalization handles supported representation conversions at ingestion; declared source/caller data is not coerced to make an outcome pass.

Trusted local context loaders may declare AgentTool.kind=context. They use the existing dispatcher and answer-step budget, remain loadable with zero external rounds and have no external-operation allowance. The trusted application must not mark an external tool as context. All other tools remain externally budgeted by default; model text cannot set this metadata. Related views may share a surface, while explicitly independent outputs remain separate.
