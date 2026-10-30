# Projection handover — 2026-10-27

## Revisioned canonical session owner — 2026-10-30

`@vak/host` now exports `HostSessionSnapshot` and `HostSessionStore` for an app-owned canonical persistence boundary. The optional `sessionStore` host option supports load, compare-and-set save, list and revision-checked removal; it is mutually exclusive with `sessionsDir`, so the host does not create a second canonical writer. A failed save fences that in-memory session until host reload, avoiding continuation from a stale view. The adapter owns atomicity, durable revision checks and deletion semantics. Regression coverage proves write, reload, summaries, surface restoration and deletion without creating a sessions directory. The full framework suite/replay passes 418/418, typecheck and package generation pass. This is the general persistence seam only: Vakyartha has not adopted it yet, and native authorization, task-state recovery, concurrent-host behavior and product outcome checks remain open.

## Fenced candidate commit handoff — 2026-10-30

`VakHost.runCandidate` now returns a bounded opaque `candidateId` alongside the isolated proposal. The host retains a private copy of the exact candidate with a ten-minute commit deadline, at most four pending candidates and 8 MiB per candidate. Expired uncommitted slots are reclaimed on the next candidate operation. `commitCandidate` submits that copy, its base versions, expected canonical revision and task fence to an app-provided canonical owner. A commit attempt binds the ticket to one commit identity, canonical revision and fence; a retry after callback failure must reuse them, allowing an idempotent durable owner to return the prior receipt after a lost acknowledgement. A successful receipt consumes the candidate. `discardCandidate` frees candidates that have not entered commit. The framework never writes or broadcasts the candidate through the canonical session store.

Host tests cover exact-copy handoff, caller-side mutation, changed-fence refusal, retry identity, one-use success, count bounds, discard and unchanged canonical state; the focused host suite passes 22/22, the full framework suite/replay passes 417/417, typecheck and package generation pass. The app must still implement the callback with native prepare/fence/durable-commit semantics and a durable commit-receipt lookup. Candidate references are process-local: a restart loses the held bytes, so restart reconciliation and interrupted-commit recovery are not supplied by this API. This checkpoint establishes a public framework handoff, not an enabled app task path or user outcome pass.

## Provider transport operation identity — 2026-10-30

Provider-aware transport callbacks now receive a stable UUID and attempt number. Retries share one logical operation identity; this lets hosts deduplicate or refuse replayed generation effects while preserving the adapter's retry context. A focused regression covers identity and attempt progression across a retry. This is API metadata only; hosts still must enforce idempotency, approval, budgets and durable receipts.

## Isolated host candidate API — 2026-10-29

Added public `VakHost.runCandidate` for bounded single-turn candidate generation on explicit surface snapshots. It starts with no session history, inherits no host-global tools, allows only caller-provided local context tools, forces transactional `vak_submit`, and returns base versions plus isolated candidate surfaces without canonical persistence or broadcasts. The caller remains responsible for version-fenced commit and semantic/outcome review. Test `packages/host/test/host.test.ts` proves the existing session view and reload stay unchanged after candidate completion, while a host-global external tool is not inherited. Under bundled Node 26.13.0: `npm run typecheck`, `npm test` (413/413), targeted host tests (19/19) and package build pass. This is a proposal mechanism only; it adds no native authority, commit protocol, isolation, budget scheduler or end-to-end agent runtime.

## Host-owned provider transport seam — 2026-10-29

Provider constructors and `ProviderEntry.make` accept an optional provider-aware `transport`, used for model discovery and request/stream traffic. The callback receives adapter identity and request details, letting embedding hosts enforce provider-specific egress policy while leaving default Node `fetch` behavior unchanged. HTTP retry and response-stream behavior remain in the shared adapters. Focused provider tests, all 412 framework tests/replay, typecheck and package build pass. This exposes a transport seam only; it does not implement or certify a native broker, credential isolation, approval UX, endpoint policy, or user outcome.

## Procedure context — 2026-10-29

Added callerInstructions metadata for bounded wrapper selection without copying catalog/protocol text, explicit host-owned instruction-loader metadata, current-run system delivery, historical payload omission and finite full-context admission. Five focused regressions cover native/decoded delivery, old unmarked loader history, complete reference data and oversized refusal. Canonical history, permissions, external clipping and counted steps remain. The primary local free-form contract passes 3/3 with original numeric data and two independent surfaces; receipt `.vak/contracts/primary-provider-2026-10-29T04-54-25.386Z.json`. Each case repaired a rejected root ID within the unchanged two requests. The independent table-only record gate passes 2/3; `[100,70]` aborts at the unchanged 60-second deadline before any dispatch/diagnostic or canonical surface. Receipt `.vak/contracts/record-view-2026-10-29T05-02-16.884Z.json`. Offline inspection locates the earliest observed boundary at provider generation, not mapping or skill loading; no prompt/schema variant or rerun followed. Earlier provider/source/interaction failures remain historical/open at their scopes. 410 framework tests/replay, typecheck and package generation pass. The first full run retained four expected example-projection failures after changing the sample to raw numeric values and unit labels; the matching example assertions were updated without changing real-output regressions.

## Shared content density — 2026-10-29

A real installed root-card/text-child graph exposed a selector collision: `.card .body` also matched descendant text variant body, doubling padding and applying flex container rules to prose. Container selectors are now direct-child scoped. Standalone cards/alerts size to content with a responsive reading cap; semantic data panels, peers and explicit measures preserve available width. Metrics and forms no longer force a boxed card appearance. Vakyartha retains the original native failed geometry check and owns its independent wide/narrow content/collection UI checks. Source, values, interactivity and authority are unchanged; model authoring reliability remains open.


## Shared action sizing — 2026-10-29

The installed reference app exposed ordinary actions stretching across vertical panels and compact input padding exceeding the intended 32px rhythm. The web projector now uses intrinsic button width, consistent inherited control padding and input line-height, preserves explicit measures/alignment, and wraps long labels. Vakyartha retains the original failing native control fixture (`vak-controls-hq11Mg`) and owns the adoption/end-to-end WebKit evidence. Mechanism verification and adoption results must be recorded separately; this change does not certify general authored-layout quality.

## Private transport boundary — 2026-10-27

`createFetchHandler` exposes the existing admitted host/app request path as streaming Web Request/Response without a listener. The transport-neutral structural request/response types also accept the existing Node HTTP adapter. `VakClient` has optional fetch injection. App-specific process pipes, native IPC, pricing and product routes remain outside Projection. 398 framework tests/replay, typecheck and package generation pass. Four adapter regressions cover JSON/admission inputs, binary streaming, early headers, cancellation and failures without a network listener. This changes transport only; existing model/source/interaction/receipt failures remain open.


## Authoring schema size — 2026-10-27

Common component properties retain strict schema types, but their repeated descriptions now appear once in `systemPrompt`. For the primary local core tier, the tool definitions measure 24,270 → 19,878 characters. Focused regression, typecheck and 394 tests/replay pass. The required local record-view check aborted at its first initial-values case before accepted output; receipt `.vak/contracts/record-view-2026-10-27T14-22-47.420Z.json`. This is a context-size mechanism improvement only. The app owns the 37,190-character total request measurement, the separate integration-tool schema cost and end-to-end latency checks. Do not treat this as an outcome or latency pass.

## Surface layout checkpoint — 2026-10-27

Common `maxWidth: sm|md|lg|full` adds a responsive measure to every component independently of span. Explicit numeric grids preserve unused tracks; automatic grids remain fluid. Horizontal panels default to top alignment and honor explicit alignment at narrow widths. Charts have a readable default cap, an explicit full-width option and deferred/cancellable resize drawing with observer cleanup. No arbitrary CSS, dependency, new data path or computation semantics.

393 tests/replay, typecheck and package generation pass. Vakyartha's deterministic mixed-surface WebKit script checks cards, metrics, sections, forms, tables and charts at 1440/1100/620 pixels, preserving drafts/local filters and without model action dispatch. This is geometry/interaction evidence, not skill selection or authored-answer reliability.

Primary-provider mapped-table gate was run once before expanding workflow testing: one of three cases passed, two aborted at the fixed 60-second provider-generation boundary without canonical output. Retained receipt: `.vak/contracts/record-view-2026-10-27T09-27-46.683Z.json`. No repeated prompt/parser experiments, paid runs or reliability gate closures. Vakyartha owns its new instruction skills, audit and theme tokens.

## Pipeline audit — 2026-10-27

Governed dispatch now validates supported argument schemas before execution, preserves structured MCP error/denial status, rejects incomplete native generations and duplicate/reserved names, and invalidates old handles/chat grants when integration authority changes. MCP HTTP requests abort on cancellation/timeout/close; body/frame parsing is bounded at 8 MiB. Provider Retry-After consumes the finite retry allowance. Apps wrapping AgentTool.execute must preserve string or {text,isError} results (CHANGELOG Breaking entry).

Offline regressions exercise actual adapters/agent dispatch and loopback transports, with no paid or live model calls. Existing primary-provider/source/interaction/receipt failures remain open. Installed app adoption requires its own build; no process restart or installation is implied.

## Current architecture

Runtime schemaMode is removed: host/agent use typed descriptors with one prompt owner per active protocol. Trusted context loaders use counted answer steps, not external rounds. App must adopt the matching kind metadata and avoid charging local skills as external operations.


Generic transactional authoring and progressive rendering share one catalog, canonical surface/data store and projectors. Table/chart/stat field mappings resolve a single record collection. Inputs edit existing pointers. Permissions, caller checks, revision/stale-candidate checks, persistence and receipts retain their existing owners.

At the user's explicit request the source-specific derive/prepare/workspace pipeline is removed, including table source/parameter/relation options, compiled form/report layout, CSV bridge consumer, obsolete tests and its provider script. There is no compatibility shim or parallel replacement stack. submissionTool now takes an options object for dataSchema/surfaceCount. App callers must move their dependency pin and remove the old options.

Form submission now preserves repeated record-field names under canonical pointer keys instead of retaining only the last value. A fresh skill-led provider run exposed this general boundary; skill/request/checks remain unchanged for its mechanism rerun.

## Evidence and limits

393 framework tests/replay, typecheck and package build pass after dispatch hardening. The earlier cleanup removed nine tests of the deleted source execution APIs. Existing transactional security, stale edits, multiple surfaces and record mapping tests remain. Package build passes. Earlier 388-test result predates removal. Live/installed results belong to their recorded revisions; previous source-workspace success is historical and cannot certify this path. Earlier local mapped-table gate2/3 retains an unrequested-total failure. App EVALUATION.md owns current skill/provider and WebKit outcomes.

## Next work

Finish the app pin/caller cleanup, verify ordinary task input/continuation/export and shared views, run the user's authorized hosted model comparison with frozen checks, and document all failures. Keep local primary-provider failures open; do not tune a fixture or expand retry limits. No installation or release implied. AGENTS.md and RELEASING.md apply.

## Analytical workspace capability checkpoint — 2026-10-28

The market reference app exposed general geometry gaps: zero-baseline price trends concealed variation, long signed rankings lost category labels, and all surfaces shared loose spacing. The public catalog/projector now supports validated OHLC candlesticks, fitted/disclosed line/candle scales, horizontal signed bars with exact values, semantic plot heights/axis context and inherited compact density. Implemented in the framework owner, with no app-specific branches, dependency or source calculation.

403 framework tests/replay and typecheck pass at this checkpoint; WebKit/source-backed app evidence is recorded by Vakyartha after adopting the pin. No new primary-model outcome or reliability pass is implied. Existing provider/source/value/interaction failures remain open. No installed app or public release is produced by this commit.

## Edge model thinking and step policy — 2026-10-28

Investigation into edge model execution (LFM3 1.7B) identified that setting `think: false` by default forced models with native reasoning traces to emit their internal monologue into the user-facing text stream. Furthermore, the capability policy clamped models under 2B parameters to 2 steps, causing premature step-limit exits.

Changes made in Projection:
1. Removed the 2-step chokehold in `policy.ts`: models under 2B now receive the standard 4-step budget with core-tier worked examples.
2. `ollama.ts` automatically enables `think: true` for models reporting thinking support, routes thinking to `native`, and adds a streaming `ThinkFilter` to strip raw `<think>...</think>` tags from content. Non-thinking models safely fall back if Ollama returns 400.
3. 404 framework tests/replay and typecheck pass with zero errors. No installed app or public release is produced.

## Exact observation and OHLC integrity checkpoint — 2026-10-29

The analytical reference revealed that native SVG hover titles were insufficient for keyboard/touch inspection. Line/area/bar/candlestick figures now expose canonical exact observations through an output readout and pointer/touch/keyboard controls without agent dispatch. A final shorthand audit found null/boolean/blank nested OHLC prices could become zero; these now retain missingness for canonical rejection, with direct-projector rejection too. No source fact synthesis or new dependency. 405 tests/replay, typecheck and package builds pass. The narrow local mapped-table gate on preceding `fae8a41` passed 3/3 (receipt `.vak/contracts/record-view-2026-10-28T15-52-05.942Z.json`); this does not establish candle/graph model-authoring reliability. Vakyartha owns full live source/interaction/WebKit and installed-delivery evidence.

## Local collection navigation — 2026-10-29

Long web grids/lists now expose local 12-item pages and exact filtered count, with explicit pageSize/0 overrides. Tables reuse the same pager with their established 20-row default beyond 25. Filtering resets page; revisions retain local state and clamp after population changes. No model/tool action is dispatched and canonical records remain complete for other projections. Vakyartha owns real WebKit repeated-card/list and host-library checks. Existing model/source gates remain open.
