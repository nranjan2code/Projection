# Examples

Each runs from the repo with Node 24 (no build step). Keys come from `.env`; the default model is local Ollama (`qwen3.5:4b-mlx`), so they cost nothing. Pick another with `VAK_MODEL=provider:model`.

| Example | What it shows | Run |
|---|---|---|
| [terminal-chat.ts](terminal-chat.ts) | `createVak` + the terminal projector: a chat whose answers are tables, cards and charts in ANSI | `node examples/terminal-chat.ts` |
| [email-digest.ts](email-digest.ts) | one request → an HTML email (and its text part) with the email projector | `node examples/email-digest.ts "Weekly sales summary"` |
| [web-page/](web-page/) | the smallest web app: `@vak/host` + one HTML page with `<vak-surface>`, buttons and forms going back to the model | `node examples/web-page/server.ts` |

For a full app on the framework (chats, settings, integrations), see [Vakyartha](https://github.com/nranjan2code/vakyartha). `npm run playground` is the framework's own viewer.
