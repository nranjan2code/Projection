// The vak Telegram bot: each chat gets its own surface store and
// conversation. Model output is projected into rich messages that are edited
// in place as surfaces change; buttons route to form flows or actions, and
// every user action goes back to the model.

import { basicCatalog, type Catalog, SurfaceStore } from "@vak/core";
import { actionMessage, type Message, type ProjectionPlan, type Provider, runAgent } from "@vak/providers";
import type { TelegramApi, TgUpdate } from "./api.ts";
import { FormFlow, stepsOf } from "./flow.ts";
import { type Control, projectTelegram, telegramProfile } from "./project.ts";

export interface BotOptions {
  api: TelegramApi;
  provider: Provider;
  model: string;
  plan?: ProjectionPlan;
  catalog?: Catalog;
  instructions?: string;
  /** Minimum gap between edits of one message while a surface streams (Telegram rate-limits edits). */
  editIntervalMs?: number;
  log?: (line: string) => void;
}

interface Chat {
  id: number;
  store: SurfaceStore;
  messages: Message[];
  /** Surface id → the rich message showing it. */
  posted: Map<string, number>;
  /** Callback token → what it activates. */
  tokens: Map<string, Control & { surface: string }>;
  flow?: FormFlow;
  /** Choice tokens of the current flow prompt → button label. */
  choiceTokens: Map<string, string>;
  busy: Promise<void>;
  nextToken: number;
}

export class TelegramBot {
  private opts: BotOptions;
  private chats = new Map<number, Chat>();

  constructor(opts: BotOptions) {
    this.opts = opts;
  }

  private chat(id: number): Chat {
    let c = this.chats.get(id);
    if (!c) {
      c = { id, store: new SurfaceStore(this.opts.catalog ?? basicCatalog), messages: [], posted: new Map(), tokens: new Map(), choiceTokens: new Map(), busy: Promise.resolve(), nextToken: 0 };
      this.chats.set(id, c);
    }
    return c;
  }

  /** Handle one update; work for a chat runs in order. */
  handle(update: TgUpdate): Promise<void> {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId === undefined) return Promise.resolve();
    const chat = this.chat(chatId);
    chat.busy = chat.busy.then(() => this.process(chat, update)).catch((err) => this.opts.log?.(`chat ${chatId}: ${(err as Error).message}`));
    return chat.busy;
  }

  private async process(chat: Chat, update: TgUpdate): Promise<void> {
    const { api } = this.opts;
    if (update.callback_query) {
      const q = update.callback_query;
      await api.answerCallbackQuery(q.id);
      const data = q.data ?? "";
      if (chat.flow && chat.choiceTokens.has(data)) return this.flowAnswer(chat, { choice: chat.choiceTokens.get(data)! });
      const target = chat.tokens.get(data);
      if (!target) return void (await api.sendMessage(chat.id, "That button has expired."));
      return this.activate(chat, target);
    }
    const text = update.message?.text?.trim();
    if (!text) return;
    if (chat.flow) return this.flowAnswer(chat, { text });
    chat.messages.push({ role: "user", content: text });
    return this.turn(chat);
  }

  /** A button or form was pressed: ask for its inputs first, if it has any. */
  private async activate(chat: Chat, target: Control & { surface: string }): Promise<void> {
    const found = chat.store.submitScope(target.surface, target.key);
    if (!found) return void (await this.opts.api.sendMessage(chat.id, "That form is no longer shown."));
    const steps = found.scope ? stepsOf(found.scope) : [];
    if (steps.length) {
      chat.flow = new FormFlow(target.surface, target.key, steps);
      return this.askNext(chat);
    }
    return this.submit(chat, target.surface, target.key);
  }

  private async askNext(chat: Chat): Promise<void> {
    const flow = chat.flow!;
    if (flow.done) {
      chat.flow = undefined;
      return this.submit(chat, flow.surface, flow.source);
    }
    const prompt = flow.prompt(chat.store)!;
    chat.choiceTokens.clear();
    if (prompt.choices) {
      const keyboard = prompt.choices.map((row) =>
        row.map((label) => {
          const token = `q${(chat.nextToken++).toString(36)}`;
          chat.choiceTokens.set(token, label);
          return { text: label, callback_data: token };
        }),
      );
      await this.opts.api.sendMessage(chat.id, prompt.text, { reply_markup: { inline_keyboard: keyboard } });
    } else {
      await this.opts.api.sendMessage(chat.id, prompt.text, { reply_markup: { force_reply: true } });
    }
  }

  private async flowAnswer(chat: Chat, input: { text?: string; choice?: string }): Promise<void> {
    const error = chat.flow!.answer(chat.store, input);
    if (error) await this.opts.api.sendMessage(chat.id, error);
    return this.askNext(chat);
  }

  private async submit(chat: Chat, surface: string, source: string): Promise<void> {
    const res = chat.store.submit(surface, source, "telegram");
    if (!res.action) {
      const problems = Object.values(res.errors).flat().join("; ");
      return void (await this.opts.api.sendMessage(chat.id, `Can't send yet: ${problems}`));
    }
    await this.publish(chat, surface);
    chat.messages.push(actionMessage(res.action));
    return this.turn(chat);
  }

  /** Run the model on the conversation; project surfaces as they change. */
  private async turn(chat: Chat): Promise<void> {
    const { api } = this.opts;
    let reply = "";
    const dirty = new Set<string>();
    let lastEdit = 0;
    const interval = this.opts.editIntervalMs ?? 1200;
    const flush = async (force: boolean) => {
      if (!dirty.size || (!force && Date.now() - lastEdit < interval)) return;
      lastEdit = Date.now();
      const ids = [...dirty];
      dirty.clear();
      for (const id of ids) await this.publish(chat, id);
    };
    let pending: Promise<void> = Promise.resolve();
    await runAgent({
      provider: this.opts.provider,
      model: this.opts.model,
      store: chat.store,
      messages: chat.messages,
      catalog: this.opts.catalog,
      profile: telegramProfile,
      plan: this.opts.plan,
      instructions: this.opts.instructions,
      emit: (e) => {
        if (e.type === "text_delta") reply += e.delta;
        if (e.type === "surface") {
          dirty.add(e.snapshot.id);
          pending = pending.then(() => flush(false));
        }
        if (e.type === "error") this.opts.log?.(`chat ${chat.id}: ${e.message}`);
      },
    });
    await pending;
    await flush(true);
    if (reply.trim()) await api.sendMessage(chat.id, reply.trim());
  }

  /** Send or edit the rich message for one surface. */
  private async publish(chat: Chat, surfaceId: string): Promise<void> {
    const resolved = chat.store.resolve(surfaceId);
    if (!resolved) return;
    const projection = projectTelegram(resolved, (key, kind) => {
      // Reuse a token for the same control so already-sent buttons keep working.
      for (const [token, t] of chat.tokens) if (t.surface === surfaceId && t.key === key && t.kind === kind) return token;
      const token = `c${(chat.nextToken++).toString(36)}`;
      chat.tokens.set(token, { token, key, kind, surface: surfaceId });
      return token;
    });
    const messageId = chat.posted.get(surfaceId);
    if (messageId === undefined) {
      const sent = await this.opts.api.sendRichMessage(chat.id, projection.html);
      chat.posted.set(surfaceId, sent.message_id);
    } else {
      await this.opts.api.editRichMessage(chat.id, messageId, projection.html);
    }
  }
}
