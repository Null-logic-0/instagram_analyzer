const USE_COLOR = process.stdout.isTTY === true && !process.env.NO_COLOR;

const wrapColor = (open: string, close: string) => (s: string) =>
  USE_COLOR ? `${open}${s}${close}` : s;

export const c = {
  bold: wrapColor("\x1b[1m", "\x1b[22m"),
  dim: wrapColor("\x1b[2m", "\x1b[22m"),
  red: wrapColor("\x1b[31m", "\x1b[39m"),
  green: wrapColor("\x1b[32m", "\x1b[39m"),
  yellow: wrapColor("\x1b[33m", "\x1b[39m"),
  blue: wrapColor("\x1b[34m", "\x1b[39m"),
  cyan: wrapColor("\x1b[36m", "\x1b[39m"),
  gray: wrapColor("\x1b[90m", "\x1b[39m"),
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const NA = "N/A";

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return NA;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return NA;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return NA;
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtBool(b: boolean | null | undefined): string {
  if (b === null || b === undefined) return NA;
  return b ? "Yes" : "No";
}

export function fmtText(s: string | null | undefined, max = 200): string {
  if (!s) return NA;
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return NA;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function safeDiv(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

/** Parses "1.2M", "182K" or "1,234". Returns null if unparseable. */
export function parseHumanNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/,/g, "").replace(/\s/g, "");
  const m = /^([\d.]+)\s*([KMB])?$/i.exec(s);
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "k" | "m" | "b"] : 1;
  return Math.round(value * (mult ?? 1));
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toIso(unixSeconds: unknown): string | null {
  const n = toNumber(unixSeconds);
  if (n === null || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/** Keeps only usable numbers, so statistics skip unavailable metrics. */
export function present(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}
