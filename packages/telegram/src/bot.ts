// The vak Telegram bot: each chat gets its own surface store and
// conversation. Model output is projected into rich messages that are edited
// in place as surfaces change; buttons route to form flows or actions, and
// every user action goes back to the model.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basicCatalog, type Catalog, projectText, type SurfaceSnapshot, SurfaceStore } from "@vak/core";
import { actionMessage, type Message, type ProjectionPlan, type Provider, runAgent } from "@vak/providers";
import { type TelegramApi, TelegramError, type TgUpdate } from "./api.ts";
import { FormFlow, type FlowState, stepsOf } from "./flow.ts";
import { MediaVerifier } from "./media.ts";
import { type Control, imageSources, projectTelegram, telegramProfile } from "./project.ts";

/** Telegram's limit for a plain-text message. */
const MAX_TEXT = 4096;

const START_TEXT = [
  "Hi! Ask me anything and I'll answer with an interactive view: tables, cards, forms and buttons right here in the chat.",
  "",
  "Try:",
  "• Compare three hotels in Kyoto and let me book one",
  "• Show a Q3 sales dashboard",
  "• Make a newsletter signup form",
].join("\n");

const indent = (text: string) => text.split("\n").map((l) => `    ${l}`).join("\n");

export interface BotOptions {
  api: TelegramApi;
  provider: Provider;
  model: string;
  plan?: ProjectionPlan;
  catalog?: Catalog;
  instructions?: string;
  /** Minimum gap between edits of one message while a surface streams (Telegram rate-limits edits). */
  editIntervalMs?: number;
  /** Verifies image URLs before embedding them (default: a public-https verifier). */
  media?: { isImage(url: string): Promise<boolean> };
  log?: (line: string) => void;
  /** Directory for per-chat transcripts of each turn's raw tool calls (for diagnosing model output). */
  transcriptDir?: string;
  /** Directory where each chat's state is saved after every update, so a restart keeps chats and buttons working. */
  stateDir?: string;
}

interface SavedChat {
  v: 1;
  surfaces: SurfaceSnapshot[];
  messages: Message[];
  posted: [string, number][];
  shown: [string, string][];
  tokens: [string, Control & { surface: string }][];
  choiceTokens: [string, string][];
  choicePrompt?: { messageId: number; text: string };
  nextToken: number;
  flow?: FlowState;
  /** Updates received but not finished; replayed after a restart. */
  inbox?: TgUpdate[];
}

interface Chat {
  id: number;
  store: SurfaceStore;
  messages: Message[];
  /** Surface id → the rich message showing it. */
  posted: Map<string, number>;
  /** Surface id → the rich HTML last sent for it. */
  shown: Map<string, string>;
  /** Callback token → what it activates. */
  tokens: Map<string, Control & { surface: string }>;
  flow?: FormFlow;
  /** Choice tokens of the current flow prompt → button label. */
  choiceTokens: Map<string, string>;
  /** The flow prompt showing choice buttons, so they can be replaced by the answer. */
  choicePrompt?: { messageId: number; text: string };
  busy: Promise<void>;
  /** Updates queued or in progress; a press while > 0 waits its turn. */
  pending: number;
  /** Received, not yet finished (saved, so a restart picks them up). */
  inbox: TgUpdate[];
  /** Surfaces to send as new messages when this turn changes them (see turn). */
  moving?: Set<string>;
  nextToken: number;
}

export class TelegramBot {
  private opts: BotOptions;
  private chats = new Map<number, Chat>();
  private media: { isImage(url: string): Promise<boolean> };

  constructor(opts: BotOptions) {
    this.opts = opts;
    this.media = opts.media ?? new MediaVerifier();
  }

  private chat(id: number): Chat {
    let c = this.chats.get(id);
    if (!c) {
      c = { id, store: new SurfaceStore(this.opts.catalog ?? basicCatalog), messages: [], posted: new Map(), shown: new Map(), tokens: new Map(), choiceTokens: new Map(), busy: Promise.resolve(), pending: 0, inbox: [], nextToken: 0 };
      this.restore(c);
      this.chats.set(id, c);
    }
    return c;
  }

  private statePath(id: number): string | undefined {
    return this.opts.stateDir ? `${this.opts.stateDir}/${id}.state.json` : undefined;
  }

  private restore(chat: Chat): void {
    const path = this.statePath(chat.id);
    if (!path) return;
    let saved: SavedChat;
    try {
      saved = JSON.parse(readFileSync(path, "utf8")) as SavedChat;
    } catch {
      return; // no saved state yet
    }
    if (saved.v !== 1) return;
    for (const snap of saved.surfaces) chat.store.load(snap);
    chat.messages = saved.messages;
    chat.posted = new Map(saved.posted);
    chat.shown = new Map(saved.shown);
    chat.tokens = new Map(saved.tokens);
    chat.choiceTokens = new Map(saved.choiceTokens);
    chat.choicePrompt = saved.choicePrompt;
    chat.nextToken = saved.nextToken;
    if (saved.flow) chat.flow = FormFlow.restore(chat.store, saved.flow);
    // A restart mid-update: the conversation was saved before it, so run it again.
    this.unfinished.push(...(saved.inbox ?? []));
  }

  private unfinished: TgUpdate[] = [];

  /**
   * After a restart: handle the updates that were received but not finished.
   * Telegram will not send them again (they were confirmed), so only the saved
   * inboxes know about them.
   */
  async resume(): Promise<number> {
    const dir = this.opts.stateDir;
    if (!dir) return 0;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".state.json"));
    } catch {
      return 0;
    }
    for (const f of files) this.chat(Number(f.slice(0, -".state.json".length)));
    const todo = this.unfinished.splice(0);
    await Promise.all(todo.map((u) => this.handle(u, { resumed: true })));
    return todo.length;
  }

  private save(chat: Chat): void {
    const path = this.statePath(chat.id);
    if (!path) return;
    const saved: SavedChat = {
      v: 1,
      surfaces: chat.store.list().map((s) => chat.store.snapshot(s.id)!),
      messages: chat.messages,
      posted: [...chat.posted],
      shown: [...chat.shown],
      tokens: [...chat.tokens],
      choiceTokens: [...chat.choiceTokens],
      choicePrompt: chat.choicePrompt,
      nextToken: chat.nextToken,
      flow: chat.flow?.save(),
      inbox: chat.inbox,
    };
    try {
      mkdirSync(this.opts.stateDir!, { recursive: true });
      // Write then rename, so a crash mid-write never leaves a torn file.
      writeFileSync(`${path}.tmp`, JSON.stringify(saved));
      renameSync(`${path}.tmp`, path);
    } catch (err) {
      this.opts.log?.(`chat ${chat.id}: state not saved: ${(err as Error).message}`);
    }
  }

  /** Handle one update; work for a chat runs in order. */
  handle(update: TgUpdate, how: { resumed?: boolean } = {}): Promise<void> {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId === undefined) return Promise.resolve();
    const chat = this.chat(chatId);
    // Answer a button press at once, not when the chat's queue reaches it:
    // Telegram expires unanswered queries within seconds, and the press itself
    // is still handled in order below.
    const q = update.callback_query;
    if (q && !how.resumed) {
      const note = chat.pending ? "Still working on the last reply; this runs next." : undefined;
      void this.opts.api.answerCallbackQuery(q.id, note).catch((err) => this.opts.log?.(`chat ${chatId}: ${(err as Error).message}`));
    }
    chat.pending++;
    chat.inbox.push(update);
    this.save(chat);
    chat.busy = chat.busy
      .then(() => this.process(chat, update))
      .catch((err) => this.opts.log?.(`chat ${chatId}: ${(err as Error).message}`))
      .then(() => {
        chat.inbox = chat.inbox.filter((u) => u !== update);
        this.save(chat);
      })
      .finally(() => void chat.pending--);
    return chat.busy;
  }

  private async process(chat: Chat, update: TgUpdate): Promise<void> {
    const { api } = this.opts;
    if (update.callback_query) {
      const q = update.callback_query;
      const data = q.data ?? "";
      if (chat.flow && chat.choiceTokens.has(data)) return this.flowAnswer(chat, { choice: chat.choiceTokens.get(data)! });
      const target = chat.tokens.get(data);
      if (!target) return void (await api.sendMessage(chat.id, "That button has expired."));
      return this.activate(chat, target);
    }
    const text = update.message?.text?.trim();
    if (!text) return;
    if (/^\/start(@\w+)?$/.test(text)) {
      chat.flow = undefined;
      return void (await api.sendMessage(chat.id, START_TEXT));
    }
    if (chat.flow) return this.flowAnswer(chat, { text });
    chat.messages.push({ role: "user", content: text });
    return this.turn(chat, { fresh: true });
  }

  /** A button or form was pressed: ask for its inputs first, if it has any. */
  private async activate(chat: Chat, target: Control & { surface: string }): Promise<void> {
    // Pressing the button of the form already being filled in just keeps going.
    if (chat.flow && chat.flow.surface === target.surface && chat.flow.source === target.key) return;
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
      const sent = await this.opts.api.sendMessage(chat.id, prompt.text, { reply_markup: { inline_keyboard: keyboard } });
      chat.choicePrompt = { messageId: sent.message_id, text: prompt.text };
    } else {
      await this.opts.api.sendMessage(chat.id, prompt.text, { reply_markup: { force_reply: true } });
    }
  }

  private async flowAnswer(chat: Chat, input: { text?: string; choice?: string }): Promise<void> {
    const error = chat.flow!.answer(chat.store, input);
    if (error) await this.opts.api.sendMessage(chat.id, error);
    // An answered question keeps no live buttons: show the answer in their place.
    const asked = chat.choicePrompt;
    if (!error && asked) {
      chat.choicePrompt = undefined;
      chat.choiceTokens.clear();
      await this.opts.api.editText(chat.id, asked.messageId, `${asked.text}: ${input.choice ?? input.text}`).catch((err) => this.opts.log?.(`chat ${chat.id}: ${(err as Error).message}`));
    }
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
  /**
   * `fresh`: the user typed a message, so they are looking at the bottom of
   * the chat. A surface shown earlier and changed by this turn moves there
   * as a new message (the old one keeps its content, without buttons);
   * editing it far up the chat would look like no reply. After a button or
   * form, surfaces are edited in place, where the user is looking.
   */
  private async turn(chat: Chat, opts: { fresh?: boolean } = {}): Promise<void> {
    chat.moving = opts.fresh ? new Set(chat.posted.keys()) : undefined;
    const { api } = this.opts;
    let reply = "";
    const dirty = new Set<string>();
    const touched = new Set<string>();
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
    const from = chat.messages.length;
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
          touched.add(e.snapshot.id);
          // Contain failures here: an unhandled rejection would end the process.
          pending = pending.then(() => flush(false)).catch((err) => this.opts.log?.(`chat ${chat.id}: publish failed: ${(err as Error).message}`));
        }
        if (e.type === "surface_removed") {
          dirty.delete(e.id);
          touched.delete(e.id);
          pending = pending.then(() => this.close(chat, e.id)).catch((err) => this.opts.log?.(`chat ${chat.id}: close failed: ${(err as Error).message}`));
        }
        if (e.type === "error") this.opts.log?.(`chat ${chat.id}: ${e.message}`);
      },
    });
    await pending;
    await flush(true);
    this.record(chat, chat.messages.slice(from));
    for (const id of touched) {
      const resolved = chat.store.resolve(id);
      if (resolved) this.opts.log?.(`→ chat ${chat.id}: surface ${id}\n${indent(projectText(resolved))}`);
    }
    if (reply.trim()) {
      this.opts.log?.(`→ chat ${chat.id}: reply ${JSON.stringify(reply.trim().slice(0, 200))}`);
      await api.sendMessage(chat.id, reply.trim());
    }
  }

  /** Leave a surface's current message as history, without buttons; it will be sent anew. */
  private async retire(chat: Chat, surfaceId: string): Promise<void> {
    const messageId = chat.posted.get(surfaceId);
    const html = chat.shown.get(surfaceId);
    chat.posted.delete(surfaceId);
    chat.shown.delete(surfaceId);
    if (messageId === undefined || !html) return;
    await this.opts.api.editRichMessage(chat.id, messageId, html.replace(/<tg-button-row>[\s\S]*?<\/tg-button-row>/g, "")).catch(() => undefined);
  }

  /** A removed surface: its message stays as history, without live buttons. */
  private async close(chat: Chat, surfaceId: string): Promise<void> {
    for (const [token, t] of chat.tokens) if (t.surface === surfaceId) chat.tokens.delete(token);
    if (chat.flow?.surface === surfaceId) chat.flow = undefined;
    const messageId = chat.posted.get(surfaceId);
    if (messageId === undefined) return;
    chat.posted.delete(surfaceId);
    this.opts.log?.(`→ chat ${chat.id}: surface ${surfaceId} closed`);
    const html = chat.shown.get(surfaceId);
    chat.shown.delete(surfaceId);
    if (html) await this.opts.api.editRichMessage(chat.id, messageId, `${html.replace(/<tg-button-row>[\s\S]*?<\/tg-button-row>/g, "")}<p><i>Closed</i></p>`);
    else await this.opts.api.call("editMessageReplyMarkup", { chat_id: chat.id, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }

  private record(chat: Chat, messages: Message[]): void {
    const dir = this.opts.transcriptDir;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const lines = messages.map((m) => JSON.stringify({ at: new Date().toISOString(), role: m.role, content: m.content, toolCalls: m.toolCalls, isError: m.isError }));
      appendFileSync(`${dir}/${chat.id}.jsonl`, lines.map((l) => `${l}\n`).join(""));
    } catch (err) {
      this.opts.log?.(`chat ${chat.id}: transcript not written: ${(err as Error).message}`);
    }
  }

  /**
   * Send or edit the message for one surface. Rich HTML first (only verified
   * images); if Telegram refuses it, again without media; if that fails too,
   * the plain-text projection. The user always gets an answer.
   */
  private async publish(chat: Chat, surfaceId: string): Promise<void> {
    const resolved = chat.store.resolve(surfaceId);
    if (!resolved) return;
    if (chat.moving?.delete(surfaceId)) await this.retire(chat, surfaceId);
    const tokenFor = (key: string, kind: Control["kind"]) => {
      // Reuse a token for the same control so already-sent buttons keep working.
      for (const [token, t] of chat.tokens) if (t.surface === surfaceId && t.key === key && t.kind === kind) return token;
      const token = `c${(chat.nextToken++).toString(36)}`;
      chat.tokens.set(token, { token, key, kind, label: "", surface: surfaceId });
      return token;
    };
    const verified = new Set<string>();
    await Promise.all(imageSources(resolved).map(async (src) => (await this.media.isImage(src)) && verified.add(src)));

    const rich = projectTelegram(resolved, tokenFor, { allowImage: (src) => verified.has(src) });
    const attempts = [
      { label: "rich", html: rich.html },
      ...(verified.size ? [{ label: "rich without media", html: projectTelegram(resolved, tokenFor).html }] : []),
    ];
    let messageId = chat.posted.get(surfaceId);
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      try {
        if (messageId === undefined) chat.posted.set(surfaceId, (await this.opts.api.sendRichMessage(chat.id, attempt.html)).message_id);
        else await this.opts.api.editRichMessage(chat.id, messageId, attempt.html);
        chat.shown.set(surfaceId, attempt.html);
        return;
      } catch (err) {
        if (!(err instanceof TelegramError && err.code === 400)) throw err;
        if (messageId !== undefined && /message to edit not found/i.test(err.message)) {
          // The user deleted it (or cleared the chat): show the surface as a new message.
          this.opts.log?.(`chat ${chat.id}: message for ${surfaceId} is gone; sending it again`);
          chat.posted.delete(surfaceId);
          chat.shown.delete(surfaceId);
          messageId = undefined;
          i--; // the same attempt, as a new message
          continue;
        }
        this.opts.log?.(`chat ${chat.id}: ${attempt.label} message refused: ${err.message}`);
      }
    }
    // Last resort: the text projection, still interactive through an inline keyboard.
    const text = projectText(resolved).slice(0, MAX_TEXT);
    const keyboard = rich.controls.map((c) => [{ text: c.label || "Open", callback_data: c.token }]);
    const markup = keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};
    if (messageId === undefined) chat.posted.set(surfaceId, (await this.opts.api.sendMessage(chat.id, text, markup)).message_id);
    else await this.opts.api.editText(chat.id, messageId, text);
  }
}
