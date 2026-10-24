// Confidence intervals for benchmark rates and scores.

export interface Interval {
  /** Point estimate. */
  value: number;
  lo: number;
  hi: number;
  n: number;
}

const Z95 = 1.959964;

/**
 * Wilson score interval for k successes in n trials. Unlike the normal
 * approximation it stays inside [0, 1] and behaves at small n and at 0 or n
 * successes, which is the regime benchmarks live in.
 */
export function wilson(k: number, n: number, z = Z95): Interval {
  if (n === 0) return { value: 0, lo: 0, hi: 1, n };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { value: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), n };
}

/** Mean with a normal-approximation 95% interval, clamped to [min, max]. */
export function meanInterval(xs: number[], min = 0, max = 1, z = Z95): Interval {
  const n = xs.length;
  if (n === 0) return { value: 0, lo: min, hi: max, n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { value: mean, lo: min, hi: max, n };
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  const half = z * Math.sqrt(variance / n);
  return { value: mean, lo: Math.max(min, mean - half), hi: Math.min(max, mean + half), n };
}

/**
 * A regression is significant when the whole current interval sits below the
 * whole baseline interval. Conservative by design: noise never fails the gate.
 */
export function significantlyWorse(current: Interval, baseline: Interval): boolean {
  return current.hi < baseline.lo;
}

export function fmtInterval(i: Interval, pct = true): string {
  const f = (x: number) => (pct ? `${Math.round(x * 100)}%` : x.toFixed(2));
  return `${f(i.value)} [${f(i.lo)}–${f(i.hi)}]`;
}
