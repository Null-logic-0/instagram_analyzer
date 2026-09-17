import type { Json } from "./types.js";
import { toNumber } from "./util.js";

export function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function metaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i").exec(html)?.[0];
  if (!tag) return null;
  const content = /content=["']([\s\S]*?)["']/i.exec(tag)?.[1];
  return content ? decodeEntities(content) : null;
}

export function collectEmbeddedJson(html: string): unknown[] {
  const out: unknown[] = [];

  const scriptRe = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    if (m[1].length > 8_000_000) continue;
    try {
      out.push(JSON.parse(m[1]));
    } catch {
    }
  }

  const legacy = [
    /window\._sharedData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
    /window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*(\{[\s\S]*?\})\s*\)\s*;?\s*<\/script>/,
  ];
  for (const re of legacy) {
    const hit = re.exec(html);
    if (!hit) continue;
    try {
      out.push(JSON.parse(hit[1]));
    } catch {
    }
  }
  return out;
}

export function deepCollect(root: unknown, match: (node: Json) => boolean, budget = 400_000): Json[] {
  const found: Json[] = [];
  const queue: unknown[] = [root];
  const seen = new Set<unknown>();
  let visited = 0;

  while (queue.length > 0 && visited < budget) {
    const node = queue.shift();
    visited += 1;
    if (!isObject(node) || seen.has(node)) continue;
    seen.add(node);
    if (!Array.isArray(node) && match(node)) found.push(node);
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      if (isObject(v)) queue.push(v);
    }
  }
  return found;
}

export function deepFindFirst(root: unknown, match: (node: Json) => boolean): Json | null {
  return deepCollect(root, match)[0] ?? null;
}

export function firstNumberMatch(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = toNumber(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

export function shortcodeFromUrl(url: string): string | null {
  return /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null;
}

export function postUrlFromShortcode(shortcode: string, isReel: boolean): string {
  return `https://www.instagram.com/${isReel ? "reel" : "p"}/${shortcode}/`;
}
