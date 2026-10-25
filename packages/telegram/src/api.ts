// Minimal Telegram Bot API client over fetch (no SDK).

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  reply_to_message?: { message_id: number };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: TgMessage; from: { id: number } };
}

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

export class TelegramError extends Error {
  readonly code?: number;
  constructor(method: string, description: string, code?: number) {
    super(`telegram ${method}: ${description}`);
    this.code = code;
  }
}

export class TelegramApi {
  private base: string;

  constructor(token: string, baseUrl = "https://api.telegram.org") {
    this.base = `${baseUrl.replace(/\/$/, "")}/bot${token}`;
  }

  async call<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
    const body = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as { ok: boolean; result?: T; description?: string; error_code?: number };
    if (!body.ok) throw new TelegramError(method, body.description ?? `HTTP ${res.status}`, body.error_code);
    return body.result as T;
  }

  sendRichMessage(chatId: number, html: string): Promise<TgMessage> {
    return this.call("sendRichMessage", { chat_id: chatId, rich_message: { html } });
  }

  /** Edit a rich message in place; an unchanged edit is not an error. */
  async editRichMessage(chatId: number, messageId: number, html: string): Promise<void> {
    try {
      await this.call("editMessageText", { chat_id: chatId, message_id: messageId, rich_message: { html } });
    } catch (err) {
      if (!(err instanceof TelegramError && /not modified/i.test(err.message))) throw err;
    }
  }

  /** Replace a message's content with plain text (fallback when rich content is refused). */
  async editText(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text });
    } catch (err) {
      if (!(err instanceof TelegramError && /not modified/i.test(err.message))) throw err;
    }
  }

  sendMessage(chatId: number, text: string, extra: { reply_markup?: InlineKeyboard | { force_reply: true } } = {}): Promise<TgMessage> {
    return this.call("sendMessage", { chat_id: chatId, text, ...extra });
  }

  answerCallbackQuery(id: string, text?: string): Promise<boolean> {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TgUpdate[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ["message", "callback_query"] }, signal);
  }
}
