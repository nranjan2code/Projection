// Is a URL safe to fetch on a model's say-so? Model-chosen URLs reach out
// from this machine, so a fetch must not become a way into its network
// (SSRF): only https, no credentials in the URL, and only hostnames that
// resolve exclusively to public addresses — including an IPv6 address that
// carries an IPv4 one (NAT64, 6to4, mapped). `pinnedFetch` then dials the
// address the check resolved, so a second DNS answer cannot undo the check.
// Used by Telegram's media check and the web-fetch tool.

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

/** An IPv6 address as its 16 bytes, or undefined if it is not one. */
function v6Bytes(address: string): number[] | undefined {
  // A zone id ("fe80::1%en0") is not part of the address.
  let a = address.split("%")[0]!;
  // A trailing dotted quad is two groups: ::ffff:127.0.0.1 is ::ffff:7f00:1.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (dotted) {
    const o = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number);
    if (o.some((n) => n > 255)) return undefined;
    a = `${dotted[1]}${(((o[0]! << 8) | o[1]!) & 0xffff).toString(16)}:${(((o[2]! << 8) | o[3]!) & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = a.split("::");
  const parse = (part: string) => (part ? part.split(":") : []);
  const h = parse(head), t = tail === undefined ? [] : parse(tail);
  const zeros = 8 - h.length - t.length;
  if (zeros < 0) return undefined;
  const out: number[] = [];
  for (const g of [...h, ...Array<string>(zeros).fill("0"), ...t]) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return undefined;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 0xff);
  }
  return out.length === 16 ? out : undefined;
}

const embedded = (b: number[], at: number) => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;
const startsWith = (b: number[], prefix: number[]) => prefix.every((v, i) => b[i] === v);

/** Loopback, private, link-local, CGNAT, unspecified, and IPv4-mapped forms of those. */
export function isPublicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && b === 0) return false; // IETF protocol assignments
    if (a === 192 && b === 88 && address.split(".")[2] === "99") return false; // 6to4 relay anycast
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast / reserved
    return true;
  }
  if (v === 6) {
    const b = v6Bytes(address.toLowerCase());
    if (!b) return false;
    // An address that carries an IPv4 one is only as public as what it
    // carries: on a NAT64 network 64:ff9b::a9fe:a9fe reaches 169.254.169.254,
    // and 2002:7f00:1:: is 6to4 for 127.0.0.1. Checking the prefix alone
    // would wave both through.
    if (startsWith(b, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) return isPublicAddress(embedded(b, 12)); // ::a.b.c.d
    if (startsWith(b, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])) return isPublicAddress(embedded(b, 12)); // ::ffff:a.b.c.d
    if (startsWith(b, [0x00, 0x64, 0xff, 0x9b])) return isPublicAddress(embedded(b, 12)); // 64:ff9b::/96, 64:ff9b:1::/48
    if (startsWith(b, [0x20, 0x02])) return isPublicAddress(embedded(b, 2)); // 2002::/16 (6to4)
    if (startsWith(b, [0x20, 0x01, 0x00, 0x00])) return false; // 2001::/32 Teredo: a tunnel to a client, never a public page
    const first = b[0]!;
    if ((first & 0xfe) === 0xfc) return false; // fc00::/7 unique-local
    if (first === 0xfe && (b[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
    if (first === 0xfe && (b[1]! & 0xc0) === 0xc0) return false; // fec0::/10 site-local (deprecated)
    if (first === 0x00) return false; // ::/8, IPv4-compatible and unspecified
    return true;
  }
  return false;
}

export async function isPublicHttpsUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host)) return false;
  if (isIP(host)) return isPublicAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}

export interface PinnedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Bytes to buffer before giving up (default 2 MB, the web-fetch cap). */
  maxBytes?: number;
  /** Read status and headers only, then drop the connection (a media check). */
  headOnly?: boolean;
  /** Accepted so a plain `fetch` call site type-checks; redirects are never followed. */
  redirect?: "manual" | "follow" | "error";
  /** Accepted for the same reason; no cookie or credential is ever sent. */
  credentials?: "omit" | "same-origin" | "include";
  /** Name resolution; the pinned lookup by default (tests supply their own). */
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
}

/**
 * A `fetch` that can only connect to an address `isPublicAddress` accepts.
 * `isPublicHttpsUrl` resolves the name, then a plain `fetch` resolves it
 * again — a DNS server that answers with a public address once and 127.0.0.1
 * a moment later (rebinding) gets past the check. Resolving inside the
 * connection and dialling that exact address leaves no second answer to swap,
 * while TLS SNI and the Host header still carry the name, so the site answers
 * normally. Returns a normal `Response`, so callers keep fetch semantics.
 */
export function pinnedFetch(raw: string, opts: PinnedFetchOptions = {}): Promise<Response> {
  const url = new URL(raw);
  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      signal: opts.signal,
      lookup(host, lookupOpts, cb) {
        const resolve = opts.resolve ?? ((name: string) => lookup(name, { all: true, family: typeof lookupOpts.family === "number" ? lookupOpts.family : 0 }));
        resolve(host).then(
          (addresses) => {
            const blocked = addresses.find((a) => !isPublicAddress(a.address));
            if (blocked) return cb(new Error(`${host} resolves to ${blocked.address}, which is not a public address`), "", 0);
            if (!addresses.length) return cb(new Error(`no address for ${host}`), "", 0);
            cb(null, addresses[0]!.address, addresses[0]!.family);
          },
          (err: Error) => cb(err, "", 0),
        );
      },
    }, (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
      }
      if (opts.headOnly) {
        // Status and content type are all a caller needs; the body may be a
        // whole image, and nothing here would ever read it.
        res.destroy();
        resolve(new Response(null, { status: res.statusCode ?? 502, headers }));
        return;
      }
      const maxBytes = opts.maxBytes ?? 2_000_000;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error(`response larger than ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502, headers })));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}
