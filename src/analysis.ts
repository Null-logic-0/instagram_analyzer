import { THRESHOLDS } from "./config.js";
import {
  describe,
  isIqrOutlier,
  median,
  modifiedZScore,
  zScore,
  type Stats,
} from "./stats.js";
import type { CommentData, PostData, ProfileData } from "./types.js";
import { mean } from "./stats.js";
import { present, safeDiv, unique } from "./util.js";

export interface EngagementAnalysis {
  likeStats: Stats;
  commentStats: Stats;
  likeRates: number[];
  commentRates: number[];
  engagementRates: number[];
  avgLikeRate: number | null;
  avgCommentRate: number | null;
  avgEngagementRate: number | null;
  medianEngagementRate: number | null;
  medianLikeRate: number | null;
  medianCommentRate: number | null;
  likesPerComment: number | null;
  followersKnown: boolean;
}

export function analyzeEngagement(posts: PostData[], followers: number | null): EngagementAnalysis {
  const likeStats = describe(present(posts.map((p) => p.likes)));
  const commentStats = describe(present(posts.map((p) => p.comments)));

  const followersUsable = followers !== null && followers > 0;
  const likeRates: number[] = [];
  const commentRates: number[] = [];
  const engagementRates: number[] = [];

  if (followersUsable) {
    for (const p of posts) {
      if (p.likes !== null) likeRates.push(p.likes / followers);
      if (p.comments !== null) commentRates.push(p.comments / followers);
      if (p.likes !== null && p.comments !== null) {
        engagementRates.push((p.likes + p.comments) / followers);
      }
    }
  }

  return {
    likeStats,
    commentStats,
    likeRates,
    commentRates,
    engagementRates,
    avgLikeRate: mean(likeRates),
    avgCommentRate: mean(commentRates),
    avgEngagementRate: mean(engagementRates),
    medianEngagementRate: median(engagementRates),
    medianLikeRate: median(likeRates),
    medianCommentRate: median(commentRates),
    likesPerComment: safeDiv(likeStats.median, commentStats.median),
    followersKnown: followersUsable,
  };
}

export interface VideoAnalysis {
  videoCount: number;
  withViews: number;
  viewStats: Stats;
  likeStatsForVideos: Stats;
  commentStatsForVideos: Stats;
  medianViewToLike: number | null;
  medianViewToComment: number | null;
  medianLikeToViewRate: number | null;
  medianCommentToViewRate: number | null;
}

export function analyzeVideos(posts: PostData[]): VideoAnalysis {
  const videos = posts.filter((p) => p.type === "video" || p.type === "reel" || p.views !== null);
  const withViews = videos.filter((p) => p.views !== null && p.views > 0);

  const viewToLike: number[] = [];
  const viewToComment: number[] = [];
  const likeToViewRate: number[] = [];
  const commentToViewRate: number[] = [];

  for (const p of withViews) {
    const vl = safeDiv(p.views, p.likes);
    const vc = safeDiv(p.views, p.comments);
    const lv = safeDiv(p.likes, p.views);
    const cv = safeDiv(p.comments, p.views);
    if (vl !== null) viewToLike.push(vl);
    if (vc !== null) viewToComment.push(vc);
    if (lv !== null) likeToViewRate.push(lv);
    if (cv !== null) commentToViewRate.push(cv);
  }

  return {
    videoCount: videos.length,
    withViews: withViews.length,
    viewStats: describe(present(videos.map((p) => p.views))),
    likeStatsForVideos: describe(present(videos.map((p) => p.likes))),
    commentStatsForVideos: describe(present(videos.map((p) => p.comments))),
    medianViewToLike: median(viewToLike),
    medianViewToComment: median(viewToComment),
    medianLikeToViewRate: median(likeToViewRate),
    medianCommentToViewRate: median(commentToViewRate),
  };
}

export interface OutlierPost {
  post: PostData;
  value: number;
  z: number | null;
  modifiedZ: number | null;
  iqrOutlier: boolean;
  multipleOfMedian: number | null;
  direction: "high" | "low";
}

export interface DistributionAnalysis {
  stats: Stats;
  outliers: OutlierPost[];
  topMultipleOfMedian: number | null;
  topPostShare: number | null;
  sufficientData: boolean;
}

export function analyzeDistribution(posts: PostData[]): DistributionAnalysis {
  const withLikes = posts.filter((p): p is PostData & { likes: number } => p.likes !== null);
  const values = withLikes.map((p) => p.likes);
  const stats = describe(values);
  const outliers: OutlierPost[] = [];

  if (values.length >= 5) {
    for (const p of withLikes) {
      const z = zScore(p.likes, stats);
      const mz = modifiedZScore(p.likes, stats);
      const iqr = isIqrOutlier(p.likes, stats);
      const flagged =
        (z !== null && Math.abs(z) >= THRESHOLDS.zScoreOutlier) ||
        (mz !== null && Math.abs(mz) >= THRESHOLDS.modifiedZOutlier) ||
        iqr;

      if (flagged) {
        outliers.push({
          post: p,
          value: p.likes,
          z,
          modifiedZ: mz,
          iqrOutlier: iqr,
          multipleOfMedian: safeDiv(p.likes, stats.median),
          direction: stats.median !== null && p.likes < stats.median ? "low" : "high",
        });
      }
    }
    outliers.sort((a, b) => Math.abs(b.modifiedZ ?? b.z ?? 0) - Math.abs(a.modifiedZ ?? a.z ?? 0));
  }

  const total = values.reduce((a, b) => a + b, 0);
  return {
    stats,
    outliers,
    topMultipleOfMedian: stats.max !== null ? safeDiv(stats.max, stats.median) : null,
    topPostShare: stats.max !== null && total > 0 ? stats.max / total : null,
    sufficientData: values.length >= 5,
  };
}

const GENERIC_PHRASES = new Set([
  "nice", "wow", "beautiful", "great post", "great", "love", "love it", "love this",
  "amazing", "awesome", "perfect", "cool", "good", "so good", "gorgeous", "stunning",
  "pretty", "cute", "hot", "queen", "king", "fire", "goals", "best", "yes", "omg",
  "incredible", "super", "lovely", "nice pic", "nice photo", "so beautiful", "so cute",
  "great content", "keep it up", "follow me", "check my profile", "dm me", "nice one",
  "top", "wonderful", "excellent", "fantastic", "legend", "insane", "sick", "clean",
]);

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s‍️ -⁯]+$/u;

function normalizeComment(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}️‍]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s}  `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export interface CommenterStat {
  username: string;
  commentCount: number;
  postCount: number;
}

export interface CommentAnalysis {
  available: boolean;
  total: number;
  postsCovered: number;
  uniqueCommenters: number;
  uniqueCommenterPct: number | null;
  repeatedCommenters: number;
  repeatedCommenterPct: number | null;
  repeatCommentShare: number | null;
  topCommenters: CommenterStat[];
  duplicateGroups: Array<{ text: string; count: number }>;
  duplicateCount: number;
  duplicateShare: number | null;
  nearDuplicateShare: number | null;
  emojiOnly: number;
  veryShort: number;
  genericCount: number;
  genericShare: number | null;
  repeatedPhrases: Array<{ phrase: string; count: number }>;
  medianLength: number | null;
}

const EMPTY_COMMENT_ANALYSIS: CommentAnalysis = {
  available: false,
  total: 0,
  postsCovered: 0,
  uniqueCommenters: 0,
  uniqueCommenterPct: null,
  repeatedCommenters: 0,
  repeatedCommenterPct: null,
  repeatCommentShare: null,
  topCommenters: [],
  duplicateGroups: [],
  duplicateCount: 0,
  duplicateShare: null,
  nearDuplicateShare: null,
  emojiOnly: 0,
  veryShort: 0,
  genericCount: 0,
  genericShare: null,
  repeatedPhrases: [],
  medianLength: null,
};

export function analyzeComments(comments: CommentData[]): CommentAnalysis {
  if (comments.length === 0) return { ...EMPTY_COMMENT_ANALYSIS };

  const total = comments.length;

  const byUser = new Map<string, { count: number; posts: Set<string> }>();
  for (const cm of comments) {
    if (!cm.username) continue;
    const entry = byUser.get(cm.username) ?? { count: 0, posts: new Set<string>() };
    entry.count += 1;
    entry.posts.add(cm.postUrl);
    byUser.set(cm.username, entry);
  }

  const commenters: CommenterStat[] = Array.from(byUser.entries()).map(([username, v]) => ({
    username,
    commentCount: v.count,
    postCount: v.posts.size,
  }));
  const repeated = commenters.filter((x) => x.commentCount > 1);
  const repeatComments = repeated.reduce((acc, x) => acc + x.commentCount, 0);

  const texts = comments.map((cm) => cm.text ?? "").filter((t) => t.length > 0);
  const normalized = texts.map(normalizeComment);

  const dupMap = new Map<string, number>();
  for (const n of normalized) {
    if (n.length === 0) continue;
    dupMap.set(n, (dupMap.get(n) ?? 0) + 1);
  }
  const duplicateGroups = Array.from(dupMap.entries())
    .filter(([, count]) => count > 1)
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
  const duplicateCount = duplicateGroups.reduce((acc, g) => acc + g.count, 0);

  // Near-duplicates are an O(n^2) pass, so the sample is capped.
  const sample = normalized.filter((n) => n.length >= 4).slice(0, THRESHOLDS.similarityPairCap);
  const grams = sample.map(trigrams);
  const nearDupMembers = new Set<number>();
  for (let i = 0; i < sample.length; i += 1) {
    for (let j = i + 1; j < sample.length; j += 1) {
      if (sample[i] === sample[j]) continue; // already counted as an exact duplicate
      if (jaccard(grams[i], grams[j]) >= THRESHOLDS.nearDuplicateSimilarity) {
        nearDupMembers.add(i);
        nearDupMembers.add(j);
      }
    }
  }

  let emojiOnly = 0;
  let veryShort = 0;
  let genericCount = 0;
  for (let i = 0; i < texts.length; i += 1) {
    const raw = texts[i].trim();
    const norm = normalized[i];
    const isEmoji = raw.length > 0 && EMOJI_ONLY.test(raw);
    const isShort = norm.length > 0 && norm.length <= 4;
    if (isEmoji) emojiOnly += 1;
    if (isShort) veryShort += 1;
    if (isEmoji || isShort || GENERIC_PHRASES.has(norm)) genericCount += 1;
  }

  const repeatedPhrases = Array.from(dupMap.entries())
    .filter(([phrase, count]) => phrase.length >= 3 && count >= 3)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    available: true,
    total,
    postsCovered: unique(comments.map((cm) => cm.postUrl)).length,
    uniqueCommenters: commenters.length,
    uniqueCommenterPct: commenters.length > 0 ? commenters.length / total : null,
    repeatedCommenters: repeated.length,
    repeatedCommenterPct: commenters.length > 0 ? repeated.length / commenters.length : null,
    repeatCommentShare: total > 0 ? repeatComments / total : null,
    topCommenters: commenters.sort((a, b) => b.commentCount - a.commentCount).slice(0, 10),
    duplicateGroups: duplicateGroups.slice(0, 10),
    duplicateCount,
    duplicateShare: texts.length > 0 ? duplicateCount / texts.length : null,
    nearDuplicateShare: sample.length > 0 ? nearDupMembers.size / sample.length : null,
    emojiOnly,
    veryShort,
    genericCount,
    genericShare: texts.length > 0 ? genericCount / texts.length : null,
    repeatedPhrases,
    medianLength: median(texts.map((t) => t.length)),
  };
}

export interface AnalysisBundle {
  profile: ProfileData;
  posts: PostData[];
  comments: CommentData[];
  engagement: EngagementAnalysis;
  video: VideoAnalysis;
  distribution: DistributionAnalysis;
  commentAnalysis: CommentAnalysis;
}
