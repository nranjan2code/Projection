# AGENTS.md: working on vak Projection

Rules and commands for any coding agent (or person) changing this repo. Read [SPECS.md](SPECS.md) for what the system is, [HANDOVER.md](HANDOVER.md) for where work stands, and [RELEASING.md](RELEASING.md) before a release.

This repository is the framework only. The desktop app, [Vakyartha](https://github.com/nranjan2code/vakyartha), is a separate repository with its own rules; it pins this one as a submodule. Never add app code, app dependencies or app-specific behaviour here.

**Framework or app?** A mechanism or safety default every app needs belongs here; a product choice (which servers to offer, UX, pricing, identity, key storage) belongs to the app. If a second app would have to copy the code, or SECURITY.md promises it, it belongs here (SPECS §10).

## Non-negotiable rules

1. **No third-party runtime SDKs in the framework.** Everything in `packages/*` and the playground runs on Node 24 built-ins and `fetch`. Standards (MCP, JSON Schema, Block Kit, Bot API) are used as specs only. Dev-only `typescript` and `@types/node` are the only root dependencies.
2. **No shortcuts or hard-coded fixes.** A repair is either declared in the catalog (aliases, normalize, defaults, finalize) or a general mechanism in the engine (parser, normalizer, lint, binding rules). Never tune a table to pass a benchmark scenario. Each repair has a comment saying what model output it handles and why.
3. **Never blame the model size.** The local 4B model (Ollama `qwen3.5:4b-mlx`) is the primary target. When it produces something broken, find the general engine fix that makes it work.
4. **Prevention over patching.** Prefer prompt/schema contracts that make an error impossible (inline authoring) over repairs, and repairs over errors. An error goes back to the model and costs a retry, and small models often lose content on retries. Make it an error only when the user would otherwise see something broken.
5. **Ask when in doubt** about scope or a decision that is the user's.

## Secrets and the public repo

- Keys live only in `.env` (gitignored): `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`. Never print or quote values; when checking, show key names and lengths only.
- Never commit `.env` or `.vak/` (profiles, Telegram chat state, transcripts).
- The repo is public (`github.com/nranjan2code/Projection`). Before every push, scan the staged diff:
  ```bash
  git diff --cached | grep -nE "sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-ant-|[0-9]{8,10}:[A-Za-z0-9_-]{35}"
  ```
- Git identity is repo-local: `Nisheeth Ranjan <nisheethranjan@icloud.com>`.
- Ask before any paid model run (OpenAI calibration, judge). Local Ollama runs are free.

## Security rules (see SECURITY.md)

- Third-party code (integrations) is pinned: an exact version published at least 14 days earlier, installed with `--ignore-scripts --before=<today − 14 days>`. `Integrations` in `@vak/mcp/client` enforces this for every app (`pinnedInstallArgs`); never install a server another way, never `npx` or a floating version.
- An outside process (an MCP server) never gets our environment: only the variables it declares (`minimalEnv`).
- Model text, tool output and fetched pages are data: escape them in every projector, wrap tool output as untrusted, and never let them trigger an action without the user's approval policy.
- Anything that writes, deletes or reaches the internet defaults to "ask".
- Loopback servers check Host, Origin and content type; a host serving an app window also requires its token.

## Commands

```bash
npm test              # all unit tests + replay gate (recorded model output through the current engine)
npm run typecheck     # tsc, no emit
npm run playground    # the framework's viewer on http://127.0.0.1:5177/?session=<id> (MCP and bench target; .claude/launch.json "playground")
npm run telegram      # Telegram bot, long polling (needs TELEGRAM_BOT_TOKEN)
node scripts/build-packages.ts               # publishable JS + types in packages/*/dist (publishes nothing)
node scripts/profile-turn.ts [provider:model] # where a turn's time goes (free on Ollama)
npm run bench -- run ollama:qwen3.5:4b-mlx --runs 1 --save   # ~25 min, records baseline + cassette
npm run bench -- gate ollama:qwen3.5:4b-mlx --runs 1 [--plan tools/core/examples/inline]
npm run bench -- report ollama:qwen3.5:4b-mlx [--compare <results.jsonl>]   # projects a report to the playground
node scripts/telegram-repro.ts "<request>"   # replay one Telegram turn offline, print raw tool calls
```

Node 24 runs `.ts` directly (type stripping); there is no build step for development. The playground's browser page loads the packages' TypeScript directly too.

## How to fix a model-output problem

1. Get the raw output. Telegram records every turn in `.vak/telegram/<chat>.jsonl`, the playground in `.vak/playground/<session>.jsonl`, and the bench in `packages/bench/data/results/`.
2. Replay it through `SurfaceStore.apply` in a scratch script and look at the diagnostics and `projectText`.
3. Find the general rule (parser, normalizer, binding, lint). Write a test from the real output, with a comment naming where it came from.
4. Run `npm test`. The replay gate fails on any drop in recorded scores; if a drop is intended, accept it with `npm run bench -- replay --update --accept "<reason>"`.

## Running services while the user tests

- Don't restart the Telegram bot while the user is mid-test: it interrupts their turn. Chat state and unfinished updates survive a restart, but the in-flight reply is redone.
- Restart only when idle (check the last line of the bot log), and say so first.
- The playground loads the engine at start: restart it after engine changes (a page reload picks up `packages/web` and `packages/core` changes in the browser).
- Vakyartha runs its own copy of this repo (its `framework/` submodule): a change here reaches it only after it is pushed and the app moves its pin.

## Changes apps rely on

Apps import the packages' `exports`. A change that breaks one (a removed export, a renamed prop, a changed event) goes in CHANGELOG.md under a **Breaking** line, so an app can move its pin deliberately.

## Code style

- TypeScript, strict, ESM, `.ts` imports. Erasable syntax only (no enums, no parameter properties).
- Comments explain why and what model behaviour a rule handles, not what the code does.
- Match surrounding naming and density. Tests live in `packages/*/test/*.test.ts` (`node:test`).
- `<vak-surface>` also runs in WebKit (Safari, the Vakyartha window): check web projector changes there, not only in a Chromium preview.
