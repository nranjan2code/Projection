# Changelog

What changed, newest first. Nothing is released yet: every package is `0.1.0` and unpublished. Apps pin this repository by commit or tag; a change that breaks a package export is marked **Breaking** (see [RELEASING.md](RELEASING.md)). Details of each step are in [HANDOVER.md](HANDOVER.md); the architecture is in [SPECS.md](SPECS.md).


## 2026-10-26: graph component

- New extended-tier `graph` component: nodes `[{id, label, group, note}]` and edges `[{from, to, label}]`, for knowledge graphs, org charts, dependencies and flows. It accepts the memory server's own shape (`entities`/`relations`, `entityType`, `relationType`, `observations`), edges written as text (`"A -> B: label"`), and edge ends named by id or label; an end naming no node becomes one. A lone node is valid.
- `@vak/web` draws it as dependency-free SVG with a full interactive view: drag to pan, pinch (touch, trackpad, WebKit gesture events) or Ctrl/⌘-scroll to zoom, zoom and fit buttons, keyboard control, draggable nodes, selection that shows a node's note and dims what it does not touch, and search from 12 nodes. Directed acyclic graphs are layered and turn top-down or left-to-right to fit the frame; other graphs get a deterministic force layout. New export `renderGraph`/`normalizeGraph`.
- Chat, email, markdown, ANSI and text targets get a graph lowered to one line per connection plus its unconnected nodes.
- "graph" is no longer a `chart` alias; a `graph` node with `series` is still retyped to a chart, so recorded output is unchanged.
- Engine: a value already valid for an `anyOf` branch now has that branch's declared aliases renamed, as plain object schemas always did. Replay gate unchanged.


## 2026-10-25: in-process host execution

- Additive `VakHost.run` and `view` APIs use the canonical sessions, validation, surfaces and persistence without an HTTP request. Applications may supply bounded execution controls and observe events; active viewers receive progress through the existing event stream.
- Optional `allowSessionMutation` lets applications reserve sessions from HTTP writes between runs while keeping trusted in-process access. HTTP chat behavior is otherwise unchanged. An independently executing session rejects competing chat, projection, deletion and reset requests; cancellation belongs to the trusted caller's signal. Views are detached copies. Session save failures propagate to in-process callers.
- Add `VakHost.remove()` for trusted idle-session deletion. Session deletion now removes its raw transcript too and refuses running sessions until stopped, preventing a late save from recreating deleted content.
- Add `VakSurfaceElement.releaseAction()` so action owners can release a submitted control after rejection, cancellation or queuing without fabricating a surface update.
- Empty event streams flush headers promptly. Tests cover viewer disconnection, mutation takeover, canonical multi-surface views, invalid actions, pre-cancellation and failure cleanup. No runtime dependencies added.


## 2026-10-26: a retry no longer copies the nodes it patches

From a local 4B run ("compare three hotels in Kyoto … let me book one"): the retry was a `vak_update` that patched three buttons at the top level, then re-sent the tree with the same buttons inside their cards. The repeated-id rule (a node written inside a parent whose id was already used in the call is a second node, from a 5-tab plan where every tab's button was called "actions") renamed them `action1_2`…; the patched originals were left in no parent, re-attached to the root, and every Book button showed twice.

- **Repeated ids:** a node is renamed only when its id was already written inside a parent in the same call. A top-level node then written inside a parent is that node being placed.

## 2026-10-26: bound props are checked once filled

From a local 4B run ("show my running stats … with a chart of daily distance"): the chart's series were bound to records `[{day, km}]` and drew seven empty series; the call passed as clean. The cause was general: lint skips the schema check for a binding (its value is unknown at write time), and nothing checked it after the data filled it in, for any component.

- **Resolved props are validated** (`lintResolved`): each bound value is checked against the component's schema once resolved, the first failing instance of a template reported once. The message says what the data held ("a list of 7 records with day, km") and, when the prop has a description, what it takes. A binding with no value at all stays `lintUnbound`'s report.
- **Chart `finalize`:** a record of numbers (`{"Rent": 750, ...}`) is one series labelled by its keys; series bound to records plot each field that is numeric in every row that has it, named after the field; a text field labels the points when the chart has none. A row without the field is a gap, which the check above reports.
- **`validate` with `anyOf`:** the branch the value matched furthest (its first error deepest) is reported, fewest errors breaking ties. By count alone, series with gaps were reported as "series/0 expected number".

## 2026-10-26: absolute bindings are checked

From a local 4B run ("make a monthly budget tracker … and a chart"): the chart's series were bound to `{/budget.income.values.0}`, a path the data never had. The chart drew empty, and the call passed as clean, because only relative `{name}` bindings were checked.

- **`{/path}` with no data is an error** (`lintUnbound`), naming the paths the data does have. Read the way interpolation reads it (dots, the extra first step below). Not reported: a path an input binds or fills (`bind` on any node, its parents and children), a `visibleIf`, and nodes inside a list template.
- **An extra first step the data lacks is dropped:** `{/stats/daily-activity}` with data `{daily-activity}` binds, as `{/data/…}` already did (bench running-week: an empty chart and list). Only when the data has nothing at that first step.
- **Replay gate:** restaurants#0 0.33 → 0.67; sales-q3#0 1.00 → 0.75, accepted: its table bound `{/data/products}`, which was never sent, and showed only its header. Three bench-output tests that asserted "no errors" on such tables now expect the error.

## 2026-10-26: Kyoto hotels, second round

From the installed Vakyartha 0.1.0 on the 4B model ("compare three hotels in Kyoto … let me book one"): the first render showed "unknown component "data"" and an empty grid; the retry showed two hotels with garbage fields, a third card made from the Book button, and every card full of cycle boxes, all reported as "rendered" with warnings only.

- **`type: "data"` nodes:** `{"id":"hotels","type":"data","value":[...]}` is the surface data at `/hotels` (without an id, an object value merges at the top), not an unknown component.
- **Parser:** a number with a closing quote and no opening one (`"rating":4.3",`) drops the stray quote, as a bare word already did. Before, the quote opened a string and every later member was read one token off.
- **Self-repeating templates:** a template whose children are `{each, template: <itself>}` (the list spec copied into the item layout) has those children removed, with a warning; it rendered as a cycle.

## 2026-10-26: integrations move into the framework

- **`Integrations` in `@vak/mcp/client`:** installing, configuring and running the MCP servers an app offers, moved from Vakyartha's sidecar so every app gets the same safety rules. The app passes its catalog, a `SecretStore` and the host's approval hook. Same on-disk layout as before (`integrations.json`, `integrations/<id>/`, `logs/tools.jsonl`), so existing installs keep working.
- **Enforced, not only documented:** `pinnedInstallArgs` refuses version ranges and tags; installs use `--ignore-scripts` and `--before=<today − 14 days>` (`PINNED_MIN_AGE_DAYS`). `checkFolders` also refuses `/home`. A script path for npm may end in `.js`, `.mjs` or `.cjs`.
- New exports: `Integrations`, `IntegrationsOptions`, `IntegrationView`, `CatalogEntry`, `ConfigField`, `Trust`, `SecretStore`, `pinnedInstallArgs`, `checkFolders`, `PINNED_MIN_AGE_DAYS`. Six tests (`packages/mcp/test/integrations.test.ts`) with a fake npm, no network.
- **Framework or app:** the rule is written down in AGENTS.md and SPECS §10.
## 2026-10-25, late night: shown surfaces only get better

From a Vakyartha run on the 4B model ("compare three hotels in Kyoto"): four renders, each retry lost more, and the last, near-empty one replaced the rest, leaving placeholders that never resolved.

- **The user's view only moves forward:** `SurfacePublisher` (`@vak/core`), used by `runAgent`. A finished call is shown only if it `improves` on what is shown: a clean version always does, a broken one never replaces a clean one, and replaces a broken one only with at least as much content. A rewrite of a shown surface no longer streams over it. Whatever ends the run (done, step limit, error, abort) puts held surfaces back, so the store, saved sessions and every client agree. The model is told when its version was held.
- **No endless placeholders:** a child the model names but never sends shows as `$pending` only while its render streams (`SurfaceState.partial`, `SurfaceSnapshot.partial`); afterwards it is left out. Lint still reports it to the model. Projectors that drew `$pending` for a finished surface no longer receive one.
- **Missing list templates:** children `{each, template}` naming a template that was never sent shows each item from its data with the catalog's new `itemTemplate` (basic catalog: a card of the item's fields), as a warning instead of an error. A template can also be written in place: `{each, template: {type, ...}}`.
- **Parser:** strings running up to a `]` the object never opened (`"features":"a","b","c"],`) are a list whose `[` was left out, not made-up keys.
- `SurfaceStore.assess(id)`: errors left and content shown.

## 2026-10-25, night: the app moves out

- **Split:** the desktop app and its browser entry point (`apps/desktop`, `apps/playground`) moved, with their history, to their own repository, [Vakyartha](https://github.com/nranjan2code/vakyartha). This repository is now the framework only. Vakyartha pins it as a git submodule; nothing here depends on the app.
- **Playground:** `npm run playground` is now the framework's own viewer (`playground/`): `@vak/host` plus one page of `<vak-surface>` on :5177, no build step. `?session=` and `?model=` pick the session and model. The MCP server and `bench report` project into it as before.
- Root `package.json` no longer installs Tauri or Vite; `npm test` runs `packages/*` only.
- The app's own entries (FinOps, Canvas and Artifacts, the desktop rounds) moved to Vakyartha's CHANGELOG; the entries below are the framework's.

## 2026-10-25, evening: framework round (`cf68562`)

- **Local interactions:** web tables sort, filter and page in the projector, with no model turn. Lists and card grids filter. `totals: true` adds a computed totals row; a total the model wrote is replaced.
- **Outside agents in the viewer:** surfaces projected from outside (MCP, `/api/project`) appear live, and their actions reach the outside agent (`/api/actions`).
- **MCP client and integrations:**
  - `@vak/mcp/client` (stdio, Streamable HTTP, no SDK).
  - Security: per-tool Allow/Ask/Off policies; approvals in the chat; untrusted-output wrapping; a minimal environment for servers.
  - Built-in tools: web fetch (SSRF-checked on every hop) and time.
- **Components:** timeline, steps, code, map and gallery, lowered for targets that don't draw them.
- **Targets:** Markdown, terminal (ANSI) and HTML email (`@vak/email`).
- **Packaging:** `scripts/build-packages.ts`, `@vak/kit` (`createVak()`), and `examples/`.
- **Speed:** prompt caching (Anthropic, OpenAI), Ollama `keep_alive`, a turn profiler.
- **Docs:** SECURITY.md, this changelog.

## 2026-10-25, afternoon: host hardening and provider presets (`406730a`)

- **Host hardening:** JSON-only bodies, Origin and Host checks, a constant-time token check; a session index and eviction; renaming chats.
- **Providers:** 11 OpenAI-compatible labs as declared presets; `PROVIDER_SETTINGS` so settings screens are generated from the registry; each provider's own model list.
- **Telegram:** `runTelegram`, a runner any host process can start and stop.

## 2026-10-25, midday: `@vak/host` (`93681cd`)

- `@vak/host` extracted from the playground (sessions, persistence, token auth, CORS allowlist, app routes), so apps can mount the engine. `VakClient` takes headers.

## 2026-10-24 to 2026-10-25: engine, bench and channels

- **Engine:**
  - A lenient streaming parser, catalog-declared repairs, structure repair, lint, resolve.
  - Inline authoring (A/B: +14 points of check score on the 4B).
  - A history window for long chats; repairs from live 4B output (closers, embedded JSON, bindings, empty frames).
- **Bench:** 30 scenarios, rubrics, Wilson intervals, cassettes and the replay gate.
- **Projectors:** web, text, Telegram (rich messages, conversational forms, saved chats), Slack (Block Kit, modals), Discord (Components V2, paged modals).
- **MCP server** (`@vak/mcp`), the capability policy and calibration, the playground.
