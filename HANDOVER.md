# HANDOVER.md: state of work (2026-10-25)

Start here in a new session. Rules: [AGENTS.md](AGENTS.md). System: [SPECS.md](SPECS.md).

## Handover prompt (paste into a new session)

```
Continue vak Projection in /Users/nisheethranjan/Projects/vakProjection.

First read AGENTS.md (rules), SPECS.md (architecture) and HANDOVER.md (status and next steps). Then run `npm test`; 109 tests should pass. Nothing is running: start the playground (.claude/launch.json "playground") and the Telegram bot (`npm run telegram`) when needed, and tell me when you do.

Rules that matter most:
- No third-party SDKs: everything is built on Node 24 built-ins and fetch.
- No shortcuts or hard-coded fixes: every repair is a catalog declaration or a general engine rule, with a test built from the real model output.
- Never blame the small model: local Ollama `qwen3.5:4b-mlx` is the primary target.
- Secrets live only in .env. Never print them, and run the secret scan on the staged diff before every push. The repo is public: github.com/nranjan2code/Projection. Git identity: Nisheeth Ranjan <nisheethranjan@icloud.com>.
- Ask before any paid model run (OpenAI).
- Only Telegram is available for live chat testing (no Slack or Discord bots). Don't restart the Telegram bot while I'm testing; restart only when it's idle, and tell me first.
- To diagnose a bad reply, read the raw tool calls in .vak/telegram/<chat>.jsonl or .vak/playground/<session>.jsonl, replay them through SurfaceStore.apply, and fix the general cause.

Pick up from "Next" in HANDOVER.md, in order, and ask me if in doubt.
```

## Where things stand

- **Main:** `0c75d41` (pushed, working tree clean). **Tests:** 109 passing, typecheck clean.
- **Baseline** (bench v2, 4B, `tools/core/examples/inline`, 1 run × 30 scenarios):

  | | Now | Old flat baseline |
  |---|---|---|
  | Fully passing | **73%** [56–86] | 47% [30–64] |
  | Check score | 89% [81–96] | — |
  | Follow-up turns (interaction) | 75% | 38% |
  | Median per scenario | 26s | — |

  Weakest categories: planning (40% fully passing) and dashboard (60%).
- **Nothing is running.** The Telegram bot, the playground and every background task are stopped. Telegram chat state is saved in `.vak/telegram/`, so the bot resumes the chat when started. Ollama is a separate app.
- **Where we stopped:** live Telegram testing with "Compare three hotels in Kyoto and let me book one".
  - The last fix (`0c75d41`) means a button never reaches Telegram without text. One empty label used to make Telegram refuse the whole message, sending the user the plain-text fallback.
  - Neither that fix nor `40246a2` (one Book button per card, a single "/night") has been seen live yet.

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
  - A button whose label resolves empty gets text (the action's name, then "Open"). Telegram refused a whole message for one empty label (`RICH_MESSAGE_BUTTON_TEXT_EMPTY`) and the user got the plain-text fallback.
- **Docs:** AGENTS.md, SPECS.md and this file.
- **Web tests passed** in the browser pane:
  - examples render; buttons send the item's data
  - form validation: required, email, choice, checkbox, correct submit data
  - a live hotel comparison (33s)
  - follow-up click → booking confirmation

## Next (in order)

1. **Confirm the live Telegram hotel flow:** start the bot, have the user send the hotel request and tap a Book button. Expect:
   - one Book button per card
   - a single "/night"
   - no plain-text fallback
   - a booking confirmation with real values (no `{placeholders}`)
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
6. **The MCP server still teaches flat authoring.** Its instructions say "nodes is a FLAT list" (`packages/mcp`, via `systemPrompt` without a plan). Decide whether MCP clients (often strong models) should get the inline rule too, and pass `authoring` through if so.
7. **Re-record the form slice baseline** on inline (`--category form --slice form --save`); it is still flat v2.
8. **Optional, ask first:**
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
