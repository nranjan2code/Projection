// Model profiles: declared facts (refreshed daily) plus calibration, cached
// on disk per provider/model so calibration is paid for once.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Calibration } from "./calibration.ts";
import type { ModelProfile } from "./policy.ts";
import type { ModelFacts, Provider } from "./types.ts";

interface Entry {
  facts?: ModelFacts;
  factsAt?: string;
  calibration?: Calibration;
}

const FACTS_TTL_MS = 24 * 60 * 60 * 1000;

export class ProfileCache {
  readonly path: string;
  private entries: Record<string, Entry> = {};

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      try {
        this.entries = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        this.entries = {};
      }
    }
  }

  private key(provider: string, model: string) {
    return `${provider}:${model}`;
  }

  get(provider: string, model: string): Entry | undefined {
    return this.entries[this.key(provider, model)];
  }

  update(provider: string, model: string, patch: Entry): void {
    const k = this.key(provider, model);
    this.entries[k] = { ...this.entries[k], ...patch };
    this.save();
  }

  /** Write atomically so a crash never leaves a truncated cache. */
  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
    renameSync(tmp, this.path);
  }
}

/** Facts from the provider (cached for a day), joined with any calibration on file. */
export async function resolveProfile(
  providerId: string,
  provider: Provider,
  model: string,
  cache: ProfileCache,
  signal?: AbortSignal,
): Promise<ModelProfile> {
  const entry = cache.get(providerId, model);
  let facts = entry?.facts;
  const fresh = entry?.factsAt && Date.now() - Date.parse(entry.factsAt) < FACTS_TTL_MS;
  if (!facts || !fresh) {
    facts = provider.describeModel
      ? await provider.describeModel(model, signal)
      : { fingerprint: model, source: `${providerId} (describeModel not implemented)` };
    cache.update(providerId, model, { facts, factsAt: new Date().toISOString() });
  }
  return {
    provider: providerId,
    model,
    facts,
    constrainedOutput: Boolean(provider.capabilities?.constrainedOutput),
    calibration: cache.get(providerId, model)?.calibration,
  };
}
