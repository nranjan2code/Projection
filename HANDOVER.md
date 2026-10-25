# HANDOVER.md: state of work (2026-10-25)

Start here in a new session. Rules: [AGENTS.md](AGENTS.md). System: [SPECS.md](SPECS.md).

## Handover prompt (paste into a new session)

```
Continue vak Projection in /Users/nisheethranjan/Projects/vakProjection.

First read AGENTS.md (rules), SPECS.md (architecture) and HANDOVER.md (status and next steps). Then run `npm test`; 142 tests should pass, and `npm run typecheck` should be clean. Nothing is running. Start the playground (.claude/launch.json "playground") when you need it, and tell me when you do.

Focus: the core system. That means the engine (parser, normalizer, lint, resolve), the catalog, and the projectors (web, text, Telegram, Slack, Discord as renderers, tested offline), and the bench. Telegram live testing is parked: don't start the bot unless I ask.

Rules that matter most:
- No third-party SDKs: everything is built on Node 24 built-ins and fetch.
- No shortcuts or hard-coded fixes: every repair is a catalog declaration or a general engine rule, with a test built from the real model output.
- Never blame the small model: local Ollama `qwen3.5:4b-mlx` is the primary target. Local bench runs are free; ask before any paid model run (OpenAI).
- Secrets live only in .env. Never print them, and run the secret scan on the staged diff before every push. The repo is public: github.com/nranjan2code/Projection. Git identity: Nisheeth Ranjan <nisheethranjan@icloud.com>.
- To diagnose bad output, read the raw tool calls (bench results, .vak/playground/<session>.jsonl, .vak/telegram/<chat>.jsonl), replay them through SurfaceStore.apply, and fix the general cause.

Pick up from "Next" in HANDOVER.md, in order, and ask me if in doubt.
```

## Where things stand

- **Tests:** 142 passing, typecheck clean. All work below is committed and pushed (see `git log`).
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
- **The playground may be running** (started from the session; stop it if not needed). The Telegram bot is stopped. One button press (Save Details on the booking confirmation) is saved in the chat's inbox and replays the next time the bot starts. The old long chat is archived in `.vak/telegram/archive/`.

## Done in this stretch

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

1. **Parked until the user asks: Telegram live.**
   - Start the bot; the saved Save Details press replays.
   - Check the booking confirmation flow end to end and "/night" with prices.
   - The transcript doesn't record the user message that started a turn, only what follows it; consider recording it for diagnosis.
2. **Optional, ask first:**
   - prompt caching
   - near-miss id pairing
   - a security review of the projectors
   - packaging for npm
   - live Slack/Discord bots, only if the user gets tokens

## Useful paths

- Telegram transcripts: `.vak/telegram/<chat>.jsonl`; state: `.vak/telegram/<chat>.state.json`
- Playground transcripts: `.vak/playground/<session>.jsonl`
- Calibration and profile cache: `.vak/models.json`
- Bench results: `packages/bench/data/results/` (gitignored); baselines and cassettes: `packages/bench/data/{baselines,cassettes}/`
