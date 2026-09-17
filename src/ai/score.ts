import { THRESHOLDS } from "../config.js";
import type { FraudEvidence } from "./evidence.js";

export type ScoreBand = "CLEAN" | "LOW" | "MIXED" | "STRONG";

export interface ScoreComponent {
  name: string;
  /** Share of the total score this component can contribute. */
  weight: number;
  /** 0..1 within this component, or null when the data was unavailable. */
  value: number | null;
  /** The measured figure this score came from. */
  evidence: string;
}

export interface SignalScore {
  /** 0-100. Higher means more signals consistent with artificial engagement. */
  score: number;
  band: ScoreBand;
  verdict: string;
  /** Share of the weighting that had data behind it. */
  coverage: number;
  components: ScoreComponent[];
  missing: string[];
}

/**
 * Scales a measurement into 0..1 between a floor and a ceiling.
 * At or below `floor` scores 0; at or above `ceiling` scores 1.
 */
function ramp(value: number | null, floor: number, ceiling: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (ceiling === floor) return 0;
  return Math.max(0, Math.min(1, (value - floor) / (ceiling - floor)));
}

function pct(value: number | null, digits = 1): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(digits)}%`;
}

/**
 * A transparent, deterministic index of how many independent signals point at
 * artificial or coordinated engagement. Computed in TypeScript, never by the
 * model, so the same evidence always produces the same number.
 *
 * It scores SIGNAL STRENGTH in the collected sample. It is not an estimate of
 * what share of an audience is fake: nothing here can measure that, and any
 * component whose data is missing is excluded rather than scored zero, so a
 * thin sample cannot masquerade as a clean result.
 */
export function scoreEvidence(ev: FraudEvidence): SignalScore {
  const { comments: cm, coordination: co, behavioral: bh, engagement: en } = ev;
  const hasComments = cm.available && cm.total >= 20;

  const components: ScoreComponent[] = [
    {
      name: "Commenter concentration",
      weight: 20,
      value: hasComments ? ramp(co.concentrationTop5Pct, 0.15, 0.6) : null,
      evidence: `top 5% of accounts produced ${pct(co.concentrationTop5Pct)} of comments` +
        (co.giniCoefficient !== null ? `, gini ${co.giniCoefficient.toFixed(3)}` : ""),
    },
    {
      name: "Accounts recurring across posts",
      weight: 20,
      value: hasComments && co.distinctCommenters > 0
        ? ramp(bh.accountsOnManyPosts / co.distinctCommenters, 0.02, 0.25)
        : null,
      evidence: `${bh.accountsOnManyPosts} of ${co.distinctCommenters} accounts appear on 3+ posts` +
        `, ${co.recurringPairs.length} account pairs co-occur repeatedly`,
    },
    {
      name: "Duplicate comment text",
      weight: 15,
      value: hasComments
        ? ramp(Math.max(cm.duplicateRatio ?? 0, cm.nearDuplicateRatio ?? 0), 0.05, 0.4)
        : null,
      evidence: `${pct(cm.duplicateRatio)} exact duplicates, ${pct(cm.nearDuplicateRatio)} near-duplicates`,
    },
    {
      name: "Comment timing clustering",
      weight: 15,
      value: hasComments && bh.timestampsAvailable ? ramp(bh.engagementBurstRate, 0.1, 0.6) : null,
      evidence: bh.timestampsAvailable
        ? `${pct(bh.engagementBurstRate)} of comments land within 60s of another on the same post`
        : "comment timestamps unavailable",
    },
    {
      name: "Engagement distribution anomaly",
      weight: 10,
      value: en.outlierCount > 0 || en.topPostMultipleOfMedian !== null
        ? ramp(en.topPostMultipleOfMedian, 3, 15)
        : null,
      evidence: en.topPostMultipleOfMedian !== null
        ? `top post is ${en.topPostMultipleOfMedian.toFixed(1)}x the median, ${en.outlierCount} outlier(s)`
        : "insufficient like data",
    },
    {
      name: "Like/comment ratio",
      weight: 10,
      value: en.likesPerComment !== null
        ? Math.max(
            ramp(en.likesPerComment, THRESHOLDS.likesPerCommentHigh, THRESHOLDS.likesPerCommentHigh * 3) ?? 0,
            ramp(-en.likesPerComment, -THRESHOLDS.likesPerCommentLow, 0) ?? 0,
          )
        : null,
      evidence: en.likesPerComment !== null
        ? `${en.likesPerComment.toFixed(1)} likes per comment`
        : "insufficient data",
    },
    {
      name: "Generic comment share",
      weight: 10,
      value: hasComments ? ramp(cm.genericRatio, 0.4, 0.85) : null,
      evidence: `${pct(cm.genericRatio)} generic, emoji-only or very short`,
    },
  ];

  // Components without data are dropped rather than scored zero, so missing
  // evidence never reads as a clean account.
  const scored = components.filter((c) => c.value !== null);
  const availableWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const coverage = totalWeight > 0 ? availableWeight / totalWeight : 0;

  const score =
    availableWeight > 0
      ? Math.round(scored.reduce((sum, c) => sum + c.weight * (c.value ?? 0), 0) / availableWeight * 100)
      : 0;

  const band: ScoreBand = score >= 75 ? "STRONG" : score >= 50 ? "MIXED" : score >= 25 ? "LOW" : "CLEAN";

  const verdict =
    availableWeight === 0
      ? "Not enough data was collected to score this account."
      : band === "STRONG"
        ? "Multiple independent signals are consistent with artificial or coordinated engagement. Treat this account as high risk until the checks below are done."
        : band === "MIXED"
          ? "Mixed picture. Some measurements are consistent with artificial or coordinated engagement while others look ordinary. Part of the engagement may be inauthentic."
          : band === "LOW"
            ? "Weak and mostly isolated signals. Nothing in this sample points clearly at artificial engagement."
            : "No meaningful signals of artificial or coordinated engagement in the collected sample.";

  return {
    score,
    band,
    verdict,
    coverage,
    components,
    missing: components.filter((c) => c.value === null).map((c) => c.name),
  };
}
