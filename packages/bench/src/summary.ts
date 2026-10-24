// Aggregates and persistence: summaries with intervals, baselines, cassettes.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { addUsage, type Usage } from "@vak/core";
import type { ProjectionConfig } from "@vak/providers";
import type { RunRecord } from "./runner.ts";
import { SCENARIOS } from "./scenarios.ts";
import { type Interval, meanInterval, wilson } from "./stats.ts";

export interface Summary {
  runs: number;
  /** Share of runs where every check passed. */
  complete: Interval;
  /** Mean share of checks passed per run. */
  score: Interval;
  /** Mean semantic grade in [0, 1], when judged. */
  judge?: Interval;
  byCategory: Record<string, { runs: number; complete: Interval; score: Interval }>;
  byScenario: Record<string, { runs: number; complete: number; score: number; judge?: number }>;
  medianMs: number;
  usage?: Usage;
}

export function summarize(records: RunRecord[]): Summary {
  const share = (r: RunRecord) => (r.total ? r.passed / r.total : 0);
  const judged = records.filter((r) => r.judge);
  const category = (id: string) => SCENARIOS.find((s) => s.id === id)?.category ?? "unknown";
  const byCategory: Summary["byCategory"] = {};
  for (const cat of new Set(records.map((r) => category(r.scenario)))) {
    const rs = records.filter((r) => category(r.scenario) === cat);
    byCategory[cat] = { runs: rs.length, complete: wilson(rs.filter((r) => r.complete).length, rs.length), score: meanInterval(rs.map(share)) };
  }
  const byScenario: Summary["byScenario"] = {};
  for (const id of new Set(records.map((r) => r.scenario))) {
    const rs = records.filter((r) => r.scenario === id);
    const js = rs.filter((r) => r.judge);
    byScenario[id] = {
      runs: rs.length,
      complete: rs.filter((r) => r.complete).length,
      score: rs.reduce((a, r) => a + share(r), 0) / rs.length,
      ...(js.length ? { judge: js.reduce((a, r) => a + r.judge!.score, 0) / js.length } : {}),
    };
  }
  const ms = records.map((r) => r.turns.reduce((a, t) => a + t.ms, 0)).sort((a, b) => a - b);
  let usage: Usage | undefined;
  for (const r of records) for (const t of r.turns) usage = addUsage(usage, t.usage);
  return {
    runs: records.length,
    complete: wilson(records.filter((r) => r.complete).length, records.length),
    score: meanInterval(records.map(share)),
    ...(judged.length ? { judge: meanInterval(judged.map((r) => r.judge!.score)) } : {}),
    byCategory,
    byScenario,
    medianMs: ms[Math.floor(ms.length / 2)] ?? 0,
    usage,
  };
}

export interface Baseline {
  benchVersion: number;
  provider: string;
  model: string;
  fingerprint: string;
  config: ProjectionConfig;
  commit: string;
  at: string;
  summary: Summary;
}

const DATA = new URL("../data/", import.meta.url).pathname;
const slug = (provider: string, model: string) => `${provider}__${model}`.replace(/[^\w.-]+/g, "_");

export const paths = {
  baseline: (provider: string, model: string) => `${DATA}baselines/${slug(provider, model)}.json`,
  cassette: (provider: string, model: string) => `${DATA}cassettes/${slug(provider, model)}.jsonl`,
  cassettes: `${DATA}cassettes/`,
};

export function readBaseline(provider: string, model: string): Baseline | undefined {
  const p = paths.baseline(provider, model);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Baseline) : undefined;
}

export function writeBaseline(b: Baseline): void {
  mkdirSync(`${DATA}baselines`, { recursive: true });
  writeFileSync(paths.baseline(b.provider, b.model), JSON.stringify(b, null, 2) + "\n");
}

/** Replace a model's cassette with these records (one JSON object per line). */
export function writeCassette(provider: string, model: string, records: RunRecord[]): void {
  mkdirSync(paths.cassettes, { recursive: true });
  const file = paths.cassette(provider, model);
  writeFileSync(file, "");
  for (const r of records) appendFileSync(file, JSON.stringify({ provider, model, ...r }) + "\n");
}

export interface CassetteEntry extends RunRecord {
  provider: string;
  model: string;
}

export function readCassettes(): { file: string; entries: CassetteEntry[] }[] {
  if (!existsSync(paths.cassettes)) return [];
  return readdirSync(paths.cassettes)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      file: f,
      entries: readFileSync(paths.cassettes + f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as CassetteEntry),
    }));
}
