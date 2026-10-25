# Changelog

What changed, newest first. Nothing is released yet: every package is `0.1.0` and unpublished. Apps pin this repository by commit or tag; a change that breaks a package export is marked **Breaking** (see [RELEASING.md](RELEASING.md)). Details of each step are in [HANDOVER.md](HANDOVER.md); the architecture is in [SPECS.md](SPECS.md).


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
