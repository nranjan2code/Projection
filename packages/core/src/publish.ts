// Which version of a surface the user sees while a model works on it.
//
// The store holds the model's working version: every render and update
// lands there, and diagnostics describe it. What the user is shown only moves
// forward. A retry that comes back broken and with less on it than what is
// shown is held back (4B, Vakyartha "compare three hotels in Kyoto": four
// renders, each retry dropped more while fixing one error, and the last,
// near-empty one replaced a surface with intro, cards, button and form).

import type { SurfaceQuality, SurfaceSnapshot, SurfaceStore } from "./surface.ts";

interface Shown {
  snapshot: SurfaceSnapshot;
  quality: SurfaceQuality;
}

/**
 * May `next` replace `shown`? A clean version always may: it is what the
 * model meant, even when smaller. A broken one never replaces a clean one,
 * and replaces a broken one only if it shows at least as much.
 */
export function improves(next: SurfaceQuality, shown: SurfaceQuality): boolean {
  if (next.errors === 0) return true;
  if (shown.errors === 0) return false;
  return next.content >= shown.content;
}

export class SurfacePublisher {
  private store: SurfaceStore;
  private shown = new Map<string, Shown>();

  /** Starts from what the user already sees (surfaces from earlier turns). */
  constructor(store: SurfaceStore) {
    this.store = store;
    for (const s of store.list()) this.remember(s.id);
  }

  private remember(id: string): SurfaceSnapshot | undefined {
    const snapshot = this.store.snapshot(id);
    const quality = this.store.assess(id);
    if (!snapshot || !quality) return undefined;
    this.shown.set(id, { snapshot, quality });
    return snapshot;
  }

  /**
   * A render is streaming in: show it as it arrives only while the user has
   * nothing else on that surface. A rewrite of a shown surface would blank it
   * and rebuild it, and may end worse; it shows once finished, if it improves.
   */
  streaming(id: string): SurfaceSnapshot | undefined {
    if (this.shown.has(id)) return undefined;
    return this.store.snapshot(id);
  }

  /**
   * A call finished. Returns the snapshot to show, or `held` when the working
   * version stays unseen because it would make the surface worse.
   */
  settle(id: string): { snapshot?: SurfaceSnapshot; removed?: boolean; held?: boolean } {
    const quality = this.store.assess(id);
    if (!quality) {
      this.shown.delete(id);
      return { removed: true };
    }
    const shown = this.shown.get(id);
    if (shown && !improves(quality, shown.quality)) return { held: true };
    return { snapshot: this.remember(id) };
  }

  /**
   * The run is over. A surface whose working version was held goes back to
   * the version the user sees, so a reload or another client shows the same.
   * Returns the snapshots that changed.
   */
  finish(): SurfaceSnapshot[] {
    const restored: SurfaceSnapshot[] = [];
    // A render cut off mid-stream (aborted, failed) is as finished as it gets:
    // what never arrived is not coming, so it stops showing as on its way.
    for (const s of this.store.list()) {
      if (!s.partial || this.shown.has(s.id)) continue;
      delete s.partial;
      s.version++;
      const snapshot = this.remember(s.id);
      if (snapshot) restored.push(snapshot);
    }
    for (const [id, shown] of this.shown) {
      const current = this.store.get(id);
      if (!current || current.version === shown.snapshot.version) continue;
      const snapshot = { ...structuredClone(shown.snapshot), version: current.version + 1 };
      this.store.load(snapshot);
      this.shown.set(id, { snapshot, quality: shown.quality });
      restored.push(snapshot);
    }
    return restored;
  }
}
