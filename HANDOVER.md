# HANDOVER.md: state of work (2026-10-25)

Start here in a new session. Rules: [AGENTS.md](AGENTS.md). System: [SPECS.md](SPECS.md).

## Handover prompt (paste into a new session)

```
Continue vak Projection in /Users/nisheethranjan/Projects/vakProjection.

First read AGENTS.md (rules), SPECS.md (architecture) and HANDOVER.md (status and next steps). Then run `npm test`; 116 tests should pass, and `npm run typecheck` should be clean. Nothing is running. Start the playground (.claude/launch.json "playground") when you need it, and tell me when you do.

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

- **Tests:** 116 passing, typecheck clean. The 2026-10-25 afternoon work (below) is in the working tree; check `git log` to see whether it was committed.
- **Baseline** (bench v2, 4B, `tools/core/examples/inline`, 1 run × 30 scenarios):

  | | Now | Old flat baseline |
  |---|---|---|
  | Fully passing | **73%** [56–86] | 47% [30–64] |
  | Check score | 89% [81–96] | — |
  | Follow-up turns (interaction) | 75% | 38% |
  | Median per scenario | 26s | — |

  Weakest categories: planning (40% fully passing) and dashboard (60%). The engine fixes below have not been measured on a live gate run yet.
- **Nothing is running.** The Telegram bot is stopped. One button press (Save Details on the booking confirmation) is saved in the chat's inbox and replays the next time the bot starts. The old long chat is archived in `.vak/telegram/archive/`.

## Done in this stretch

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

1. **Input `kind: "date"` is an error, but the catalog has a `date` component.** The 4B model wrote `{"type":"input","props":{"kind":"date"}}` and retried (Telegram transcript, 2026-10-25). Find a general mechanism: a catalog declaration saying a prop value names another component (input kind date → `date`; maybe checkbox/select kinds too), applied by the normalizer. No per-value hack. Build the test from the real call in `.vak/telegram/archive/` or the current `.vak/telegram/8846301562.jsonl`.
2. **Finish the web tests** in the browser pane (interrupted earlier):
   - a live dashboard prompt (charts)
   - a workout tabs prompt
   - tablet and phone viewports

   Check the header wrapping: at 800px the playground's controls wrap into 3 rows.
3. **Weak bench categories:** planning (tabs/sections, itinerary text) and dashboard (charts).
   - Analyze failures in `packages/bench/data/results/2026-10-25T01-01-37-105Z_run_*.jsonl` and fix root causes.
   - Prove it with replay plus a live gate run (`npm run bench -- gate ollama:qwen3.5:4b-mlx --runs 1`, ~25 min local), which also measures the parser and settings fixes above.
   - Re-record the baseline when engine changes move scores.
4. **Form design:** a form says "choose your hotel" but has no hotel field. Consider a lint warning, or rely on the action data already carrying the chosen item.
5. **The MCP server still teaches flat authoring.** Its instructions say "nodes is a FLAT list" (`packages/mcp`, via `systemPrompt` without a plan). Decide whether MCP clients (often strong models) should get the inline rule too, and pass `authoring` through if so.
6. **Re-record the form slice baseline** on inline (`--category form --slice form --save`); it is still flat v2.
7. **Parked until the user asks: Telegram live.**
   - Start the bot; the saved Save Details press replays.
   - Check the booking confirmation flow end to end and "/night" with prices.
   - The transcript doesn't record the user message that started a turn, only what follows it; consider recording it for diagnosis.
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
