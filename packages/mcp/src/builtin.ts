// First-party tools that run in-process: no third-party code, no install.
// They speak the same McpToolInfo + callTool shape as an MCP server, so the
// policy, approval and untrusted-output handling are the same.

import { isPublicHttpsUrl } from "@vak/providers";
import type { McpToolInfo } from "./client.ts";

export interface BuiltinServer {
  tools: McpToolInfo[];
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }>;
}

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

/** Readable text from HTML: no scripts, styles or markup; links kept as "text (url)". */
export function htmlText(html: string, base: string): { title: string; text: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      try {
        const url = new URL(href, base);
        return url.protocol === "https:" && label ? `${label} (${url.href})` : label;
      } catch {
        return label;
      }
    })
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  body = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
  const text = body
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

/**
 * GET an https page for the model. Each hop of a redirect is checked like the
 * first (a public URL redirecting to 169.254.169.254 is the classic SSRF), the
 * body is capped, and no cookies or credentials are ever sent.
 */
export async function safeFetch(raw: string, signal?: AbortSignal, fetcher: typeof fetch = fetch, check: (u: string) => Promise<boolean> = isPublicHttpsUrl): Promise<{ url: string; type: string; body: string }> {
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await check(url))) throw new Error(`refused: ${url} is not a public https address`);
    const res = await fetcher(url, {
      redirect: "manual",
      credentials: "omit",
      headers: { "user-agent": "vak-fetch/0.1 (+https://github.com/nranjan2code/Projection)", accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.1" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).href;
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/|json|xml/.test(type)) {
      await res.body?.cancel();
      throw new Error(`refused: ${type || "unknown"} content is not text`);
    }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url, type, body: new TextDecoder().decode(Buffer.concat(chunks)) };
  }
  throw new Error("too many redirects");
}

export function webFetchServer(opts: { fetcher?: typeof fetch; check?: (u: string) => Promise<boolean> } = {}): BuiltinServer {
  return {
    tools: [
      {
        name: "fetch_page",
        title: "Read a web page",
        description: "Read a public https web page as text (title, text and its links). Use it for facts you don't know; say where facts came from.",
        inputSchema: { type: "object", properties: { url: { type: "string", description: "https URL" } }, required: ["url"] },
        annotations: { readOnlyHint: true, openWorldHint: true, title: "Read a web page" },
      },
    ],
    async callTool(name, args, signal) {
      if (name !== "fetch_page") return { text: `unknown tool ${name}`, isError: true };
      try {
        const page = await safeFetch(String(args.url ?? ""), signal, opts.fetcher, opts.check);
        if (/html/.test(page.type)) {
          const { title, text } = htmlText(page.body, page.url);
          return { text: `URL: ${page.url}\nTitle: ${title}\n\n${text}`, isError: false };
        }
        return { text: `URL: ${page.url}\n\n${page.body}`, isError: false };
      } catch (err) {
        return { text: (err as Error).message, isError: true };
      }
    },
  };
}

export function timeServer(): BuiltinServer {
  const zoneOk = (tz: string) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };
  const show = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" }).format(d);
  return {
    tools: [
      {
        name: "now",
        title: "Current time",
        description: "The current date and time in a time zone (IANA name like Asia/Kolkata; default: this computer's).",
        inputSchema: { type: "object", properties: { timezone: { type: "string" } } },
        annotations: { readOnlyHint: true, openWorldHint: false, title: "Current time" },
      },
      {
        name: "convert_time",
        title: "Convert a time",
        description: "Convert an ISO date-time from one time zone to others.",
        inputSchema: { type: "object", properties: { time: { type: "string", description: "e.g. 2026-11-03T15:00" }, from: { type: "string" }, to: { type: "array", items: { type: "string" } } }, required: ["time", "from", "to"] },
        annotations: { readOnlyHint: true, openWorldHint: false, title: "Convert a time" },
      },
    ],
    async callTool(name, args) {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (name === "now") {
        const tz = String(args.timezone ?? local);
        if (!zoneOk(tz)) return { text: `unknown time zone ${tz}`, isError: true };
        return { text: `${show(new Date(), tz)} (${tz})`, isError: false };
      }
      if (name === "convert_time") {
        const from = String(args.from ?? local);
        const to = (Array.isArray(args.to) ? args.to : [args.to]).map(String);
        const bad = [from, ...to].filter((z) => !zoneOk(z));
        if (bad.length) return { text: `unknown time zone ${bad.join(", ")}`, isError: true };
        // Interpret the wall-clock time in `from`: find the UTC instant whose `from` rendering matches.
        const wall = new Date(`${String(args.time).replace(" ", "T")}Z`);
        if (Number.isNaN(wall.getTime())) return { text: `not a date-time: ${String(args.time)}`, isError: true };
        const offset = (tz: string, d: Date) => {
          const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
          return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - d.getTime();
        };
        const instant = new Date(wall.getTime() - offset(from, wall));
        return { text: to.map((z) => `${z}: ${show(instant, z)}`).join("\n"), isError: false };
      }
      return { text: `unknown tool ${name}`, isError: true };
    },
  };
}
