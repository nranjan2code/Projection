# Projection handover — 2026-10-27

## Private transport boundary — 2026-10-27

`createFetchHandler` exposes the existing admitted host/app request path as streaming Web Request/Response without a listener. The transport-neutral structural request/response types also accept the existing Node HTTP adapter. `VakClient` has optional fetch injection. App-specific process pipes, native IPC, pricing and product routes remain outside Projection. 397 framework tests/replay, typecheck and package generation pass. Three adapter regressions cover JSON/admission inputs, binary streaming, early headers, cancellation and failures without a network listener. This changes transport only; existing model/source/interaction/receipt failures remain open.


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
