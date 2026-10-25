# HANDOVER.md: state of work (2026-10-25)

Start here in a new session. Rules: [AGENTS.md](AGENTS.md). System: [SPECS.md](SPECS.md).

## Handover prompt (paste into a new session)

> Continue vak Projection in /Users/nisheethranjan/Projects/vakProjection. Read AGENTS.md (rules: no third-party SDKs, no hard-coded fixes, never blame the small model, secrets only in .env), SPECS.md (architecture) and HANDOVER.md (status and next steps). Run `npm test` first (106 tests should pass). Only Telegram is available for live chat testing; local Ollama `qwen3.5:4b-mlx` is the primary model. Don't restart the Telegram bot while I'm testing. Pick up from "Next" in HANDOVER.md and ask if in doubt.

## Where things stand

- **Main:** `6caedf7` (pushed). **Tests:** 106 passing, typecheck clean.
- **Baseline** (bench v2, 4B, `tools/core/examples/inline`, 1 run × 30 scenarios):

  | | Now | Old flat baseline |
  |---|---|---|
  | Fully passing | **73%** [56–86] | 47% [30–64] |
  | Check score | 89% [81–96] | — |
  | Follow-up turns (interaction) | 75% | 38% |
  | Median per scenario | 26s | — |

  Weakest categories: planning (40% fully passing) and dashboard (60%).
- **Running when this was written:**
  - The Telegram bot (`npm run telegram`, logging to the session scratchpad).
  - The playground (`.claude/launch.json` "playground").

  The bot was started before `6caedf7`, so it lacks the top-level `{name}` binding fix. **Restart it once, when the user is idle.**

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
- **Web tests passed** in the browser pane:
  - examples render; buttons send the item's data
  - form validation: required, email, choice, checkbox, correct submit data
  - a live hotel comparison (33s)
  - follow-up click → booking confirmation

## Next (in order)

1. **Finish the web tests** (interrupted by the usage limit):
   - live dashboard prompt (charts)
   - workout tabs prompt
   - tablet and phone viewports (`Tablet`/`Phone` buttons in the playground, or the browser pane's resize)

   Check the header wrapping at narrow widths: at 800px, the provider/model/viewport/New chat controls wrap into 3 rows.
2. **Restart the Telegram bot once when idle** (picks up `6caedf7`). Retest "Compare three hotels in Kyoto and let me book one" and tap through booking.
3. **Model-design issues worth general fixes** (seen live, not fixed):
   - Book buttons placed inside a card template repeat per card. Lint could warn when a template contains buttons whose labels name other items.
   - A price with "/night" is repeated by the template ("$800/night/night").
   - A form saying "choose your hotel" but having no hotel field.
4. **Weak bench categories:** planning (tabs/sections, itinerary text) and dashboard (charts). Analyze `packages/bench/data/results/2026-10-25T01-01-37-105Z_run_*.jsonl` failures and fix root causes; prove with replay plus a live gate run.
5. **Re-record the form slice baseline** on inline (`--category form --slice form --save`); it is still flat v2.
6. **Optional, ask first:**
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
