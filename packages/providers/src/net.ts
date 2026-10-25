// Is a URL safe to fetch on a model's say-so? Model-chosen URLs reach out
// from this machine, so a fetch must not become a way into its network
// (SSRF): only https, no credentials in the URL, and only hostnames that
// resolve exclusively to public addresses. Used by Telegram's media check and
// the web-fetch tool.

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
    if (a === 192 && b === 0) return false; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
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
