Pinned public fetch on Node 24 (2026-10-26): a live publisher-icon check exposed the custom resolver returning a single address to an all-addresses request. The callback now returns the checked address array when requested, preserving single lookup/private-address refusal. Offline tests cover both shapes; no dependency or API change.

MCP HTTP lifecycle (2026-10-26): a live hosted documentation server negotiated 2025-06-18 but the client sent 2025-11-25 afterward. The client now uses the negotiated supported version and clears it plus the session on close/reconnect. HTTP redirects are refused to protect configured credential headers. Tests cover the exact failure and reconnect/redirect behavior.

Unreviewed integration consent (2026-10-26): custom catalog entries and user-added servers default every tool to Ask regardless of annotations; explicit saved policies still apply. View defaults and execution agree. Required for safe downstream catalog imports; no new API or dependency.

Configurable remote endpoints (2026-10-26): HTTP catalog sources may resolve URLs from detached non-secret configuration. Validation happens before saving a complete text configuration, and again before connection. Existing string sources and user-added persisted servers are unchanged; views never serialize resolver functions. Tests cover headers, endpoint changes, rejected edits, restart and missing setup. 324 tests/replay and typecheck pass; no dependencies.

Media projection and configuration snapshot (2026-10-26): the public media component supports image/audio/video, authenticated resource resolution, local playback choices and text/channel descriptions. Trusted asynchronous host publication reuses canonical persistence/events and checks session ownership/busy state. Integrations.configuration reads detached non-secret configuration without native credential probes, allowing background jobs to recheck authorization cheaply. All 323 tests/replay and typecheck pass; no dependencies. App-side WebKit checks verify actual playback and resource cleanup; paid generation and live microphone tests are outside this framework change.

Review pass (2026-10-26): fixed ten findings from a fresh review. A saved chat now redacts tool output as SECURITY.md promised (`role:"tool"` becomes `[tool output not saved]`, live session and transcript keep it); session files are collision-free, so `x/y` and `x_y` no longer share, overwrite or delete each other, and a chat saved under the old sanitized name is adopted only when the file's own `id` matches. A turn that fails before the model is asked still ends with `error`/`run_end`, and one integration whose installed folder vanished no longer fails the turn. `runAgent` now rejects caller-contract errors instead of resolving `{stop:"error"}` (**Breaking** for apps that tested for it; host still records an error turn). Streaming batches parsing and applying (400-node 36 KB render 7.3 s → 44 ms at 8-char deltas; one long text node still updates). SSRF refuses IPv6 addresses carrying a private IPv4 one (NAT64, 6to4, mapped, Teredo) and `pinnedFetch` dials the checked address, closing rebinding. Comparisons and number fields read locale numbers ("1.234,56", "12,50") and look for the deciding key on any option. `@vak/web` gained its first tests against a minimal DOM stub. 319 tests/replay gate and typecheck pass; no dependencies. Apps get this after a push plus their pin move.

Session deletion cleanup (2026-10-26): `host.remove` now deletes the owned `.json.tmp` file as well as the canonical session and transcript. This closes raw-content residue after a crash during atomic persistence. Existing scoped-removal test verifies the temporary is removed and other sessions remain. 287 tests/replay gate and typecheck pass.

Serialized list-member repair (2026-10-26): raw research task `84844f19` stored table settings after a closed rows list inside one string; ordinary list parsing added a stray row. Normalizer now reads the owning object using the existing parser and schema; only valid declared sibling settings are recovered, explicit values win, and source literals/ordinary rows stay unchanged. Exact fixture in `packages/core/test/fixtures/list-member-tail-4b-2026-10-26.json`. 287 tests/replay gate and typecheck pass. No app-specific fields, facts, dependencies or regex repair.

Edit-batch constraints (2026-10-26): opt-in public `validateEdits` on agent/host supplies bounded caller contract issues after each surface edit batch, before the next correction. Raw research task `eb3be4b1` showed component-only input diagnostics leading to a form inside evidence, while app completion validation had not run yet. Exact first edits now verify both feedback sources reach the next request; malformed callback results fail closed. 285 tests/replay gate and typecheck pass. Apps must opt in and still use final completion checks; no automatic acceptance or external authority.

Cyclic-layout repair (2026-10-26): raw calls from Vakyartha local task `1c82b092` replayed as `root → stack_2 → root`, with no diagnostics before this change. Structural repair now removes ancestor child/template references without changing valid table content. Resolver recursion protection remains; lint also diagnoses residual resolved cycles. 283 tests/replay gate and typecheck pass. Fixture and tests live in `packages/core/test/surface-cycle.test.ts`. App consumption requires pushed pin update; theme/card code untouched.

# HANDOVER.md: state of work (2026-10-26)

Minimal web styling and white-label themes (2026-10-26, local changes): reviewed the running playground and consulted Geist/Radix references. Defaults now use neutral accents/first chart series, medium-weight type, 8px panel corners, no shadows, natural-height grid items and label-width card actions. Public `--vak-*` tokens inherit from app wrappers; private fallbacks preserve light/dark defaults. Added type scale/weight, spacing, card padding, control height, grid minimum and alignment tokens; README documents the contract. `/styles` is a model-free reference covering all 37 catalog components, with appearance/brand/density controls and local action receipts (gallery uses HTTPS placeholders). Checked light/default in Safari, light/dark and wrapper branding in Chromium, and 390px layout without page overflow. All fixtures have zero diagnostics, 277 tests/replay gate and typecheck pass. No dependencies, package exports or app code changed. App adoption requires moving Vakyartha’s framework pin; no installed-app replacement is included.

Response-completion API added 2026-10-26: `runAgent` / `host.run` accept opt-in `completion: "response"`. Default projection completion remains unchanged; tool runs can continue after publication. 238 tests and typecheck pass, including interleaved external work, step limits and host propagation. No runtime dependency added.

Wrapped-list binding repair added 2026-10-26 from real local-agent research: known absolute array references inside singleton arrays become canonical list bindings only where the schema permits them. Literal/missing/scalar/relative cases remain unchanged. 240 tests including replay gate and typecheck pass.

Application completion checks and MCP result observation added 2026-10-26: trusted in-process callbacks support bounded same-run correction and real tool-result evidence; rejected final prose is withheld. Default behavior unchanged. 243 tests and typecheck pass.

Rejected tool-syntax recovery added 2026-10-26: Ollama's HTTP 500 generated-tool XML parser rejection is typed as `ToolGenerationError`. Tool runs retry only before any text/call, through the same bounded loop and provider admission. Prior tool receipts remain; partial streams, cancellation and other errors do not replay. 248 tests/replay gate and typecheck pass. This closes a premature-abort cause, not output authoring or factual correctness; Vakyartha evaluates the affected local comparison separately and retains the results in its EVALUATION.md.

Authoring/data fidelity repairs added 2026-10-26: replayed the retained local comparison through SurfaceStore before changing code. Keyless member groups no longer become extra inputs; explicit stringified list bindings survive coercion as live references; bound container shape mismatches are diagnosed without breaking numeric lists. Prompts teach exact data initialization and patch-based correction, with bounded ID/root inventories on completion failures. Explicit render/empty-list replacement semantics stay intact. 255 tests/replay gate and typecheck pass. Raw numeric mistakes are preserved for truthful evaluation, not rewritten; local app outcome reports determine remaining work.

Trusted completion acknowledgement added 2026-10-26: `CompletionCheck` may return the existing issue array or `{issues, response?}`. Successful checks can replace emitted final prose without forcing a stylistic generation retry; raw provider prose remains diagnostic data. Failed/malformed checks still withhold final text. This followed a real comparison where exact final wording alone caused retries and later lost columns. 257 tests/replay gate and typecheck pass in an isolated checkout; no dependencies or existing-signature break.

Token-based primitive member recovery (2026-10-26): an isolated branch fixes a missing key quote before a complete JSON primitive, using token boundaries and `JSON.parse`, not a compound regex repair. Replayed real typed-comparison render/update calls now retain both rows; deliberately wrong facts are preserved. 281 tests/replay gate and typecheck pass. No compatibility adapters, dependencies or renderer/style edits. Concurrent theme/card work stays in its original checkout; reconcile through the branch review rather than staging that work.

Start here in a new session. Rules: [AGENTS.md](AGENTS.md). System: [SPECS.md](SPECS.md).

## Handover prompt (paste into a new session)

```
Continue vak Projection in /Users/nisheethranjan/Projects/vakProjection.

First read AGENTS.md (rules), SPECS.md (architecture) and HANDOVER.md (status and next steps). Then run `npm test`; 319 tests should pass, and `npm run typecheck` should be clean. Nothing is running. Start the playground (.claude/launch.json "playground") when you need it, and tell me when you do.

Focus: the framework only: the core system (engine, catalog, projectors: web, text, Markdown, terminal, email, Telegram, Slack, Discord), providers, host, MCP and the bench, plus the playground viewer. The desktop app is Vakyartha, a separate repository (github.com/nranjan2code/vakyartha, locally ~/Projects/vakyartha); it consumes this repo as a submodule, so never import from or design around it here. Telegram live testing is parked: don't start the bot unless I ask. No Slack/Discord bots.

Rules that matter most:
- No third-party SDKs: everything is built on Node 24 built-ins and fetch.
- No shortcuts or hard-coded fixes: every repair is a catalog declaration or a general engine rule, with a test built from the real model output.
- Never blame the small model: local Ollama `qwen3.5:4b-mlx` is the primary target. Local bench runs are free; ask before any paid model run (OpenAI).
- Secrets live only in .env. Never print them, and run the secret scan on the staged diff before every push. The repo is public: github.com/nranjan2code/Projection. Git identity: Nisheeth Ranjan <nisheethranjan@icloud.com>.
- To diagnose bad output, read the raw tool calls (bench results, .vak/playground/<session>.jsonl, .vak/telegram/<chat>.jsonl), replay them through SurfaceStore.apply, and fix the general cause.

Pick up from "Next" in HANDOVER.md, in order, and ask me if in doubt.
```

## Where things stand

- **Answers in words (2026-10-26, for Vakyartha's voice):** `core/answer.ts` exports `agenda`, `resolveAnswer`, `answerSchema`/`readModelAnswer`, `fillAnswer`, `actOn`, `question`/`readBack` and `AGREEMENT_WORDS`; words in en/fr/de/es/it/pt/nl (numbers and dates English only). `<vak-surface>.activate(key)` submits a control exactly as a click. `store.submit` adds `item` from the card heading when a per-item button's payload names no item. Spoken gist stays in the app until a second target needs it.

- **In-process host execution (2026-10-25):** additive public `run` and `view` APIs reuse the host's canonical sessions, surfaces and validation. Runs are independent of UI connection lifetime and reject mutation takeover; transport chat keeps its prior behavior. Trusted callers supply tools, cancellation, bounded steps/output and event observers. No task/product policy added to the framework. Optional `allowSessionMutation` reserves application-owned sessions from HTTP writes between runs. Idle session deletion also removes its transcript; public `remove` supports app-owned data lifecycle. Verified: 225 tests and typecheck; see CHANGELOG. App consumption requires a pushed pin update.

- **Integrations moved into the framework (2026-10-26, user's request):** the install/configure/run mechanism for MCP servers left Vakyartha's `sidecar/integrations.ts` for `packages/mcp/src/integrations.ts` (`Integrations` in `@vak/mcp/client`), because AGENTS.md promised pinned installs but only the app enforced them. The app keeps its catalog (which servers, versions, descriptions), its Keychain store and its Settings pages. Logic is unchanged apart from: exact versions enforced (`pinnedInstallArgs`), `/home` refused as a folder, `.mjs`/`.cjs` npm scripts run with Node, and the added-server description no longer names "vak". Six new tests with a fake npm. The framework-or-app rule is in AGENTS.md and SPECS §10; the other candidates found in the same review (secret storage, the channel manager) stay in the app for now.

- **Framework and app split (2026-10-25, user's request):** the desktop app left this repository for its own, [Vakyartha](https://github.com/nranjan2code/vakyartha) (`~/Projects/vakyartha`), with its 7 commits of history (`git subtree split --prefix=apps/desktop`).
  - **Dependency runs one way:** Vakyartha pins Projection as a git submodule (`framework/`) and links `framework/packages/*` as npm workspaces. Nothing here imports, builds or tests the app; this repo only links to it (README "Built with vak", SPECS §10).
  - **What left:** `apps/desktop` (Tauri shell, UI, sidecar, FinOps, Canvas/Artifacts, integrations marketplace, channels, WebKit checks, their tests) and `apps/playground` (the app in a browser; now `npm run web` in Vakyartha on :5178). App history, status and next steps moved to Vakyartha's HANDOVER.md; its architecture (old SPECS §10) to its SPECS.md; the settings-storage security check to its SECURITY.md.
  - **What stayed:** every `packages/*` package (including `@vak/host`, `@vak/mcp/client` and Telegram's `runTelegram`, which the app uses), the bench and replay gate, examples, scripts.
  - **New playground** (`playground/`): the framework's own viewer, `@vak/host` plus one page of `<vak-surface>` on :5177 with no build step. `?session=` (MCP uses `mcp`, the bench `bench`) and `?model=provider:model`. Verified: a surface projected through `/api/project` rendered live and its button press came back through `/api/actions`.
  - Root `package.json` lost Tauri and Vite (lockfile pruned); AGENTS.md rule 1 lost the `apps/desktop` exception.
- **Tests:** 197 passing (the 11 app tests moved with the app), typecheck clean. Latest framework round: rich-component contracts, list/step recovery and quoted table bindings.
- **Baseline** (bench v2, 4B, `tools/core/examples/inline`, 1 run × 30 scenarios), re-recorded 2026-10-25 after the bench-category fixes:

  | | Now | Previous | Old flat baseline |
  |---|---|---|---|
  | Fully passing | **73%** [56–86] | 73% [56–86] | 47% [30–64] |
  | Check score | **91%** [86–97] | 89% [81–96] | — |
  | Dashboard (fully passing) | 100% | 60% | — |
  | Planning | 60% | 40% | — |
  | Comparison | 40% | 80% | — |
  | Median per scenario | 24s | 26s | — |

  One run per scenario, so category numbers swing (intervals are wide). The comparison dip in this run: phone-plans (no action), restaurants (a template it never defined), flights (no cards or table): content, not engine faults. The gate run just before it had comparison at 80%. The parser rules from pizza-order came after the recording; replay shows no change to recorded scores.
## Done in this stretch

- **Graph component and named extended components (2026-10-26):**
  - `graph` (extended tier): nodes and labelled edges, accepting the memory server's shape; `@vak/web` draws it with pan, pinch/Ctrl-scroll zoom, fit, keyboard, draggable nodes, selection, search and frame-fitting layered/force layouts; other targets get one line per connection. Checked in Chromium, at phone width and in WebKit.
  - Small models on the core tier now get an extended component when the user names it (name or alias, "an org chart" → graph) or when it is already shown. Found in Vakyartha: "show your memory as a graph view" became cards because the 4B model's vocabulary had no graph.
  - Engine: aliases apply inside an `anyOf` branch the value already satisfies. Bench: new `team-graph` scenario; slice `components-named` records the rich scenarios on the default 4B plan (slice components-named, 7 rich scenarios × 1 run on the default core plan: every requested component used; 6/7 complete, 98% of checks after the map repair (replayed); team-graph lost its edges to an escaped quote).
  - Map places written as "Name, Address" text split into name and address (4B, london-places).
  - Not done: an escaped quote inside a JSON-string list prop swallowed the next prop (4B team-graph: `edges` ended up inside the `nodes` string); recover sibling props from such strings in the engine.
  - Not done: model-written template syntax (`{{#*}}…`) is shown as literal text; it should go back to the model as an error.

- **Rich-component reliability fixes (2026-10-25, current round):**
  - Fixed general engine causes from real calls: JSON object sequences in list props retain every validated record; leaf child records become the one matching required object-list prop; quoted pointers such as `{"/data/invoice_rows}"` bind normally, with literal source excluded.
  - Catalog `retype` predicates identify validated semantic variants: a timeline carrying process states becomes steps, including when its items come from a data binding. No states or item labels are inferred from prose; the original fields are retained.
  - The compact prompt now exposes nested item schemas, required fields and enums. Render tool instructions agree with inline authoring. Source/caption/units/order fidelity is explicit. When the request names an available catalog component, its exact contract is repeated after the examples. This is driven by the catalog and request, not by benchmark scenario names.
  - Latest slice: `components-contract`, 2 runs × 6 scenarios on free local 4B, same checks as v3: **11/12 fully passing live (92%), 94% mean check score**, median 4.2s. The remaining output had correct rows and formats but a malformed quoted pointer; after its engine fix **12/12 replay fully**. This replay result is distinct from the recorded live baseline. The original starting slice was 2/6 live, 66% check score; sample sizes remain small.
  - Four 12-run component iterations are retained (including failures) under `components-reliability`, `components-reliability-final`, `components-reliability-verified`, `components-contract`. Intermediate baselines measure their own prompt revisions; `components-contract` is the latest. Earlier recordings remain protected, with only improvements locked via replay updates.
  - Broader core smoke (`reliability-core-smoke`, four scenarios, one run each): 2/4 fully passing, 91% mean check score. Dashboard and newsletter passed. Recipe rendered both lists but omitted an Ingredients heading; pizza submitted a valid form but its follow-up made no projection call, leaving the view unchanged. These content/interaction misses are retained as follow-up work, not hidden by the component result.
  - Fresh fixtures and tests cover the raw map sequence, step children, state-bearing timeline, exact code, formatted totals and malformed quoted pointer, plus guards for genuine timelines, missing target capabilities, explicit items, nested subtrees, bound process data and literal source.
  - Re-record with the component-only command below, changing `--slice components-v3` to `--slice components-contract` and `--runs 1` to `--runs 2`. No paid model runs; Telegram stayed stopped. Verification: 207 tests pass, typecheck clean, zero replay regressions.

- **Component benchmark coverage (2026-10-25):**
  - Bench v3 adds six supplied-data scenarios (36 total): `release-timeline`, `delivery-steps`, `javascript-snippet`, `london-places`, `photo-gallery`, `invoice-totals`. They inspect actual resolved component payloads, not just mentions in prose. Totals checks separately protect 9 units, 65 revenue, currency formatting and an unsummed percentage column.
  - Recorded on free local Ollama `qwen3.5:4b-mlx`, plan `tools/extended/examples/inline`. Cassettes retain the initial six, confirmation six, three extra totals samples, and final six (`components-v3`): 21 samples total. No paid model runs. The final six-scenario run passed 2/6 completely (66% mean check score); these are measured failures, not a claim that all new components are reliable. The final baseline uses the finalized rubric; draft summaries were removed, raw calls retained. The original v2 full/form baselines and cassettes are untouched.
  - The new code scenario exposed `${name}` being treated as a missing UI binding. Added the general catalog property `literal`, used by `code.code`: embedded braces survive normalization, input-name repair, lint and resolution; a whole-value binding can still load code from data. Tested from the verbatim recorded call, also with conflicting data/input names and `{{name}}` source. Original code recording replay improved to full score.
  - Kept genuine content failures: malformed table rows; missing `totals`; dropped dollar/percentage formatting; incorrect step/map payloads; source code rewritten with ANSI escapes. These are not repaired with scenario-specific logic. Totals arithmetic has a passing real recording even where formatting failed, and a mutation test proves wrong sums lose replay points.
  - Replay still scores all older cassettes despite the additive version bump. Mandatory coverage prevents silently deleting a new scenario's recordings. The totals rubric was refined into independent checks during development; expected-score changes carry an explicit acceptance reason in the cassettes.
  - Re-record the component slice with:
    `npm run bench -- run ollama:qwen3.5:4b-mlx --runs 1 --only release-timeline,delivery-steps,javascript-snippet,london-places,photo-gallery,invoice-totals --slice components-v3 --plan tools/extended/examples/inline --save`.

- **Framework round, 2026-10-25 evening (user: "do them", then many additions; the app's part of this round is in Vakyartha's HANDOVER):**
  - **Local interactions** (`core/interact.ts`): web tables sort by header, filter, page; lists and card grids filter. Projector defaults by size (no model involvement); `sortable`/`searchable`/`pageSize` only switch them. `totals: true` adds a computed totals row (a total the model wrote is replaced; percentage columns and the first column are never summed). Shared value parsing ($1,299, 12%, 1.2k, dates).
  - **MCP client and integrations, security first:** `@vak/mcp/client` (stdio + Streamable HTTP, no SDK); per-tool policy Allow/Ask/Off from the tool's own hints (reads allowed; writes and open-internet ask); approvals over the chat stream (Allow once / for this chat / Deny); output wrapped and capped as untrusted data; servers get a minimal env (our keys never), own HOME/cwd. Built-ins: Web pages (SSRF-checked on every redirect, https only, 2 MB) and Time. The integrations catalog, pinned installs and the Settings marketplace built on this are the app's (now in Vakyartha). Verified live: the 4B model called the web tool, the approval card stopped it, the answer used the real page.
  - **New components** (extended tier): timeline, steps, code (copy), map (places + OpenStreetMap links, no tiles), gallery. Web draws them; every other target gets them lowered (`core/lower.ts`). `grid` lost its `gallery` alias and `text` its `code` alias (no recorded output used them).
  - **New targets:** Markdown (`projectMarkdown`), terminal (`projectAnsi`, strips escape sequences), HTML email (`@vak/email`, table layout, inline styles, controls become one "Open to respond" link). Slack/Discord listeners not built (user preference: Telegram only).
  - **Packaging:** `node scripts/build-packages.ts` builds every package to `packages/*/dist` (JS + .d.ts + package.json with sibling deps); verified by installing the tarballs into an empty project (JS and TS). `@vak/kit`: `createVak({ model }).ask/act/render/email`. Examples in `examples/` (terminal chat, email digest, web page). Nothing published.
  - **Speed:** Anthropic cache breakpoints (system, tools, latest message), OpenAI `prompt_cache_key`, Ollama `keep_alive: 30m`. Profile (`scripts/profile-turn.ts`, 4B): ~3k tokens in, ~1.3k out, 25 tok/s overall; the whole tool call arrives at the end (Ollama does not stream tool arguments), so the UI shows an elapsed-time status. The next speed lever is fewer output tokens (needs a bench A/B, see Next).

## Done before that

- **Empty frames from the 0.8B model (playground, user's workout query):** five `tabs` with titles and no panels, then the day cards as a `"children"` list after the nodes. The cards were dropped and the screen showed bare divider lines, with no error. Now: a second node-list key joins the nodes; empty layout containers below the root are removed (warning); a surface with nothing but empty containers is an error, so the model adds content. A per-container error was tried first and rejected: it failed recorded 4B output that is fine (empty stacks are invisible).
  - Note: the playground saves the model on every send, so a browser that used the old 0.8B default keeps it until the user types another model.
- **Playground defaults to the 4B model:** Ollama's declared default is `qwen3.5:4b-mlx` (`OLLAMA_MODEL` overrides; falls back to the first installed model if it is missing). Before, the first listed model was picked, which was the 0.8B one. A model chosen in the browser is still remembered. Same sales-dashboard query: 0.8B needed a retry and showed empty KPIs; 4B rendered KPIs, a monthly chart and a top-5 table in one clean call (39s).
- **Form slice baseline re-recorded on inline (was Next #1):** 3 runs × 5 form scenarios: fully passing 73% [48–89] (flat: 73%), check score 95% (flat: 94%), median 22.5s (flat: 17.4s). No difference within noise. Failures: two content misses (no form; no meal question), csat with too few inputs, and job-application run 0, which retried three times on a typeless object of form values and timed out. That object is now read as surface data (replay 0.80 → 1.00).
- **MCP authoring (was Next #1), the user's choice: inline, configurable.** `@vak/mcp` now teaches inline children in its instructions and tool schema, matching the playground and Telegram; `VAK_AUTHORING=flat` (env) or `authoring: "flat"` (option) switches back. A running MCP server picks it up on restart.
- **Form design (was Next #1), closed by the user's choice: leave it.** A form that says "choose a hotel" with nothing on screen to pick one appeared in 1 of 42 recorded comparison first screens (gate 2026-10-25T07-35-53, hotel-booking-flow); the model then confirmed the first hotel. Detecting it needs a heuristic (≥2 cards, a form, no per-item button or select) that could misfire on info cards beside a signup form, so no lint.
- **Catalog usage hints (was Next #1, user's choice):** `list` ("for ingredients, items and steps; ordered: true for steps") and `checkbox` ("one per checklist item, inside a form"). Live gate against the re-recorded baseline: fully passing 73% → **83%** [66–93], check score 91% → **96%** [92–100], planning 60% → 80%, comparison 40% → 80%, information 50% → 100%; recipe and onboarding-checklist now pass. Interaction 75% → 63% (wide intervals): pizza-order answered in text without a tool, dashboard-filter's follow-up only set unused data, todo-add bound its form under the task list.
  - New lint error from todo-add: an input bound under data that can't hold it (`/todos/new-task` while `/todos` is a list). The form could never submit; the error names the conflict and suggests `/form/<field>`.
  - Parser: `"values": {"/data/revenue_values"}` (quotes inside binding braces) is the binding (dashboard-filter retried on it).
  - The baseline was not re-recorded after the hints (the gate is the measurement); re-record with `run ... --save` when you want 83% as the reference.
- **Weak bench categories (was Next #1):** every planning and dashboard failure in the 2026-10-25 run and gates that had an engine cause is fixed, each as a general rule with a test from the recorded call (`packages/core/test/bench-outputs.test.ts`, fixture `fixtures/bench-4b-2026-10-25.json`):
  - paths: `/data/` as a first step, dotted paths, bare pointers at any depth and as whole text values that name data, `{{path}}`, no doubled currency sign
  - call shape: nodes in a stray argument (`"chart": "{...}, {...}]"`), `prop`/`properties`/`attributes` as props, `null` props omitted, a lone `{data}` object, a leaf's props written as its only child, a repeated `children` key concatenating
  - parser: escaped strings stay strings, values missing their opening quote, key and value in one string (`"type:section"`, `"type:=","select"`)
  - chart: a series of text annotations is dropped beside real series
  - From the re-recorded run (pizza-order): `"type: stat"` after an id, `"id: "x"`, unquoted `key:` in an array, and `{size}` binding to the one input bound to `/form/size`.
  - Live gate (4B, before the last three parser rules): fully passing 73% → 77%, check score 89% → 92%, dashboard 60% → 100%, planning 40% (content choices, see Next #1). No significant regression.
- **Web tests finished (was Next #1)** in the browser pane, 4B model, live. Each defect found was fixed generally, with a test from the real call:
  - Workout tabs: every day's button had the id `"actions"`; each replaced the last (Day 1 showed "Start Day 5"). An inline node reusing an id from the same call now gets its own id.
  - Dashboard 1: a root list closed early (`]}, {alert}`) lost the alert silently; `rows: "/top_products"` showed the path. Values after a closed top-level list continue it past stray closers; bare pointers bind.
  - Dashboard 2: a stray `}` with no closers after it was read as an omitted `]`, and the chart, table and data were lost. Undecided closers are now read by how the rest of the text closes. This also lifted the recorded rome-itinerary from 0.33 to 1.00 (replay gate updated).
  - Dashboard 3: `"action':'view_july'` (mixed quotes) swallowed half the surface. A key opened with one quote and closed with the other ends there.
  - Viewports: tablet (2 columns) and phone (1 column) render well. The header wrapped into 3 rows at 800px (the provider select sized to its longest option); now 2 rows at 800px, tidy on phone and desktop.
  - Seen, not fixed: the model copies the worked example's values ($198k, Desk lamp); a card given stat props (`label`/`value`/`delta`) shows only a badge.
- **Prop values that name a component (was Next #1):** catalog extension `namesComponent` (on `input.kind`). `{"type":"input","props":{"kind":"date"}}` becomes a `date` node instead of an enum error and a retry; aliases work both ways (`inputType: "daterange"` → `date` with `range: true`, `kind: "checkbox"` → `checkbox`). Unknown values (`"password"`) are still errors. Test built from the real Telegram call.
- **Long chats (was Next #2):** `runAgent` takes `history: N` (last N turns plus a note describing the shown surfaces); Telegram uses 6. `/start` resets the chat. Tests are built from the real 50-message chat.
- **Engine, from the live hotel test:**
  - A `{` where a key belongs, inside an array, is the next element. The parser used to read it as junk, the next fields' members overwrote the current one's, and a form lost two of three fields.
  - `{"priority": "secondary"}` alone in a children list applies to the node before it instead of being a typeless node (an error and a retry).
- **Telegram:** text the model writes after an engine error ("I see the issue...") is no longer sent to the user.
- **Live hotel flow on a fresh chat:** it was confirmed live:
  - one Book button per card, each carrying its hotel
  - a rich message, with no plain-text fallback
  - real values in the booking and confirmation cards

  The "/night" fix is still unseen, because the model didn't give prices.

## Done earlier

- **Inline authoring A/B:**
  - Inline won (+14 points check score, paired CI [+3, +26]) and is now the default for tool calling.
  - Calibration overrides the default plan only on a clear difference (Wilson intervals).
- **Engine repairs**, each from real model output with a test:
  - stray, omitted and mistyped closers
  - JSON inside strings without escaping
  - a value after a stray colon
  - a `"key":` inside an array
  - data written inside the nodes string
  - a template listed as a plain child
  - double parents
  - nodes cut out by an update
  - an item's own list path
  - plain-value items (`{.}`)
  - top-level `{name}` binding to surface data
  - double-escaped newlines
  - lists in text props
- **Lint:** an empty layout root and placeholders that can never fill are errors (with a message telling the model what to do).
- **Telegram:**
  - Taps are answered immediately.
  - Chats persist, and unfinished updates replay after a restart.
  - Answered buttons are replaced by the answer.
  - Removed surfaces close; deleted messages are re-sent.
  - Per-chat transcripts are recorded; `scripts/telegram-repro.ts` replays a turn offline.
- **New packages:** `@vak/slack` (Block Kit + modals) and `@vak/discord` (Components V2 + paged modals). Both are unit-tested; there are no live bots (the user has no Slack or Discord bot).
- **Playground:**
  - The plan bar shows authoring.
  - Per-session transcripts go to `.vak/playground/`.
  - A new surface scrolls into view.
- **Telegram, from the latest live tests:**
  - A surface changed in reply to a typed message moves to the bottom as a new message: "hi" used to edit an old message far up the chat. After a tap, surfaces are still edited in place.
  - Top-level `{name}` binds to the surface's own data (the model retried 3 times on `{booking_info}`).
  - One fixed button per item stays with its own item ("Book X" ×3 used to repeat in every card).
  - A repeated ending after a placeholder is dropped ("$800/night/night").
  - A button whose label resolves empty gets text (the action's name, then "Open"). Telegram refused a whole message for one empty label (`RICH_MESSAGE_BUTTON_TEXT_EMPTY`) and the user got the plain-text fallback.
- **Docs:** AGENTS.md, SPECS.md and this file.
- **Web tests passed** in the browser pane:
  - examples render; buttons send the item's data
  - form validation: required, email, choice, checkbox, correct submit data
  - a live hotel comparison (33s)
  - follow-up click → booking confirmation

## Next (in order)

1. **Core-smoke follow-up:** inspect the saved recipe missing its Ingredients heading and pizza action with no changed view (`reliability-core-smoke`), then choose general contract/engine fixes.
2. **Bench A/B for compact output** (4B): the interface JSON is ~1.3k tokens per answer; a shorter authoring (data-first rows, fewer repeated props) could halve decode time. Measure with `npm run bench -- gate ... --plan`, never change blindly.
3. **Before publishing:** confirm whether the `@vak` npm scope is available. The user chose MIT licensing and no external contributions; see `LICENSE` and `CONTRIBUTING.md`.
4. **Parked until the user asks: Telegram live** (start the bot; the saved Save Details press replays).
5. **Optional, ask first:** near-miss id pairing.
6. **When the app needs a framework change:** make it here (with tests), push, then move Vakyartha's `framework` pin; note anything that breaks an export in CHANGELOG.md.

App work (installed-app checks, integrations UI, signing and builds) is tracked in Vakyartha's HANDOVER.md.

## Useful paths

- Telegram transcripts: `.vak/telegram/<chat>.jsonl`; state: `.vak/telegram/<chat>.state.json`
- Playground transcripts: `.vak/playground/<session>.jsonl`
- Calibration and profile cache: `.vak/models.json`
- Playground data: `.vak/playground/sessions/` (saved sessions)
- Bench results: `packages/bench/data/results/` (gitignored); baselines and cassettes: `packages/bench/data/{baselines,cassettes}/`
