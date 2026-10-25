// Run a vak Telegram bot with long polling until stopped. Shared by the
// `npm run telegram` script and any host that runs channels in the background
// (the desktop sidecar), so both poll, resume and recover the same way.

import type { Provider, ProjectionPlan } from "@vak/providers";
import { TelegramApi, TelegramError } from "./api.ts";
import { TelegramBot } from "./bot.ts";

export type ChannelState = "starting" | "running" | "error" | "stopped";

export interface RunTelegramOptions {
  token: string;
  provider: Provider;
  model: string;
  plan?: ProjectionPlan;
  instructions?: string;
  /** Chat state and per-chat transcripts. */
  dataDir: string;
  signal: AbortSignal;
  log?: (line: string) => void;
  /** Called on every state change, with a reason a person can act on. */
  onState?: (state: ChannelState, detail: string) => void;
  /** Test seam: the Bot API base URL. */
  baseUrl?: string;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Resolves when `signal` aborts. A rejected token ends the run with an error state. */
export async function runTelegram(opts: RunTelegramOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const state = (s: ChannelState, detail: string) => opts.onState?.(s, detail);
  const api = new TelegramApi(opts.token, opts.baseUrl);
  state("starting", "connecting to Telegram");

  // Confirm the token and the connection before polling.
  let username = "";
  for (let attempt = 1; !opts.signal.aborted; attempt++) {
    try {
      username = (await api.call<{ username: string }>("getMe", {}, opts.signal)).username;
      break;
    } catch (err) {
      if (opts.signal.aborted) break;
      if (err instanceof TelegramError && err.code === 401) {
        state("error", "Telegram rejected the bot token: check it in Settings");
        return;
      }
      state("error", `cannot reach api.telegram.org (${(err as Error).message}); retrying`);
      await sleep(Math.min(30_000, 1500 * attempt), opts.signal);
    }
  }
  if (opts.signal.aborted) return void state("stopped", "stopped");

  const bot = new TelegramBot({ api, provider: opts.provider, model: opts.model, plan: opts.plan, instructions: opts.instructions, log, transcriptDir: opts.dataDir, stateDir: opts.dataDir });
  state("running", `@${username} · ${opts.model}`);
  log(`telegram: @${username} · ${opts.model}`);
  // Not awaited: replayed turns run alongside polling.
  void bot.resume().then((n) => n && log(`telegram: resumed ${n} unfinished update(s)`));

  let offset = 0;
  while (!opts.signal.aborted) {
    try {
      const updates = await api.getUpdates(offset, 30, opts.signal);
      state("running", `@${username} · ${opts.model}`);
      for (const u of updates) {
        offset = u.update_id + 1;
        log(`telegram ← chat ${u.message?.chat.id ?? u.callback_query?.message?.chat.id}: ${u.message?.text ? "message" : u.callback_query ? "button press" : "update"}`);
        void bot.handle(u).catch((err) => log(`telegram: ${(err as Error).message}`));
      }
    } catch (err) {
      if (opts.signal.aborted) break;
      // 409: Telegram allows one poller per bot; another program has it.
      if (err instanceof TelegramError && err.code === 409) state("error", "another program is polling this bot (is `npm run telegram` running?); retrying");
      else log(`telegram polling: ${(err as Error).message}`);
      await sleep(5000, opts.signal);
    }
  }
  state("stopped", "stopped");
}
