export interface Stats {
  count: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  cv: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  mad: number | null;
}

export function mean(v: number[]): number | null {
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function median(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function quantile(v: number[], p: number): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function stdDev(v: number[]): number | null {
  if (v.length < 2) return null;
  const m = mean(v)!;
  return Math.sqrt(v.reduce((acc, x) => acc + (x - m) ** 2, 0) / (v.length - 1));
}

export function medianAbsoluteDeviation(v: number[]): number | null {
  const med = median(v);
  if (med === null) return null;
  return median(v.map((x) => Math.abs(x - med)));
}

export function describe(v: number[]): Stats {
  const sd = stdDev(v);
  const m = mean(v);
  const q1 = quantile(v, 0.25);
  const q3 = quantile(v, 0.75);
  return {
    count: v.length,
    mean: m,
    median: median(v),
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
    stdDev: sd,
    cv: sd !== null && m !== null && m !== 0 ? sd / m : null,
    q1,
    q3,
    iqr: q1 !== null && q3 !== null ? q3 - q1 : null,
    mad: medianAbsoluteDeviation(v),
  };
}

export function zScore(value: number, s: Stats): number | null {
  if (s.mean === null || s.stdDev === null || s.stdDev === 0) return null;
  return (value - s.mean) / s.stdDev;
}

export function modifiedZScore(value: number, s: Stats): number | null {
  if (s.median === null || s.mad === null || s.mad === 0) return null;
  return (0.6745 * (value - s.median)) / s.mad;
}

export function isIqrOutlier(value: number, s: Stats): boolean {
  if (s.q1 === null || s.q3 === null || s.iqr === null || s.iqr === 0) return false;
  return value < s.q1 - 1.5 * s.iqr || value > s.q3 + 1.5 * s.iqr;
}
