# Changelog

## Unreleased: private streaming transports

- `createFetchHandler` adapts the canonical host and app routes to Web Request/Response streams without opening a socket. It preserves admission checks, binary responses, streaming headers, producer backpressure, cancellation and close cleanup; slow-consumer buffering is bounded at 8 MiB.
- `VakClient` accepts an optional fetch-compatible transport. Existing HTTP callers retain their defaults.
- **Breaking:** route hooks and `readJson`/`json` now use the structural `HostRequest`/`HostResponse` contracts. Node HTTP requests/responses remain compatible; apps with explicit route annotations should import these public types.


## Unreleased: compact common-property authoring guidance

- Strict inline tool schemas keep every common property's type and validation while describing those shared fields once in the system prompt instead of repeating their prose in every component branch. The primary local core-tier tool definition measures 24,270 → 19,878 characters (4,392 fewer); this is a schema-size measurement, not an input-token or latency claim. The focused type/schema regression and 394 tests/replay pass. The required local record-view check aborted at initial shared values (`record-view-2026-10-27T14-22-47.420Z.json`); no model-outcome repair is claimed.

## Unreleased: positional mapped-table totals

- A requested total on a mapped positional table now resolves to a positional final row, preserving its transactional wire shape. A primary local record-view trial reached accepted canonical output for the previously rejected mixed-row case; the broader three-case gate still fails an unsolicited-total semantic check (two pass, one fail). This is a mechanism repair, not a completed outcome gate.

## Unreleased: responsive content measures

- Common `maxWidth: sm|md|lg|full` gives every component a responsive content measure; this is independent of grid span and never injects arbitrary styling. Web defaults are 320/720/1040 pixels or the available width, capped by the container.
- Explicit grid column counts retain unused tracks instead of stretching sparse panels; automatic grids retain their fluid behavior. Horizontal panels default to top alignment and explicit alignment now wins the row default.
- Charts default to a bounded readable width with an explicit full-width option, and release resize observers when replaced. These are projector/layout changes, not new calculation or filtering semantics.

## Unreleased: governed tool dispatch

- **Breaking:** `AgentTool.execute` can return `{text,isError}` as well as text. Wrappers must preserve that result; MCP failures and denials now carry explicit error status into agent messages/events and repeated-failure suppression.
- Validate native external arguments against the supported schema contract before approval/dispatch, refuse incomplete native generations and reject duplicate/reserved model-facing tool names instead of silently selecting a handler.
- Integration changes invalidate captured handles and chat grants. Recheck cancellation and authorization after approval, immediately before dispatch.
- MCP cancellation, timeout and close terminate pending HTTP work; remove settled listeners/timers and cap HTTP JSON/SSE bodies and stdio frames at 8 MiB before parsing. Cancelled calls never initiate a tool request. Server-side effects remain cooperative/uncertain after dispatch.
- HTTP Retry-After now consumes the finite retry allowance; cancelled waits cannot start another attempt.
- 393 offline dispatch/transport/retry tests and existing tests/replay, types and package build verify mechanisms. These changes do not certify live model reasoning or close existing user-outcome failures.

## Unreleased: provider routing regression

- Offline registry regression verifies OpenAI uses /responses with function_call/function_call_output replay and no Chat Completions fallback on a failed request. Compatible-server adapters retain their explicit Chat Completions routes.383 tests/replay and typecheck pass; routing behavior was already in use by the live hosted trials.

## Unreleased: one active typed protocol and bounded context loading

- **Breaking:** remove host/agent schemaMode and the obsolete transactional variant of the standalone progressive systemPrompt helper. Agent tool schemas are typed; transactional prompting has one owner. Core low-level descriptor formatting remains an implementation option for direct catalog callers, not a runtime reliability setting.
- Local instruction loaders can declare trusted AgentTool.kind=context. They stay available with zero external rounds and consume answer-step limits; external tools retain their budgets and dispatcher. This prevents skill selection from unlocking an answer without loading its body when external allowance is zero.
- Prompt cleanup removes context-erasing latest-message-only advice, permits related views on one surface and deletes dead transactional prompt assembly.382 tests/replay, types and package build pass. No model-output facts or outcome checks are relaxed.

## Unreleased: remove duplicate authoring schema

- Root and descendant trees now reference one node definition instead of repeating the entire catalog for roots. The same native transactional tool schema shrinks from about66k to34k characters. A supplied root ID remains checked as root/omitted before admission. No component, runtime relationship check, source value, permission or outcome requirement is removed.380 tests/replay, typecheck and package build pass.

## Unreleased: preserve repeated form fields

- Form controls with distinct bind paths but the same final field name now submit each value under its canonical absolute path. Unique short names retain their ordinary payload. Repeated controls of one path submit one canonical value. A fresh skill-led garden observation run exposed the previous last-value-only overwrite; the engine regression preserves all three edited values and restore. No prompt or domain-specific repair.380 tests/replay, typecheck and package build pass.

## Unreleased: remove source-specific execution

- **Breaking:** remove tableSources/tableParameters/tableRelations on host/agent, source table/workspace exports, derive/prepare tools and compiled form/report layouts. Apps pass selected inputs as ordinary untrusted context and author shared records/views through the existing transaction. submissionTool(catalog, surfaceIds?, options?) now takes {dataSchema?,surfaceCount?}; the removed positional source arguments have no shim.
- User explicitly authorized removal before replacement outcome parity. Nine obsolete API tests and the source-only provider script are removed;379 retained tests/replay, typecheck and package build pass. Independent source facts/calculation/continuation/receipt checks remain caller obligations. Historical successes are not current evidence.

## Unreleased: display value refresh

- WebKit shared-record regression found that DOM reconciliation excluded every `value`, leaving display stats stale after a field edit. Only nodes with an explicit value synchronizer now preserve DOM across value changes; other nodes refresh from their complete resolved props. Controls retain their focus-preserving synchronization. 388 tests/replay, types and package build pass; app wide/narrow WebKit verification follows.

## Unreleased: shared record views

- Tables, charts and stat aggregates select named fields from the same bound records. Form edits and canonical patches resolve every view from that collection. No new data store, renderer protocol, dependencies or executable expression strings. Closed caller contracts reject copied/empty view arrays when the declared collection requires field mapping. Multiple series, scatter coordinates and independent surfaces retain their existing execution paths.
- Offline regression covers the retained empty/copied-table output, local edits, form submission, restore, missing/nonfinite data, multiple series, patch isolation and requested totals. 388 tests/replay, types and package build pass.
- Retained local mapping checks: initial full-view trial0/3, initial table-only0/3; after reference enforcement table-only2/3 (`record-view-2026-10-27T07-08-41.264Z.json`). The remaining run repeatedly requests an unasked total. Final code preserves normal explicitly requested table totals; no further live rerun or full outcome success is claimed. Intent reliability and the original app outcome remain open.

## Unreleased: declared data-to-view relationships

- Closed caller data contracts constrain collection bindings to compatible declared paths. When such a collection exists, authoring references it instead of copying a second collection into view props. Open dictionaries and unions retain ordinary reference handling. Caller-specified `surfaceCount` constrains an initial submission and validates resulting state after targeted edits; it is independent of operation count.
- JSON Schema `const` and `enum` now compare JSON values structurally instead of by JavaScript identity. This fixes rejection of newly decoded immutable caller records. No source values are coerced or inferred.
- 382 tests/replay, typecheck and package build pass. The frozen data/table-binding gate passes3/3 in one request each with original caller records declared immutable (`data-binding-2026-10-27T05-07-10.446Z.json`). Earlier0/3 and2/3 probes remain retained; bindings/types alone did not preserve original record names. Immutable-source mode encodes only supplied records, never expected calculations. Full form/chart/calculator outcomes remain separate and open.

## Unreleased: caller-declared surface data contracts

- Transactional runs accept an optional trusted `dataSchema` through the public provider/host APIs. The same schema constrains replacement decoding and validates complete candidate state after replacements or patches, with no value coercion. Caller-local schema definitions are scoped away from component definitions. Other authoring modes reject this option rather than silently ignoring it.
- Retained numeric path/type regressions pass, along with 378 framework tests/replay and typecheck. Small primary-provider gate passes3/3 in one request each (`primary-provider-2026-10-27T04-52-45.159Z.json`), preserving the original value/display checks. This proves the bounded data contract, not complete interactive authoring or the original app calculator.

## Unreleased: caller-owned presentation guidance

- Presentation and layout choices follow the request and caller instructions instead of a mandatory rich-layout recipe. Display formatting is distinguished from stored numeric values. Table guidance now agrees with the existing positional-cell authoring schema; ingestion support is unchanged. No domain handler, parser repair or new public API.
- Validation: 373 tests/replay, typecheck and package build pass. The unchanged transactional primary-provider gate passes only 2/3 (`primary-provider-2026-10-27T04-47-06.771Z.json`); that path does not use the changed ordinary-chat prompt. Its numeric type failure remains open. This guidance correction is not a complete authoring or user-outcome repair.

## 2026-10-27: contract evidence retention

- Provider-contract checks retain a unique receipt for every execution as well as the latest view. Source parameter-form instructions apply only to source-backed workspaces; unrelated graph authoring retains its actual input protocol.

## 2026-10-27: source workspace ownership

- Cleanup removes only obsolete source-workspace slots, preserving unrelated media or outside-agent surfaces. Regression covers mixed ownership. 373 tests/replay and typecheck pass.

## 2026-10-27: compile a source workspace from references

- Prepared-source publication names reports and caller criteria rather than authoring a UI graph. The compiler creates distinct interactive report/form surfaces, source evidence and computed explanations. New source-backed tables keep their total footer fixed during local sorting. General graph authoring remains for other tasks.
- Trusted parameter relation declarations constrain aggregate direction; declared source summary labels constrain total-row identity. These carry caller intent, never precomputed answers or inferred facts.

## 2026-10-27: compile parameter forms and factual explanations

- Source-backed forms declare caller parameter references; the compiler creates bound controls, numeric types and defaults from authoritative/current values. Presentation no longer coordinates bind paths with copied data.
- Table preparation uses typed aggregate comparisons rather than model-authored summary arithmetic. The compiler displays totals, limits, differences/status and source/context evidence; prepared records remain immutable. One selected total supplies its comparison column automatically.

## 2026-10-27: source-backed table computation

- Trusted table sources preserve selected records independently of presentation. Bounded typed row calculations and aggregate/total preparation run before UI authoring in the existing counted loop. Presentation references prepared tables and computed summary bindings; it cannot copy, shift or replace their facts. Canonical user parameters win over stale unused data and model defaults cannot revise them. No new persistence owner, dependency, IPC or external authority.
- Per-tool schema definitions are scoped on the provider wire to avoid recursive-name collisions when preparation and submission are offered together.

## 2026-10-27: positional table authoring

- Model-authored table rows use positional scalar arrays, eliminating dynamic row-key/column-key coordination. Resolved bindings obey the same canonical contract before admission. Runtime table ingestion/projectors retain both supported canonical row representations; no facts are transformed. **Breaking:** transactional authored record rows must be sent as cell arrays in column order.

## 2026-10-27: canonical table row authoring

- Catalog declares scalar table cells for model authoring, rejecting nested props/children row wrappers before dispatch. The wire schema is derived from this canonical declaration; tolerant ingestion preserves raw source material instead of coercing malformed historical records into lossy cells. Exact failed full-report candidate is retained as a regression. No fact or value synthesis.

## 2026-10-27: local schema reference safety

- Local definition references must resolve own keys; inherited prototype names cannot resolve as schemas. Recursive references are depth bounded and conflicting tool definitions fail closed. 361 tests/replay and typecheck pass.

## 2026-10-27: enforce the submission contract at decoding

- Transactional calls use the actual offered tool schema through advertised provider schema decoding. Recursive local definitions type all inline descendants; state-aware operations do not offer nonexistent patch/remove targets. New surface IDs are generated; replacement data and required component props are required by the request schema. Native calls remain for providers without constrained output. Strict complete validation, existing execution/approvals/accounting and atomic admission remain. Submission instructions describe only the active protocol rather than imposing unrelated layout recipes.
- Added a real primary-provider contract gate and AGENTS outcome acceptance requirements. Tests/builds/rejection are mechanism evidence, never a substitute for original task correctness.

## 2026-10-27: transactional multi-surface authoring

- Trusted `surfaceSubmission` mode offers one `vak_submit` change set with inline replacements, canonical-ID patches and explicit removal. Bounded recursive compilation generates IDs and preserves inline collection templates. Candidate structure and completion checks run before a synchronous canonical commit; rejected, stale, incomplete and mixed external-operation batches publish nothing. Accepted submissions finish without an extra generation. Ordinary progressive chat remains unchanged.
- **Breaking:** removed the unused experimental `toolEncoding` option and schema-call envelope. Apps use the trusted `HostRunOptions.surfaceSubmission` instead; HTTP/model arguments cannot enable it. Native decoding plus strict JSON parsing and recursive catalog validation are used; no recursive grammar guarantee is claimed.

## 2026-10-27: stop unchanged completion repairs

- A failed completion gets one repair opportunity. If the canonical surface content, original response and check issues are unchanged at the next completion attempt, stop with `validation_stalled`; revision-only churn does not count as progress. Preserve partial outputs and withhold rejected prose. Existing request/time bounds still apply.

## 2026-10-26: referenced pointer keys in surface data

- A root data key containing a full JSON pointer is expanded to its nested path only when that exact path is explicitly referenced by a control or whole-value binding and the nested target is missing. This follows retained local output with `data["/criteria/budget"]` rather than nested data. Values move unchanged; explicit nested values, conflicting pointer prefixes, unsafe paths and unrelated literal/source keys stay untouched. Tests cover display/submission, patches, conflicts and prototype safety.

## 2026-10-26: schema-constrained tool batches

- Opt-in `toolEncoding: constrained|auto|native` on the agent/host decodes a typed `{reply,calls}` batch through providers advertising constrained output, then uses the existing tool dispatcher. This closes the gap where strict native tool schemas were only guidance and local corrections kept serializing malformed nested trees. Surface calls use flat, component-typed nodes and child IDs; multiple independent surfaces and integration calls remain possible.
- A complete batch is parsed and validated before any call is emitted. Truncation, invalid/unknown calls and size overflow dispatch nothing; retries, request accounting, tool budgets, cancellation and approvals remain in the existing bounded run. At most one call per decoded batch (independent surfaces accumulate through the same bounded loop), 512 KB decoded text and a default 6,000 output-token bound. Native encoding remains the default; auto opts into grammar support when advertised and otherwise retains native calls. No extra agent loop, dependency, IPC, permission or semantic-acceptance claim.

## 2026-10-26: explicit correction deletion

- Correction guidance names the existing node-removal and data JSON Patch removal operations. Omitting a value from merged data preserves it; a recorded review correction omitted an unwanted date and therefore left it intact. No deletion is inferred or silently applied.

## 2026-10-26: unknown input defaults

- Authoring instructions distinguish supplied initial values from missing facts: unknown inputs stay blank and unrequested populated fields must not be invented. A local report passed arithmetic and layout checks but invented a project deadline in an extra field; this prevention rule preserves blank/user-entered controls without synthesizing data.

## 2026-10-26: correction scope and bounded structural feedback

- Input submission lint follows the same resolved form/action scope as a click. An unrelated or empty sibling form no longer hides stranded inputs; errors name the existing IDs to patch. This also prevents a scope-breaking correction from replacing a usable published form. Exact local file-report edits are retained as regression fixtures; no facts or surfaces are synthesized.
- Inline child schemas require node identity, and update schemas describe child IDs for small edge corrections. Runtime ingestion still accepts valid nested calls. Caller edit failures include a bounded inventory of current parent edges and bindings to support patches without a full rewrite. No new dependency or public signature change.
- Table guidance distinguishes automatic column sums (which replace the last total row) from caller-specified custom summary rows, which keep totals disabled.
- Replay correction: one historical job-application clean-render score drops from 1.0 to 0.8 because two fields are outside its form and are omitted on submit. The defect and explicit baseline reason are retained; other recordings retain their gates.

## 2026-10-26: dual-stack public fetch lookup

- `pinnedFetch` returns the checked DNS result using the callback shape requested by Node: an address list for dual-stack lookup, a single address/family otherwise. This fixes real public image fetches failing with `Invalid IP address: undefined` on Node 24 without a second DNS lookup or weakened private-address checks. Regression checks exercise both callback shapes offline.

## 2026-10-26: negotiated MCP HTTP lifecycle

- The MCP client uses the server-negotiated supported protocol version on initialized and subsequent HTTP requests; reconnect clears the prior session/version. This fixes a real hosted connection returning HTTP 400 after a successful older-version handshake. Redirects fail closed so custom credential headers cannot be forwarded elsewhere. Regression checks cover negotiation, session reset and redirect refusal.

## 2026-10-26: unreviewed integration consent

- Integrations marked custom default every tool to Ask, including newly discovered read-only tools. Server-controlled annotations cannot grant consent; explicit saved Allow/Off policies remain effective across restarts. Views report the same default used for execution. No dependency or public API addition.

## 2026-10-26: configurable remote integration endpoints

- HTTP catalog sources accept a URL resolver over detached non-secret configuration, alongside existing fixed URLs. Resolvers validate configuration before it is saved or a working connection is stopped, and resolve again when connecting. Functions are never serialized into integration views; saved user-added servers keep their fixed URLs. This supports workspace-specific servers without another runtime, adapter or dependency.
- Regression coverage verifies bearer headers, endpoint changes/reconnection, invalid-edit preservation, restart and missing setup. All 324 tests and typecheck pass. Additive public API.

## 2026-10-26: media projection and local playback

- A dedicated `media` component renders images, audio and video with captions and optional transcripts. Audio/video controls are local, keyboard accessible and discoverable through the existing voice agenda; `activate` never sends playback to a model or tool. Text/channel lowering preserves descriptions and transcripts without exposing private asset URIs.
- Web projectors accept an optional `mediaResolver` for authenticated app resources. Temporary URLs are released when a result changes or leaves the document; moving a live surface into a canvas preserves the player. Playback never starts automatically.
- The host exposes `project` for trusted callers to publish through the canonical store, persistence and viewer events without a model. Application ownership is checked; trusted publication rejects busy sessions so an app can defer it. The HTTP projection path retains its external-action behavior.
- Integrations expose detached, non-secret `configuration(id)` snapshots for authority checks without key-store probes or server connections. This keeps bounded background status checks on the canonical configuration without repeatedly invoking native credential reads.

No runtime dependency or existing package-export removal. Core/host tests pass; visual verification is recorded with the consuming app.

What changed, newest first. Nothing is released yet: every package is `0.1.0` and unpublished. Apps pin this repository by commit or tag; a change that breaks a package export is marked **Breaking** (see [RELEASING.md](RELEASING.md)). Details of each step are in [HANDOVER.md](HANDOVER.md); the architecture is in [SPECS.md](SPECS.md).


## 2026-10-26: review pass — saved chats, session files, streaming and SSRF

**Breaking:** `runAgent` (`@vak/providers`) now rejects when the caller's own options are wrong — an unknown completion policy, `completion: "response"` without tool generation, a completion check without response completion. It used to resolve `{ stop: "error" }`, which looked like a model failure and invited a retry that could never succeed; a caller now gets the mistake and its stack. Apps that tested for that result must catch the rejection. `host.run` still ends the turn as an `error` event and records it.

- **A saved chat keeps no tool output.** SECURITY.md promised it and host did not: `role: "tool"` messages were written to `.vak/sessions/*.json` verbatim. They are now saved as `[tool output not saved]`, keeping the call id so a reloaded history is still a valid tool_call/tool_result pair. The live session and the diagnostic transcript keep the real output.
- **Session files cannot collide.** An id with `/` or other unsafe characters was saved under the sanitized name, so `x/y` and `x_y` shared one file: opening one showed the other's messages and deleting one deleted both. Such ids now get a short hash suffix (`x_y-<12 hex>.json`); safe ids keep their name, and a chat saved under the old name is adopted (moved) only when the file's own `id` says it is that chat, so the other id's file is never stolen or deleted.
- **Streaming is no longer quadratic.** A 400-node, 36 KB render took 7.3 s at 8-character deltas because each delta reparsed and rebuilt the whole surface. Parsing and applying are now batched (a fraction of the document, a quarter more nodes, a text chunk scaled by node count); the same render takes 44 ms, while a single long text node still updates as it streams.
- **SSRF covers IPv6 translation and DNS rebinding.** `isPublicAddress` now reads the IPv4 an IPv6 address carries — NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`), 6to4 (`2002::/16`), IPv4-compatible (`::a.b.c.d`), mapped (`::ffff:a.b.c.d`), Teredo — and `pinnedFetch` dials the address the check just resolved, so a second DNS answer cannot point at loopback. The web-fetch tool and Telegram's media check use it.
- **One broken integration no longer fails the turn.** A server whose installed folder vanished (moved, cleaned by a sync tool) threw while the tool list was built, so no reply could be produced. `toolsFor` now records the error for the settings screen and keeps the healthy servers' tools.
- **A turn never ends silently.** A failure before the model was asked (a throwing app callback, an unusable provider) now emits `error` and `run_end`, so a client that waits for the end of the run is not left hanging.
- **Locale numbers are read as written.** "1.234,56" is 1234.56 and "12,50" is 12.5, not 1.23456 and 1250, in "cheapest"/"most expensive" comparisons and number form fields; "1,234" is still a thousand. A comparison now looks at the deciding value on any option, not only the keys the first option happened to carry.
- **First tests for `@vak/web`**: markdown escaping and safe links, chart and graph normalization, MathML output, run against a minimal DOM stub in node.

## 2026-10-26: per-item actions name their item; answers in seven languages

- `store.submit`: a button repeated per item whose payload names no item (`name`, `id`, `title`, `option`, `item`) now sends `item` with its card's heading, so the model knows which card was chosen. Payloads that name the item are unchanged.
- `resolveAnswer` understands agreement, refusal, cancel, repeat, back, ordinals and price/best comparisons in French, German, Spanish, Italian, Portuguese and Dutch as well as English; negation still wins over agreement. New export `AGREEMENT_WORDS`. Number words and dates are still English.

## 2026-10-26: activate a control by key

- `<vak-surface>` gains `activate(key)` (additive): the same submit, validation, busy state and `vak-action` event as a click, for targets that answer without a pointer. Pair it with `agenda` option `source` keys.

## 2026-10-26: answers in words

- New `@vak/core` exports (additive): `agenda` lists what a surface waits for (decisions with their options and distinguishing values, forms with their fields); `resolveAnswer` reads a spoken or typed answer deterministically (yes/no/cancel/repeat/back, option names, ordinals, comparisons such as "the cheapest", number words, relative dates, spoken email); `answerSchema`/`readModelAnswer` bound what a model may fill for an unresolved answer; `fillAnswer` and `actOn` write values and submit through `SurfaceStore`, so an answer and a click produce identical actions; `question`/`readBack` give the spoken text. App-supplied approvals resolve only to an unmixed consent that names the change, never from a model. English words first.

## 2026-10-26: scoped session cleanup

- Trusted session removal also removes its abandoned atomic-write temporary file. The canonical session and diagnostic transcript are still removed without touching other sessions. The existing scoped deletion regression now covers temporary content too; 287 tests/replay gate and typecheck pass.

## 2026-10-26: serialized list members

- Schema-declared array props recover valid sibling settings written after a list inside its JSON string. The existing parser reads the owning object; only declared, type-valid siblings are accepted, and explicit settings win. Literal source and ordinary scalar row data are unchanged. This prevents a trailing table setting from becoming an extra displayed row.
- Exact retained local research update plus scope/collision/literal guards pass. 287 framework tests/replay gate and typecheck pass; no dependency or scenario-specific fact repair.

## 2026-10-26: caller constraints during surface correction

- Optional public `validateEdits` on `runAgent` and host execution checks canonical surface snapshots after each surface-edit batch. Bounded issue feedback accompanies component diagnostics before the next generation, preserving the same budgets and final completion validation. The callback cannot accept work or change external authority; malformed decisions fail closed. Existing clients are unchanged.
- Raw local research edits reproduced a correction that added a second form to an evidence surface while trying to satisfy component input lint. A replay regression verifies that caller constraints reach the next correction alongside those diagnostics. 285 tests/replay gate and typecheck pass; no dependencies or renderer changes.

## 2026-10-26: cyclic layout edges

- A recorded inline layout referred back to its root from a descendant wrapper. Structural repair now removes only ancestor child/template edges, preserving valid nodes, table data and list instances. The resolver retains its recursion guard and lint reports any remaining resolved cycle for correction. No renderer or public API changes.
- Verbatim render/update replay and self/shared-node regressions pass: 283 framework tests including the replay gate, plus typecheck. No new dependency.

## 2026-10-26: token-based primitive member recovery

- A key with a missing closing quote before a complete JSON primitive (`"flag:false}`) is recovered using explicit identifier/colon/delimiter scanning and standard `JSON.parse` validation of the primitive token. Recovery waits for finalized input and structural continuation. Properly quoted keys win; partial tokens, strings, containers, nonfinite numbers and non-JSON literal spellings are not inferred. A real comparison otherwise silently lost its first row and merged values from the second.
- Verbatim render/update fixtures and streamed replay preserve both rows and their supplied booleans/numbers. Incorrect factual claims stay incorrect for application checks; no scenario-specific value repair, new dependency or public schema/version adapter.
- 281 tests/replay gate and typecheck pass. Work is isolated from concurrent web theme/card styling; no renderer/style changes are included.

## 2026-10-26: minimal web defaults and inherited themes

- Web defaults use lighter typography, neutral actions and chart series, smaller corners, quiet borders and no card shadows. Cards keep their natural height and card/comparison actions fit their labels; default grids fit three 220px items before wrapping. Controls retain visible focus and larger touch targets.
- Public `--vak-*` tokens now inherit correctly from app wrappers in both appearances. Added typography, spacing, card-padding, control-height and default-grid-minimum tokens; component text uses the surface’s type scale. Existing public token names and package exports remain available. See README for the white-label contract.
- Playground `/styles` provides fixed examples covering the catalog, with light/dark, brand and density controls and local action receipts. No model calls.

## 2026-10-26: conversation and short answers stay plain text

- The system prompt now says when to answer without a tool, not only when to prefer UI: greetings, thanks, small talk, questions about the assistant, a fact, definition or short explanation, or a request for text. Earlier surfaces in the conversation are no reason to render again. `CONSTRAINED_INSTRUCTIONS` makes `render: null` the answer for conversation and short plain answers, and the kit's default instructions match. Seen in Vakyartha with qwen3.5:4b-mlx, which rendered a greeting surface for "hello" and ignored "Plain text only" after earlier surfaces.
- `titleRepeated(title, root)` (`@vak/core`): whether a surface's opening content (first card/section title or text) already says its title. `<vak-surface>` leaves such a title out, so "Hello!" no longer sits above "Hello! How can I help?" and a heading no longer repeats the title above it. A title that adds something ("Weather in Paris" over a "Weather" card) stays.

## 2026-10-26: integration rounds get their own budget and a closing answer

- Rounds that run integration tools draw on `toolRounds` (`RunOptions`, `HostRunOptions`; default `TOOL_ROUNDS` = 6, a host policy), no longer on `maxSteps`, which now bounds answer, authoring and repair rounds. A small model doing research could spend every step gathering and end the turn with no reply.
- When `toolRounds` runs out, one closing round withholds the integration tools (interface tools stay) and asks for an answer from the gathered results.
- `run_end` and the run result carry `limit` (`"steps"` or `"tools"`): the budget that ended the run or forced its closing round. The host records `stop` and `limit` on the timeline entry and accepts `continue: true` to carry on a turn without a new user message.
- Integration results the model sees are clipped to `toolResultChars` (the plan sets an eighth of the context window); `tool_end` keeps them whole. An identical call that already failed in the turn is not run again.
- **Behaviour change:** tool-heavy runs can make up to `maxSteps + toolRounds` model requests; hosts with a total request cap set `toolRounds` below it. 274 tests pass.

## 2026-10-26: chat turns keep running in the background

- A `/api/chat` turn no longer stops when the window that started it disconnects (the user opened another chat, the window closed). Its events go to the chat's viewers (`/api/events`) instead; if it ends unseen, viewers still get a `run_end`. Several chats can run at once, one turn per chat, as scheduled tasks already could.
- Stopping is explicit: `POST /api/sessions/:id/stop` (`{stopped}`).
- `SessionSummary.running` and `SessionView.running` say a turn is in progress, and `SessionView.pending` carries its reply so far (`{text, surfaces}`), so a reopened chat shows the work at once and follows the rest live.
- **Behaviour change:** clients that relied on closing the stream to cancel must call the stop endpoint. 269 tests pass.

## 2026-10-26: pick buttons on comparisons

- `compare` takes `action` (and `actionLabel`, `payload`): each option gets its own button that sends the action with `{option: <name>}`. "Compare hotels and let me book one" can now answer with a comparison instead of cards.
- General engine capability: a `role: "action"` component may declare `choices: "<list prop>"`; control `<node key>#<index>` submits the node's action for that item. Lowering turns each choice into an ordinary button with that key, so the web, Telegram, Discord, Slack and text all submit through `SurfaceStore.submit` with no per-channel code.
- Bench: comparison checks accept a `compare` alongside cards or a table, and a compare with an action counts as something the user can act on. 267 tests/replay gate and typecheck pass; checked in WebKit.

## 2026-10-26: everyday components on the local 4B

- Bench slice `everyday`: 10 scenarios, one per new component group, phrased as people ask. Default 4B plan (core tier), 2 runs each: first run 50% complete / 86% of checks; after the fixes below, 75–85% complete / 95–97% across three recorded runs (saved baseline: 75% / 95%). Calendar, accordion, timer, tree and gantt were already reliable; board, progress, inputs, stacked charts and compare were the gaps.
- A request names a component in more of the ways people write it: plurals ("progress bars"), determiners ("two timers"), a leading imperative ("Show progress bars"), or a several-word name opening the request ("Stacked bar chart of…"). Not a lone opening word, which is often a verb ("Compare these hotels" keeps its cards and booking buttons), and not after "my" ("my to-do list" is the user's data, not a format). An explicit "the steps component" outranks looser mentions.
- The requested-components contract includes components named by an alias that sets props, with those props: "a slider" is `input` with `kind: "range"`, "a stacked bar chart" is `chart` with `kind: "stacked"` (`namedPresets`). A longer matching name wins across components ("a star rating" is the input, not the display).
- A component whose `bind` is optional keeps state there (a board's moves) and no longer triggers "nothing submits them". Recorded 4B shapes read generally: a card split into `{title}` and `{column}` rejoins; a bound bar-kind progress is a slider; an option whose note calls it the best pick is marked best when none is.
- Chart hint names its kinds. Existing scenarios whose prompts changed were run live before and after (16 scenarios × 2): the comparison regressions this exposed are fixed; the rest are within run-to-run noise. The full live gate needs a bench v3 re-record of the main baseline (it is v2). 266 tests/replay gate and typecheck pass.

## 2026-10-26: everyday components

- New extended-tier components, each drawn natively on the web and lowered for chat and text targets (`LOWERED`): `calendar` (month, week, day and agenda views; arrow-key day grid), `board` (columns of cards moved by pointer drag, touch included, or by keyboard; with `bind` the moves write the cards to the data model), `progress` (bar, gauge, ring or star rating; over-limit reads as danger), `accordion` (items or child sections; native disclosure), `compare` (options side by side, the best highlighted, a specs table), `timer` (timer, stopwatch with laps, countdown to a date-time; wall-clock based), `tree` (nested records, path strings or indented outlines; WAI tree keys), `math` (TeX drawn as MathML, no fonts or libraries), `diff` (before/after or a unified diff; unified or split, word-level marks, folded context) and `gantt` (date-scaled bars; zoom by buttons, keys, ctrl-wheel or pinch; pan by drag).
- `input` kinds `time`, `range` (slider), `rating` (stars) and `file` (name, type, size, and the text of small text files; files stay on the device), with `min`, `max`, `step`, `unit`, `accept`, `multiple`. Chat forms read typed times, bounded numbers and "4 stars".
- `chart` kinds `stacked`, `scatter` (points as `[x, y]` or `{x, y}`; series gain `x`), `heatmap` (a habit calendar for dated values, else a matrix) and `radar`. `chartText` lists scatter points.
- Aliases moved where a name now has its own component: `calendar` (was a date-picker alias) and `progress` (was a steps alias) retype back when the props say so (a bind; stage items). An alias's presets survive a semantic retype, so a bound `rating` is a rating input.
- Checked in Chromium and in off-screen WebKit, desktop and phone widths. 264 tests/replay gate and typecheck pass. No dependencies added.

## 2026-10-26: trusted completion acknowledgement

- `CompletionCheck` can additionally return `{issues, response?}`. Existing issue arrays remain valid. After successful substantive checks, a trusted application may replace the emitted final prose with a neutral acknowledgement, retaining raw provider prose in conversation/transcript data for diagnosis. Rejected or malformed decisions emit no final text.
- This avoids retrying valid output solely to change a final sentence, a real local comparison failure that consumed budget and led to destructive rewrites. Replacement text cannot bypass issues, grant permission or accept a product task. No extra provider request is made for the acknowledgement. 257 tests/replay gate and typecheck pass in an isolated checkout.

## 2026-10-26: preserve authoring structure and correction data

- Real local 4B property fragments such as `"props": {...}, {"placeholder":"..."}}` stay on their node when the extra closer and disjoint keys establish a keyless member group. Normal sibling/anonymous nodes and colliding keys keep their prior readings. This removes unintended inferred inputs without guessing missing data.
- A stringified explicit list binding such as `"[{/data/options}]"` is normalized before JSON coercion, only for schema-declared array/binding props. It retains the pointer and follows later data changes; literal source and row-cell arrays stay unchanged. Missing/scalar targets are diagnosed. Bound container mismatches no longer pass because of lint-only coercion; harmless scalar formatting inside real lists remains supported.
- Authoring guidance initializes supplied controls at exact data bind paths, preserves numbers/units and requested labels, uses separate calls/IDs for separate outputs and patches existing surfaces for corrections. Completion feedback includes a bounded ID/root-type inventory. Render remains a complete replacement; explicit empty arrays and omitted replacement data are not silently restored.
- 255 tests/replay gate and typecheck pass, including verbatim retained calls, streamed convergence, update/replacement semantics and a same-run correction preserving initialized data. No dependency or public signature changes. Real outcome reliability is evaluated separately by the consuming app.

## 2026-10-26: bounded recovery from rejected tool syntax

- Ollama's HTTP 500 generated-tool XML syntax rejection becomes a public `ToolGenerationError`. The tool runner retries only before receiving text or a tool call; partial streams, cancellation and unrelated HTTP failures still stop normally. Each retry starts a new provider invocation through existing admission/accounting wrappers and consumes the existing step/time/request limits. There is no adapter-level retry or replay of prior calls.
- Recovery feedback preserves prior tool receipts and asks for one well-formed call at a time. Failed generations have unknown token usage when the provider supplies none; request admission still counts them. This does not fix combined outputs, missing values or semantic correctness.
- 248 tests (including the replay gate) and typecheck pass. Five new tests replay the exact local comparison error and cover classification, bounded retries, preserved receipts, partial-stream refusal, cancellation and ordinary failures.

## 2026-10-26: application completion checks and MCP result observation

- Opt-in response runs accept a trusted `validateCompletion` callback over read-only snapshots/resolved output and final response. Failed checks feed bounded repair messages into the same run; rejected prose is retained privately for diagnosis, not published as a final answer. Existing step limits/cancellation still apply; default clients are unchanged.
- MCP adapters expose an optional in-process result observer after permission and transport completion, with actual error status. This supports application-owned evidence checks without parsing presentation wrappers or duplicating MCP clients. Denied calls produce no observed evidence. No observer can grant permission.
- 243 tests and typecheck pass, including withheld invalid claims, bounded rejection and permission/error observation.

## 2026-10-26: wrapped list references

- A singleton list such as `rows: ["data/evidence"]` becomes a whole-list binding only when the prop schema declares both a list and a binding and the existing absolute data target is an array. Real local-agent research otherwise rendered a path instead of evidence rows without diagnostics. Keep a reference so later data updates still work; do not copy data into props.
- Missing targets, scalar targets, ordinary file paths, explicit row-cell arrays and relative bindings stay untouched. The repair is schema-driven for all projectors. 240 tests (replay gate included) and typecheck pass.

## 2026-10-26: response-oriented run completion

- `runAgent` and public `host.run` accept `completion: "response"`: tool runs can publish progress surfaces, perform further tool work and publish additional results before ending on a response without tool calls. Defaults still stop on a clean projection. Step limits, errors, cancellation and publication remain unchanged. The host selects tool generation for this mode; direct constrained-only response protocols reject it explicitly.
- Added general completion guidance distinguishing surface IDs from nested nodes, and tests for interleaved publication/tools, step exhaustion, constrained-mode rejection and public-host propagation. 238 tests and typecheck pass. No new dependency or app-specific task policy.

## 2026-10-26: MCP event streams with CRLF line endings

- `McpClient` over HTTP now reads a `text/event-stream` reply whose lines end in CRLF or CR, as the SSE format allows, including a line ending split across chunks. Before, it only split events on LF, so a server such as Tavily's remote MCP server (`mcp.tavily.com`) never had its reply read and the request hung until its timeout.


## 2026-10-26: graph component

- New extended-tier `graph` component: nodes `[{id, label, group, note}]` and edges `[{from, to, label}]`, for knowledge graphs, org charts, dependencies and flows. It accepts the memory server's own shape (`entities`/`relations`, `entityType`, `relationType`, `observations`), edges written as text (`"A -> B: label"`), and edge ends named by id or label; an end naming no node becomes one. A lone node is valid.
- `@vak/web` draws it as dependency-free SVG with a full interactive view: drag to pan, pinch (touch, trackpad, WebKit gesture events) or Ctrl/⌘-scroll to zoom, zoom and fit buttons, keyboard control, draggable nodes, selection that shows a node's note and dims what it does not touch, and search from 12 nodes. Directed acyclic graphs are layered and turn top-down or left-to-right to fit the frame; other graphs get a deterministic force layout. New export `renderGraph`/`normalizeGraph`.
- Chat, email, markdown, ANSI and text targets get a graph lowered to one line per connection plus its unconnected nodes.
- "graph" is no longer a `chart` alias; a `graph` node with `series` is still retyped to a chart, so recorded output is unchanged.
- A core-tier run (small models) still offers an extended component the user names, by its name or an alias written as one word or several ("a graph", "an org chart", "the timeline component"), and any component already shown so follow-ups can update it. New `namedComponents(catalog, request, {aliases})`; `withTier` takes an optional `keep` list. A longer name wins: "an org chart" names graph, not chart. The 4B model previously never saw graph, timeline, steps, map, code or gallery unless calibrated to the extended tier.
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

## Unreleased: analytical surface geometry and OHLC

- `chart.kind: candlestick` renders actual open/high/low/close intervals using four equal-length series in that order; record mappings can name the four fields. Canonical validation rejects impossible OHLC intervals and mismatched labels/lengths. Rising/falling bodies use semantic theme colours, with exact values in SVG titles and accessible labels.
- Line and candlestick axes fit observed values by default and disclose when zero can be excluded; `yScale: zero` explicitly retains it. Bars, stacked bars and area keep their zero reference. Flat/signed datasets retain finite ranges. This is a visual-scale change: clients needing the old line baseline should set `yScale: zero`.
- `chart.orientation: horizontal` for bars keeps every long category in a readable row with exact values; `colorBy: sign` uses semantic positive/negative colours without removing signed numbers. `height: sm|md|lg` provides semantic 180/260/360px plot heights, with horizontal rankings expanding for readable rows. Chart `title`, `xLabel` and `yLabel` are visible/accessible context.
- Common `density: compact|comfortable` controls inherited spacing and padding without shrinking the user's text or removing labels. Existing surfaces retain their density unless they opt in. No external dependencies, data calculations, web grants or app-specific renderer are added.
