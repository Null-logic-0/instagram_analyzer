/** Maximum number of recent posts to analyze. */
export const MAX_POSTS = 100;

/** Of the discovered posts, how many to open individually for comments. */
export const MAX_POSTS_FOR_COMMENTS = 30;

/** Maximum number of comments per post. */
export const MAX_COMMENTS_PER_POST = 50;

/** Delay between HTTP requests, in ms. */
export const REQUEST_DELAY_MS = 1500;

export const REQUEST_TIMEOUT_MS = 20_000;

/** Retries for transient network errors only. Never retried: 401, 403, 429. */
export const MAX_NETWORK_RETRIES = 2;

/** Abort a collection step after this many consecutive failures. */
export const CONSECUTIVE_FAILURE_LIMIT = 3;

export const COLLECT_POST_DETAILS = true;
export const COLLECT_COMMENTS = true;

/**
 * Instagram serves a near-empty shell to non-browser clients, so requests carry
 * a normal desktop User-Agent. This is a presentation header only: no
 * authentication, cookie or anti-bot mechanism is touched.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** The public web app id instagram.com's own logged-out client sends. */
export const IG_WEB_APP_ID = "936619743392459";


/** Detection thresholds. Heuristics chosen for this tool, not industry standards. */
export const THRESHOLDS = {
  zScoreOutlier: 3.0,
  modifiedZOutlier: 3.5,
  extremeMedianMultiple: 5.0,
  lowVariationCv: 0.1,
  likesPerCommentLow: 10,
  likesPerCommentHigh: 600,
  likeViewRateLow: 0.01,
  likeViewRateHigh: 0.25,
  repeatCommenterShareMedium: 0.15,
  repeatCommenterShareHigh: 0.3,
  duplicateShareMedium: 0.1,
  duplicateShareHigh: 0.25,
  genericShareMedium: 0.35,
  genericShareHigh: 0.55,
  nearDuplicateSimilarity: 0.8,
  /** Share of posts with owner-hidden counts that blocks verification. */
  hiddenCountShareMedium: 0.2,
  hiddenCountShareHigh: 0.5,
  /** Cap on comments used for the O(n^2) similarity pass. */
  similarityPairCap: 800,
};
