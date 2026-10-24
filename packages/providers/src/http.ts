// fetch with retry, plus streaming readers for SSE and NDJSON bodies.

import { ProviderError } from "./types.ts";

export { readNdjson, readSse, type SseMessage } from "@vak/core";

import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

/**
 * Node tries each resolved address (IPv6/IPv4 "happy eyeballs") with a 250 ms
 * connect window by default; over slower routes every attempt times out even
 * though the host is reachable. Long-running entry points call this once.
 */
export function hardenNetwork(attemptTimeoutMs = 2500): void {
  setDefaultAutoSelectFamilyAttemptTimeout(attemptTimeoutMs);
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** POST JSON; retries connection failures and retryable statuses before any body is read. */
export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
  retries = 2,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted || attempt >= retries) {
        throw new ProviderError(provider, `request failed: ${(err as Error).message}`);
      }
      await sleep(backoff(attempt++), signal);
      continue;
    }
    if (res.ok) return res;
    if (RETRYABLE.has(res.status) && attempt < retries) {
      const after = Number(res.headers.get("retry-after"));
      await res.body?.cancel();
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoff(attempt++), signal);
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new ProviderError(provider, `HTTP ${res.status}: ${text.slice(0, 600)}`, res.status);
  }
}

export async function getJson(provider: string, url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  return res.json();
}

function backoff(attempt: number): number {
  return 500 * 2 ** attempt + Math.random() * 250;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}

export function safeParseObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : { value: v };
  } catch {
    return { _raw: text };
  }
}
