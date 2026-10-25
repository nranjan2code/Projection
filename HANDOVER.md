# HANDOVER.md: state of work (2026-10-25)

Start here in a new session. Rules: [AGENTS.md](AGENTS.md). System: [SPECS.md](SPECS.md).

## Handover prompt (paste into a new session)

> Continue vak Projection in /Users/nisheethranjan/Projects/vakProjection. Read AGENTS.md (rules: no third-party SDKs, no hard-coded fixes, never blame the small model, secrets only in .env), SPECS.md (architecture) and HANDOVER.md (status and next steps). Run `npm test` first (108 tests should pass). Only Telegram is available for live chat testing; local Ollama `qwen3.5:4b-mlx` is the primary model. Don't restart the Telegram bot while I'm testing. Pick up from "Next" in HANDOVER.md and ask if in doubt.

## Where things stand

- **Main:** `40246a2` (pushed). **Tests:** 108 passing, typecheck clean.
- **Baseline** (bench v2, 4B, `tools/core/examples/inline`, 1 run × 30 scenarios):

  | | Now | Old flat baseline |
  |---|---|---|
  | Fully passing | **73%** [56–86] | 47% [30–64] |
  | Check score | 89% [81–96] | — |
  | Follow-up turns (interaction) | 75% | 38% |
  | Median per scenario | 26s | — |

  Weakest categories: planning (40% fully passing) and dashboard (60%).
- **Running when this was written:**
  - The Telegram bot (`npm run telegram`), restarted on `40246a2`, so it has every fix below.
  - The playground (`.claude/launch.json` "playground"), started before `6caedf7`. Restart it before the next web test.
- **Working on right now:** live Telegram testing with "Compare three hotels in Kyoto and let me book one".
  - The last reply (07:10) replayed through the current engine shows 3 cards, each with its price once, its amenities and its own Book button.
  - Not yet seen live after the restart. **Ask the user to resend it and tap through booking.**

## Done in this stretch

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
- **Docs:** AGENTS.md, SPECS.md and this file.
- **Web tests passed** in the browser pane:
  - examples render; buttons send the item's data
  - form validation: required, email, choice, checkbox, correct submit data
  - a live hotel comparison (33s)
  - follow-up click → booking confirmation

## Next (in order)

1. **Confirm the live Telegram hotel flow** after the `40246a2` restart: the user resends the hotel request and taps a Book button. Expect one Book button per card and single "/night".
2. **Make long chats fast.** Each Telegram chat sends its whole saved history to the model on every turn, so even "hi" takes about a minute on the 4B model.
   - Make `/start` begin a fresh conversation: clear messages, surfaces and tokens for that chat.
   - Send only the recent turns plus the current surfaces' state to the model.

   This is a general mechanism in `runAgent` or the bot, not a per-chat hack.
3. **Finish the web tests** (interrupted by the usage limit):
   - live dashboard prompt (charts)
   - workout tabs prompt
   - tablet and phone viewports

   Check the header wrapping at narrow widths: at 800px, the playground's controls wrap into 3 rows.
4. **Model-design issue still open:** a form says "choose your hotel" but has no hotel field. Consider a lint warning, or rely on the action data already carrying the chosen item.
5. **Weak bench categories:** planning (tabs/sections, itinerary text) and dashboard (charts).
   - Analyze failures in `packages/bench/data/results/2026-10-25T01-01-37-105Z_run_*.jsonl` and fix root causes.
   - Prove it with replay plus a live gate run (`npm run bench -- gate ollama:qwen3.5:4b-mlx --runs 1`, ~25 min local).
   - Re-record the baseline after engine changes that move scores.
6. **Re-record the form slice baseline** on inline (`--category form --slice form --save`); it is still flat v2.
7. **Optional, ask first:**
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
