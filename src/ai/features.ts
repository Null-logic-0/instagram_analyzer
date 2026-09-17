import { mean, median } from "../stats.js";
import type { CommentData, PostData } from "../types.js";
import { safeDiv, unique } from "../util.js";

/** One account's footprint across the analyzed posts. */
export interface CommenterActivity {
  username: string;
  postsCommentedOn: number;
  totalComments: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface BehavioralFeatures {
  /** Mean comments per commenting account. */
  commentsPerAccount: number | null;
  /** Mean distinct posts a commenting account appears on. */
  postsEngagedWith: number | null;
  /** Share of comments written by accounts that commented more than once. */
  repeatedCommentRatio: number | null;
  /** Median gap, in seconds, between consecutive comments by the same account. */
  averageTimeBetweenActions: number | null;
  /** Share of comments landing within BURST_WINDOW_S of another on the same post. */
  engagementBurstRate: number | null;
  /** Comments per UTC hour, "00".."23". Empty when timestamps are unavailable. */
  activeTimeDistribution: Record<string, number>;
  /** Accounts appearing on MANY_POSTS distinct posts or more. */
  accountsOnManyPosts: number;
  timestampsAvailable: boolean;
}

export interface CommenterPair {
  a: string;
  b: string;
  sharedPosts: number;
}

export interface CoordinationEvidence {
  postsWithComments: number;
  distinctCommenters: number;
  topCommenters: CommenterActivity[];
  /** Share of all comments from the top 1% / 5% / 10% of accounts. */
  concentrationTop1Pct: number | null;
  concentrationTop5Pct: number | null;
  concentrationTop10Pct: number | null;
  /** Gini coefficient of comments per account: 0 even, 1 fully concentrated. */
  giniCoefficient: number | null;
  /** Accounts appearing together on repeated posts, strongest first. */
  recurringPairs: CommenterPair[];
  /** Mean distinct posts per account, over accounts seen on more than one. */
  averagePostsPerRepeatAccount: number | null;
}

/** Comments within this many seconds of each other on one post count as a burst. */
const BURST_WINDOW_S = 60;

/** An account on at least this many distinct posts is "recurring". */
const MANY_POSTS = 3;

/** A pair must co-occur on at least this many posts to be reported. */
const MIN_SHARED_POSTS = 3;

/** Pair detection is O(n^2) per post, so very large comment sets are capped. */
const MAX_PAIR_ACCOUNTS = 400;

/** Usernames are [A-Za-z0-9._], so a pipe cannot collide with one. */
const PAIR_SEPARATOR = "|";

function epochSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export function buildCommenterActivity(comments: CommentData[]): CommenterActivity[] {
  const byUser = new Map<string, { posts: Set<string>; total: number; times: number[] }>();

  for (const cm of comments) {
    if (!cm.username) continue;
    const entry = byUser.get(cm.username) ?? { posts: new Set<string>(), total: 0, times: [] };
    entry.posts.add(cm.postUrl);
    entry.total += 1;
    const ts = epochSeconds(cm.timestamp);
    if (ts !== null) entry.times.push(ts);
    byUser.set(cm.username, entry);
  }

  return Array.from(byUser.entries())
    .map(([username, v]) => {
      const sorted = [...v.times].sort((a, b) => a - b);
      return {
        username,
        postsCommentedOn: v.posts.size,
        totalComments: v.total,
        firstSeen: sorted.length > 0 ? new Date(sorted[0] * 1000).toISOString() : null,
        lastSeen: sorted.length > 0 ? new Date(sorted[sorted.length - 1] * 1000).toISOString() : null,
      };
    })
    .sort((a, b) => b.totalComments - a.totalComments || b.postsCommentedOn - a.postsCommentedOn);
}

export function buildBehavioralFeatures(
  comments: CommentData[],
  activity: CommenterActivity[],
): BehavioralFeatures {
  const named = comments.filter((cm) => cm.username !== null);
  const hourly: Record<string, number> = {};
  let timestamped = 0;

  for (const cm of named) {
    const ts = epochSeconds(cm.timestamp);
    if (ts === null) continue;
    timestamped += 1;
    const hour = String(new Date(ts * 1000).getUTCHours()).padStart(2, "0");
    hourly[hour] = (hourly[hour] ?? 0) + 1;
  }

  // Median gap between consecutive comments by the same account.
  const perUserTimes = new Map<string, number[]>();
  for (const cm of named) {
    const ts = epochSeconds(cm.timestamp);
    if (ts === null || !cm.username) continue;
    perUserTimes.set(cm.username, [...(perUserTimes.get(cm.username) ?? []), ts]);
  }
  const gaps: number[] = [];
  for (const times of perUserTimes.values()) {
    const sorted = [...times].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i] - sorted[i - 1]);
  }

  // Bursts: comments clustered tightly in time on the same post.
  const perPost = new Map<string, number[]>();
  for (const cm of named) {
    const ts = epochSeconds(cm.timestamp);
    if (ts === null) continue;
    perPost.set(cm.postUrl, [...(perPost.get(cm.postUrl) ?? []), ts]);
  }
  let bursty = 0;
  for (const times of perPost.values()) {
    const sorted = [...times].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      const near =
        (i > 0 && sorted[i] - sorted[i - 1] <= BURST_WINDOW_S) ||
        (i < sorted.length - 1 && sorted[i + 1] - sorted[i] <= BURST_WINDOW_S);
      if (near) bursty += 1;
    }
  }

  const repeatComments = activity
    .filter((a) => a.totalComments > 1)
    .reduce((sum, a) => sum + a.totalComments, 0);

  return {
    commentsPerAccount: activity.length > 0 ? named.length / activity.length : null,
    postsEngagedWith: mean(activity.map((a) => a.postsCommentedOn)),
    repeatedCommentRatio: named.length > 0 ? repeatComments / named.length : null,
    averageTimeBetweenActions: median(gaps),
    engagementBurstRate: timestamped > 0 ? bursty / timestamped : null,
    activeTimeDistribution: hourly,
    accountsOnManyPosts: activity.filter((a) => a.postsCommentedOn >= MANY_POSTS).length,
    timestampsAvailable: timestamped > 0,
  };
}

/** Share of all comments produced by the top `fraction` of accounts. */
function topShare(sortedTotals: number[], fraction: number): number | null {
  if (sortedTotals.length === 0) return null;
  const total = sortedTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const take = Math.max(1, Math.ceil(sortedTotals.length * fraction));
  return sortedTotals.slice(0, take).reduce((a, b) => a + b, 0) / total;
}

function gini(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const weighted = sorted.reduce((acc, v, i) => acc + (i + 1) * v, 0);
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

/** Accounts that keep showing up on the same posts as each other. */
function findRecurringPairs(comments: CommentData[]): CommenterPair[] {
  const byPost = new Map<string, Set<string>>();
  for (const cm of comments) {
    if (!cm.username) continue;
    const set = byPost.get(cm.postUrl) ?? new Set<string>();
    set.add(cm.username);
    byPost.set(cm.postUrl, set);
  }

  const shared = new Map<string, number>();
  for (const set of byPost.values()) {
    const users = Array.from(set).sort().slice(0, MAX_PAIR_ACCOUNTS);
    for (let i = 0; i < users.length; i += 1) {
      for (let j = i + 1; j < users.length; j += 1) {
        const key = `${users[i]}${PAIR_SEPARATOR}${users[j]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(shared.entries())
    .filter(([, count]) => count >= MIN_SHARED_POSTS)
    .map(([key, sharedPosts]) => {
      const [a, b] = key.split(PAIR_SEPARATOR);
      return { a, b, sharedPosts };
    })
    .sort((x, y) => y.sharedPosts - x.sharedPosts)
    .slice(0, 15);
}

export function buildCoordinationEvidence(
  comments: CommentData[],
  activity: CommenterActivity[],
): CoordinationEvidence {
  const totals = activity.map((a) => a.totalComments).sort((a, b) => b - a);
  const repeats = activity.filter((a) => a.postsCommentedOn > 1);

  return {
    postsWithComments: unique(comments.map((cm) => cm.postUrl)).length,
    distinctCommenters: activity.length,
    topCommenters: activity.slice(0, 10),
    concentrationTop1Pct: topShare(totals, 0.01),
    concentrationTop5Pct: topShare(totals, 0.05),
    concentrationTop10Pct: topShare(totals, 0.1),
    giniCoefficient: gini(totals),
    recurringPairs: findRecurringPairs(comments),
    averagePostsPerRepeatAccount: mean(repeats.map((a) => a.postsCommentedOn)),
  };
}

/** Posting cadence, which gives the model context for judging engagement bursts. */
export interface PostingRhythm {
  postsWithDates: number;
  medianHoursBetweenPosts: number | null;
  spanDays: number | null;
}

export function buildPostingRhythm(posts: PostData[]): PostingRhythm {
  const times = posts
    .map((p) => epochSeconds(p.publishedAt))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  if (times.length < 2) {
    return { postsWithDates: times.length, medianHoursBetweenPosts: null, spanDays: null };
  }

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);

  return {
    postsWithDates: times.length,
    medianHoursBetweenPosts: safeDiv(median(gaps), 3600),
    spanDays: safeDiv(times[times.length - 1] - times[0], 86_400),
  };
}
