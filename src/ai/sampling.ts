import { MAX_AI_COMMENTS } from "../config.js";
import type { CommentData } from "../types.js";
import type { CommenterActivity } from "./features.js";

/**
 * A representative slice of the comments, not the whole set. Sending thousands
 * of comments would bury the signal and blow the context window, so the sample
 * deliberately mixes strata: repeated text, the extremes of length, the most
 * active accounts, and a random remainder so ordinary comments are represented.
 */
export function sampleComments(
  comments: CommentData[],
  activity: CommenterActivity[],
  limit = MAX_AI_COMMENTS,
): string[] {
  const texts = comments
    .map((cm) => cm.text?.replace(/\s+/g, " ").trim() ?? "")
    .filter((t) => t.length > 0);

  // How often each distinct text occurs, so the sample can be deduplicated
  // without losing the repetition signal.
  const occurrences = new Map<string, number>();
  for (const t of texts) occurrences.set(t, (occurrences.get(t) ?? 0) + 1);

  const annotate = (text: string): string => {
    const n = occurrences.get(text) ?? 1;
    return n > 1 ? `${text}  [repeated ${n}x]` : text;
  };

  if (occurrences.size <= limit) return Array.from(occurrences.keys()).map(annotate);

  const picked = new Set<string>();
  const take = (candidates: string[], count: number): void => {
    for (const text of candidates) {
      if (picked.size >= limit || count <= 0) return;
      if (picked.has(text)) continue;
      picked.add(text);
      count -= 1;
    }
  };

  const quota = Math.max(1, Math.floor(limit / 5));

  // 1. Text that repeats, which is what duplicate detection keys on.
  const repeated = Array.from(occurrences.entries())
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([text]) => text);
  take(repeated, quota);

  // 2. Comments from the most active accounts.
  const activeUsers = new Set(activity.slice(0, 20).map((a) => a.username));
  take(
    comments
      .filter((cm) => cm.username !== null && activeUsers.has(cm.username))
      .map((cm) => cm.text?.replace(/\s+/g, " ").trim() ?? "")
      .filter((t) => t.length > 0),
    quota,
  );

  // 3. The longest comments, which carry the most semantic content.
  const byLength = [...texts].sort((a, b) => b.length - a.length);
  take(byLength, quota);

  // 4. The shortest, where low-effort patterns live.
  take([...byLength].reverse(), quota);

  // 5. A deterministic spread across the remainder, so ordinary comments show up.
  const step = Math.max(1, Math.floor(texts.length / Math.max(1, limit - picked.size)));
  take(
    texts.filter((_, i) => i % step === 0),
    limit - picked.size,
  );

  // Backfill if the strata overlapped heavily.
  take(texts, limit - picked.size);

  return Array.from(picked).slice(0, limit).map(annotate);
}
