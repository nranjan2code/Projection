// Verifying image URLs before Telegram sees them. Telegram rejects a whole rich
// message if any embedded image is not real media, and model-written URLs are
// often invented. Checking means fetching URLs a model chose, so the check
// itself must not become a way into the bot host's network (SSRF): only https,
// only hostnames that resolve exclusively to public addresses.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

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
    if (a >= 224) return false; // multicast / reserved
    return true;
  }
  if (v === 6) {
    const x = address.toLowerCase();
    if (x === "::" || x === "::1") return false;
    if (x.startsWith("::ffff:")) return isPublicAddress(x.slice(7));
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return false; // unique-local, link-local
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

/** Caches whether URLs are real, public images. */
export class MediaVerifier {
  private cache = new Map<string, Promise<boolean>>();
  private timeoutMs: number;

  constructor(timeoutMs = 3000) {
    this.timeoutMs = timeoutMs;
  }

  isImage(url: string): Promise<boolean> {
    let hit = this.cache.get(url);
    if (!hit) {
      hit = this.check(url);
      this.cache.set(url, hit);
    }
    return hit;
  }

  private async check(url: string): Promise<boolean> {
    if (!(await isPublicHttpsUrl(url))) return false;
    // No redirects: a redirect could point somewhere the host check never saw.
    const attempt = async (method: "HEAD" | "GET") => {
      const res = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
      await res.body?.cancel();
      return res;
    };
    try {
      let res = await attempt("HEAD");
      if (res.status === 405 || res.status === 501) res = await attempt("GET");
      return res.ok && /^image\//i.test(res.headers.get("content-type") ?? "");
    } catch {
      return false;
    }
  }
}
