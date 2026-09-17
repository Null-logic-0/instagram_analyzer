import type { AnalysisBundle } from "./analysis.js";
import { THRESHOLDS } from "./config.js";
import type { Finding, Severity } from "./types.js";
import { fmtInt, fmtNum, fmtPct, fmtText } from "./util.js";

/**
 * Independent signals, each with its own evidence and confidence. None is a
 * verdict: every one lists the legitimate explanations alongside it, and the
 * report presents them as prompts for human investigation.
 */
export function buildFindings(a: AnalysisBundle): Finding[] {
  const { engagement: eng, video, distribution: dist, commentAnalysis: ca } = a;
  const findings: Finding[] = [];

  // Hiding like counts is an Instagram feature with many innocent uses, so
  // this reports what it does to the AUDIT -- engagement stops being
  // verifiable -- rather than asserting anything about how it was obtained.
  const hidden = a.posts.filter((p) => p.countsHidden === true).length;
  if (hidden > 0 && a.posts.length > 0) {
    const share = hidden / a.posts.length;
    const severity: Severity =
      share >= THRESHOLDS.hiddenCountShareHigh
        ? "HIGH"
        : share >= THRESHOLDS.hiddenCountShareMedium
          ? "MEDIUM"
          : "LOW";

    findings.push({
      name: "Like counts hidden - engagement not independently verifiable",
      severity,
      evidence:
        `${hidden} of ${a.posts.length} analyzed posts (${fmtPct(share, 1)}) have their like counts ` +
        `hidden by the account. Instagram emits a placeholder number for these, not a real count, so ` +
        `they are excluded from every like statistic in this report. ` +
        `Like-based figures therefore describe only the ${a.posts.length - hidden} remaining post(s).`,
      // Directly observed from a flag Instagram sets, not inferred.
      confidence: "HIGH",
      observed: `${fmtPct(share, 1)} of analyzed posts hide their like counts.`,
      interpretation:
        "Engagement on those posts cannot be checked against any public number. This limits the audit; " +
        "it is not by itself evidence about how the engagement was obtained.",
      possibleExplanations: [
        "Instagram's own hide-likes setting, which it promoted as a wellbeing feature",
        "a creator choosing not to display public metrics",
        "reducing social comparison for the audience",
        "concealing weak, declining, or purchased engagement",
      ],
    });
  }

  if (dist.sufficientData && dist.outliers.length > 0) {
    const worst = dist.outliers[0];
    const mult = worst.multipleOfMedian;
    const extreme = mult !== null && mult >= THRESHOLDS.extremeMedianMultiple;

    findings.push({
      name: extreme ? "Extreme post outlier" : "Engagement distribution anomaly",
      severity: extreme ? "HIGH" : "MEDIUM",
      evidence: [
        `${dist.outliers.length} of ${dist.stats.count} posts with like counts fall outside the normal range.`,
        `The most extreme has ${fmtInt(worst.value)} likes against a median of ${fmtInt(dist.stats.median)}` +
          (mult !== null ? ` (${fmtNum(mult, 1)}x the median).` : "."),
        worst.z !== null ? `z-score ${fmtNum(worst.z, 2)}.` : "",
        worst.modifiedZ !== null ? `MAD-based modified z-score ${fmtNum(worst.modifiedZ, 2)}.` : "",
        worst.iqrOutlier ? "Also outside the 1.5x IQR fence." : "",
      ]
        .filter(Boolean)
        .join(" "),
      confidence: dist.stats.count >= 20 ? "HIGH" : dist.stats.count >= 10 ? "MEDIUM" : "LOW",
      observed:
        `One post received ${mult !== null ? `${fmtNum(mult, 1)}x` : "well above"} the median number of ` +
        `likes (${fmtInt(worst.value)} vs ${fmtInt(dist.stats.median)}).`,
      interpretation: "Statistical outlier in the like distribution.",
      possibleExplanations: [
        "viral content",
        "external promotion or a feature by a larger account",
        "collaboration or a giveaway",
        "paid advertising or a boosted post",
        "artificial engagement",
      ],
    });
  }

  if (dist.sufficientData && eng.likeStats.cv !== null && eng.likeStats.cv < THRESHOLDS.lowVariationCv) {
    findings.push({
      name: "Unusual engagement consistency",
      severity: "MEDIUM",
      evidence:
        `Like counts vary by only ${fmtPct(eng.likeStats.cv, 1)} of the mean (coefficient of variation ` +
        `${fmtNum(eng.likeStats.cv, 3)}) across ${eng.likeStats.count} posts. Range: ` +
        `${fmtInt(eng.likeStats.min)}-${fmtInt(eng.likeStats.max)}, std dev ${fmtInt(eng.likeStats.stdDev)}.`,
      confidence: eng.likeStats.count >= 20 ? "MEDIUM" : "LOW",
      observed: `Like counts cluster within a very narrow band across ${eng.likeStats.count} posts.`,
      interpretation: "Organic reach normally produces noticeably more variance than this.",
      possibleExplanations: [
        "a highly consistent, loyal audience",
        "a stable posting format and schedule",
        "algorithmic reach capping",
        "engagement delivered in fixed quantities",
      ],
    });
  }

  if (eng.likesPerComment !== null && eng.commentStats.count >= 5) {
    const lpc = eng.likesPerComment;
    const tooFew = lpc > THRESHOLDS.likesPerCommentHigh;
    const tooMany = lpc < THRESHOLDS.likesPerCommentLow;

    if (tooFew || tooMany) {
      findings.push({
        name: "Unusual like/comment ratio",
        severity: "MEDIUM",
        evidence:
          `Median likes ${fmtInt(eng.likeStats.median)} against median comments ` +
          `${fmtInt(eng.commentStats.median)} = ${fmtNum(lpc, 1)} likes per comment, outside the ` +
          `${THRESHOLDS.likesPerCommentLow}-${THRESHOLDS.likesPerCommentHigh} band typical of public accounts.`,
        confidence: eng.commentStats.count >= 20 ? "MEDIUM" : "LOW",
        observed: `${fmtNum(lpc, 1)} likes for every comment (median-based).`,
        interpretation: "The relationship between passive and active engagement is atypical.",
        possibleExplanations: tooFew
          ? [
              "content that is easy to like but hard to comment on",
              "comments disabled or heavily filtered on some posts",
              "an audience that does not converse",
              "likes acquired separately from comments",
            ]
          : [
              "an unusually conversational or community-driven audience",
              "giveaways or tag-a-friend mechanics",
              "comment pods or purchased comments",
            ],
      });
    }
  }

  if (video.medianLikeToViewRate !== null && video.withViews >= 3) {
    const r = video.medianLikeToViewRate;
    if (r < THRESHOLDS.likeViewRateLow || r > THRESHOLDS.likeViewRateHigh) {
      const tooHigh = r > THRESHOLDS.likeViewRateHigh;
      findings.push({
        name: "Unusual view/like relationship",
        severity: tooHigh ? "MEDIUM" : "LOW",
        evidence:
          `Across ${video.withViews} video/reel posts the median like/view rate is ${fmtPct(r, 2)} ` +
          `(median views ${fmtInt(video.viewStats.median)}, median likes ` +
          `${fmtInt(video.likeStatsForVideos.median)}). Expected band: ` +
          `${fmtPct(THRESHOLDS.likeViewRateLow, 0)}-${fmtPct(THRESHOLDS.likeViewRateHigh, 0)}.`,
        confidence: video.withViews >= 10 ? "MEDIUM" : "LOW",
        observed: `Median like/view rate of ${fmtPct(r, 2)} on video content.`,
        interpretation: "Views and likes are not moving together the way they usually do.",
        possibleExplanations: tooHigh
          ? [
              "a small, highly engaged audience",
              "views counted differently for short reels",
              "likes inflated relative to genuine reach",
            ]
          : [
              "wide distribution to non-followers via the Reels feed",
              "autoplay views from passive scrolling",
              "views inflated relative to genuine interest",
            ],
      });
    }
  }

  if (ca.available && ca.total >= 20 && ca.repeatCommentShare !== null) {
    const share = ca.repeatCommentShare;
    if (share >= THRESHOLDS.repeatCommenterShareMedium) {
      const topList = ca.topCommenters
        .slice(0, 3)
        .map((t) => `@${t.username} (${t.commentCount} comments on ${t.postCount} posts)`)
        .join(", ");

      findings.push({
        name: "Repeated commenter concentration",
        severity: share >= THRESHOLDS.repeatCommenterShareHigh ? "HIGH" : "MEDIUM",
        evidence:
          `${fmtPct(share, 1)} of the ${fmtInt(ca.total)} analyzed comments came from ` +
          `${fmtInt(ca.repeatedCommenters)} accounts (${fmtPct(ca.repeatedCommenterPct, 1)} of all ` +
          `commenters). Most frequent: ${topList}.`,
        confidence: ca.total >= 200 ? "MEDIUM" : "LOW",
        observed: `${fmtPct(share, 1)} of comments came from a small recurring group of accounts.`,
        interpretation: "Comment activity is concentrated rather than broadly distributed.",
        possibleExplanations: [
          "genuine superfans and regular followers",
          "friends, family, or team members",
          "an engagement pod",
          "coordinated or automated commenting",
        ],
      });
    }
  }

  if (ca.available && ca.total >= 20) {
    const dup = ca.duplicateShare ?? 0;
    const near = ca.nearDuplicateShare ?? 0;
    const worst = Math.max(dup, near);

    if (worst >= THRESHOLDS.duplicateShareMedium) {
      const examples = ca.duplicateGroups
        .slice(0, 3)
        .map((g) => `"${fmtText(g.text, 40)}" x${g.count}`)
        .join(", ");

      findings.push({
        name: "Highly repetitive comments",
        severity: worst >= THRESHOLDS.duplicateShareHigh ? "HIGH" : "MEDIUM",
        evidence:
          `${fmtPct(dup, 1)} of comments are exact duplicates of another comment and ${fmtPct(near, 1)} ` +
          `of the sampled comments have a near-duplicate (trigram similarity >= ` +
          `${THRESHOLDS.nearDuplicateSimilarity}). ${examples ? `Examples: ${examples}.` : ""}`,
        confidence: ca.total >= 200 ? "MEDIUM" : "LOW",
        observed: "The same or nearly the same comment text recurs across posts.",
        interpretation: "Comment text diversity is lower than free-form conversation usually produces.",
        possibleExplanations: [
          "shared slang, catchphrases or fandom in-jokes",
          "reaction emoji that everyone uses",
          "template comments from engagement groups",
          "automated commenting",
        ],
      });
    }
  }

  if (ca.available && ca.total >= 20 && ca.genericShare !== null && ca.genericShare >= THRESHOLDS.genericShareMedium) {
    findings.push({
      name: "Generic comment pattern",
      severity: ca.genericShare >= THRESHOLDS.genericShareHigh ? "MEDIUM" : "LOW",
      evidence:
        `${fmtPct(ca.genericShare, 1)} of the ${fmtInt(ca.total)} analyzed comments are generic, ` +
        `emoji-only, or four characters or fewer (${fmtInt(ca.emojiOnly)} emoji-only, ` +
        `${fmtInt(ca.veryShort)} very short). Median comment length: ${fmtInt(ca.medianLength)} characters.`,
      confidence: "LOW",
      observed: `${fmtPct(ca.genericShare, 1)} of comments carry no specific content.`,
      interpretation: "Low-information comments dominate the sample.",
      possibleExplanations: [
        "normal social-media behaviour, which skews heavily to short reactions",
        "a large casual audience",
        "the sample being limited to the preview comments Instagram serves publicly",
        "low-effort automated commenting",
      ],
    });
  }

  if (eng.followersKnown && eng.medianEngagementRate !== null && eng.engagementRates.length >= 5) {
    const er = eng.medianEngagementRate;
    const followers = a.profile.followers!;
    // Published benchmarks sit roughly in 1%-6% and decline with account size.
    const expectedHigh = followers > 1_000_000 ? 0.04 : followers > 100_000 ? 0.06 : 0.1;
    const expectedLow = 0.005;

    if (er > expectedHigh || er < expectedLow) {
      const high = er > expectedHigh;
      findings.push({
        name: high ? "Engagement rate above typical band" : "Engagement rate below typical band",
        severity: "LOW",
        evidence:
          `Median engagement rate ${fmtPct(er, 2)} across ${eng.engagementRates.length} posts for an ` +
          `account with ${fmtInt(followers)} followers. Commonly published benchmarks for this size sit ` +
          `between ${fmtPct(expectedLow, 1)} and ${fmtPct(expectedHigh, 0)}.`,
        confidence: "LOW",
        observed: `Median engagement rate of ${fmtPct(er, 2)}.`,
        interpretation: "Outside the commonly cited benchmark band for this follower count.",
        possibleExplanations: high
          ? [
              "a genuinely engaged niche audience",
              "recent viral growth",
              "inflated engagement",
              "follower count lagging behind reach",
            ]
          : [
              "a large but passive audience",
              "an audience that has aged out of the content",
              "purchased or inactive followers",
              "reach suppression",
            ],
      });
    }
  }

  const order: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return findings.sort((x, y) => order[x.severity] - order[y.severity]);
}
