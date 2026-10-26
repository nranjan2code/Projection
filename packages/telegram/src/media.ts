// Verifying image URLs before Telegram sees them. Telegram rejects a whole rich
// message if any embedded image is not real media, and model-written URLs are
// often invented. Checking means fetching URLs a model chose, so the check
// itself must not become a way into the bot host's network (SSRF): only https,
// only hostnames that resolve exclusively to public addresses.

import { isPublicHttpsUrl, pinnedFetch } from "@vak/providers";

export { isPublicAddress, isPublicHttpsUrl } from "@vak/providers";

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
      // Dial the address the check resolved (no second DNS answer to swap),
      // and stop after the headers: the body is a whole image and unused.
      const res = await pinnedFetch(url, { method, headOnly: true, signal: AbortSignal.timeout(this.timeoutMs) });
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
