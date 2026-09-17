/**
 * Exercises the AI fraud layer against synthetic data, with no network calls to
 * Instagram. Useful for iterating on prompts and features without a 3-minute
 * live audit.
 *
 *   npx tsx ai-harness.ts
 */

import {
  analyzeComments,
  analyzeDistribution,
  analyzeEngagement,
  analyzeVideos,
  type AnalysisBundle,
} from "./src/analysis.js";
import { buildEvidence } from "./src/ai/evidence.js";
import { analyzeInfluencerWithAI } from "./src/ai/fraud.js";
import { printAiReport } from "./src/ai/report.js";
import { buildFindings } from "./src/indicators.js";
import type { CommentData, PostData, ProfileData } from "./src/types.js";

// A deliberately suspicious account: a tight commenter clique posting near
// identical text within seconds of each other, plus one viral outlier.
const BASE_TS = Date.parse("2026-09-01T12:00:00Z") / 1000;

const posts: PostData[] = Array.from({ length: 12 }, (_, i) => ({
  url: `https://www.instagram.com/p/POST${i}/`,
  type: i % 3 === 0 ? "reel" : "photo",
  publishedAt: new Date((BASE_TS - i * 86_400) * 1000).toISOString(),
  caption: `Post number ${i}`,
  likes: i === 4 ? 92_000 : 5_000 + i * 40,
  comments: 120 + i,
  views: i % 3 === 0 ? 180_000 + i * 100 : null,
  shares: null,
  saves: null,
  shortcode: `POST${i}`,
}));

const CLIQUE = ["fan_alpha", "fan_beta", "fan_gamma", "fan_delta"];
const ORGANIC = [
  "love the choreography in this one",
  "where is this filmed?",
  "nice",
  "😍",
  "this genuinely made my day, thank you for posting",
];

const comments: CommentData[] = [];
for (let p = 0; p < 12; p += 1) {
  const postUrl = `https://www.instagram.com/p/POST${p}/`;

  CLIQUE.forEach((username, k) => {
    comments.push({
      postUrl,
      text: k % 2 === 0 ? "Amazing content!!" : "🔥🔥🔥",
      username,
      timestamp: new Date((BASE_TS - p * 86_400 + k * 12) * 1000).toISOString(),
      likes: 0,
    });
  });

  ORGANIC.forEach((text, j) => {
    comments.push({
      postUrl,
      text,
      username: `viewer_${p}_${j}`,
      timestamp: new Date((BASE_TS - p * 86_400 + 3600 + j * 900) * 1000).toISOString(),
      likes: j,
    });
  });
}

const profile: ProfileData = {
  username: "testsubject",
  displayName: "Test Subject",
  biography: "Dancer",
  profilePicUrl: null,
  followers: 149_000,
  following: 650,
  totalPosts: 126,
  profileUrl: "https://www.instagram.com/testsubject/",
  isPrivate: false,
  isVerified: false,
  externalUrl: null,
  category: null,
  accountType: null,
  userId: null,
};

const bundle: AnalysisBundle = {
  profile,
  posts,
  comments,
  engagement: analyzeEngagement(posts, profile.followers),
  video: analyzeVideos(posts),
  distribution: analyzeDistribution(posts),
  commentAnalysis: analyzeComments(comments),
};

const findings = buildFindings(bundle);
const evidence = buildEvidence(bundle, findings);

const num = (v: number | null, digits = 3): string => (v === null ? "n/a" : v.toFixed(digits));

console.log("=== DETERMINISTIC FEATURES ===");
console.log("median likes:          ", evidence.engagement.medianLikes);
console.log("outliers:              ", evidence.engagement.outlierCount);
console.log("top post x median:     ", num(evidence.engagement.topPostMultipleOfMedian, 1));
console.log("distinct commenters:   ", evidence.coordination.distinctCommenters);
console.log("top 5% concentration:  ", num(evidence.coordination.concentrationTop5Pct));
console.log("gini:                  ", num(evidence.coordination.giniCoefficient));
console.log("recurring pairs:       ", evidence.coordination.recurringPairs.length);
console.log("  strongest pair:      ", JSON.stringify(evidence.coordination.recurringPairs[0]));
console.log("accounts on >=3 posts: ", evidence.behavioral.accountsOnManyPosts);
console.log("burst rate:            ", num(evidence.behavioral.engagementBurstRate));
console.log("median gap (s):        ", evidence.behavioral.averageTimeBetweenActions);
console.log("repeated comment ratio:", num(evidence.behavioral.repeatedCommentRatio));
console.log("duplicate ratio:       ", num(evidence.comments.duplicateRatio));
console.log("sampled comments:      ", evidence.comments.representativeComments.length);
for (const text of evidence.comments.representativeComments.slice(0, 8)) {
  console.log("   -", text);
}
console.log(
  "deterministic findings:",
  findings.length,
  findings.map((f) => f.name),
);

console.log("\n=== AI LAYER ===");
const result = await analyzeInfluencerWithAI(bundle, findings);
console.log("ok:", result.ok, result.ok ? `(model ${result.model})` : `- ${result.detail}`);
printAiReport(result);
