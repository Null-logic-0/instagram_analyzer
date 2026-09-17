export const MAX_POSTS = 100;

export const MAX_POSTS_FOR_COMMENTS = 30;

export const MAX_COMMENTS_PER_POST = 50;

// keep this. it is what stops instagram blocking us
export const REQUEST_DELAY_MS = 1500;

export const REQUEST_TIMEOUT_MS = 20_000;

export const MAX_NETWORK_RETRIES = 2;

export const CONSECUTIVE_FAILURE_LIMIT = 3;

export const COLLECT_POST_DETAILS = true;
export const COLLECT_COMMENTS = true;

// instagram sends a broken empty page to non-browser clients
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export const IG_WEB_APP_ID = "936619743392459";

export const AI_ENABLED = true;
export const OLLAMA_BASE_URL = "http://localhost:11434";
export const OLLAMA_MODEL = "llama3.2";
export const OLLAMA_TIMEOUT_MS = 120_000;
export const OLLAMA_RETRIES = 1;

export const MAX_AI_COMMENTS = 100;

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
  hiddenCountShareMedium: 0.2,
  hiddenCountShareHigh: 0.5,
  similarityPairCap: 800,
};
