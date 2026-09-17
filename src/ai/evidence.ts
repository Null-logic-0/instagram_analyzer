import type { AnalysisBundle } from "../analysis.js";
import type { Finding } from "../types.js";
import {
  buildBehavioralFeatures,
  buildCommenterActivity,
  buildCoordinationEvidence,
  buildPostingRhythm,
  type BehavioralFeatures,
  type CoordinationEvidence,
  type PostingRhythm,
} from "./features.js";
import { sampleComments } from "./sampling.js";
import { scoreEvidence, type SignalScore } from "./score.js";

export interface ProfileEvidence {
  username: string;
  followers: number | null;
  following: number | null;
  totalPosts: number | null;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  category: string | null;
  followerToFollowingRatio: number | null;
  postsAnalyzed: number;
  postsWithLikeData: number;
  postsWithHiddenCounts: number;
}

export interface EngagementEvidence {
  averageLikes: number | null;
  medianLikes: number | null;
  averageComments: number | null;
  medianComments: number | null;
  averageViews: number | null;
  medianViews: number | null;
  averageEngagementRate: number | null;
  medianEngagementRate: number | null;
  likeToFollowerRatio: number | null;
  commentToFollowerRatio: number | null;
  likeToViewRatio: number | null;
  commentToViewRatio: number | null;
  likesPerComment: number | null;
  likeStdDev: number | null;
  likeCoefficientOfVariation: number | null;
  likeIqr: number | null;
  likeMad: number | null;
  outlierCount: number;
  topPostMultipleOfMedian: number | null;
  videosWithViews: number;
}

export interface CommentEvidence {
  available: boolean;
  total: number;
  postsCovered: number;
  uniqueCommenters: number;
  repeatedCommenters: number;
  duplicateRatio: number | null;
  nearDuplicateRatio: number | null;
  shortCommentRatio: number | null;
  emojiOnlyRatio: number | null;
  genericRatio: number | null;
  medianLength: number | null;
  repeatedPhrases: { phrase: string; count: number }[];
  representativeComments: string[];
  samplingNote: string;
}

export interface HistoricalEvidence {
  available: boolean;
  note: string;
}

export interface FraudEvidence {
  profile: ProfileEvidence;
  engagement: EngagementEvidence;
  behavioral: BehavioralFeatures;
  comments: CommentEvidence;
  coordination: CoordinationEvidence;
  rhythm: PostingRhythm;
  historical: HistoricalEvidence;
  anomalies: Finding[];
  signalScore: SignalScore;
}

export function buildEvidence(bundle: AnalysisBundle, findings: Finding[]): FraudEvidence {
  const { profile, posts, comments, engagement, video, distribution, commentAnalysis: ca } = bundle;

  const activity = buildCommenterActivity(comments);
  const hidden = posts.filter((p) => p.countsHidden === true).length;

  const evidence: FraudEvidence = {
    profile: {
      username: profile.username,
      followers: profile.followers,
      following: profile.following,
      totalPosts: profile.totalPosts,
      isVerified: profile.isVerified,
      isPrivate: profile.isPrivate,
      category: profile.category,
      followerToFollowingRatio:
        profile.followers !== null && profile.following !== null && profile.following > 0
          ? profile.followers / profile.following
          : null,
      postsAnalyzed: posts.length,
      postsWithLikeData: posts.filter((p) => p.likes !== null).length,
      postsWithHiddenCounts: hidden,
    },

    engagement: {
      averageLikes: engagement.likeStats.mean,
      medianLikes: engagement.likeStats.median,
      averageComments: engagement.commentStats.mean,
      medianComments: engagement.commentStats.median,
      averageViews: video.viewStats.mean,
      medianViews: video.viewStats.median,
      averageEngagementRate: engagement.avgEngagementRate,
      medianEngagementRate: engagement.medianEngagementRate,
      likeToFollowerRatio: engagement.medianLikeRate,
      commentToFollowerRatio: engagement.medianCommentRate,
      likeToViewRatio: video.medianLikeToViewRate,
      commentToViewRatio: video.medianCommentToViewRate,
      likesPerComment: engagement.likesPerComment,
      likeStdDev: engagement.likeStats.stdDev,
      likeCoefficientOfVariation: engagement.likeStats.cv,
      likeIqr: engagement.likeStats.iqr,
      likeMad: engagement.likeStats.mad,
      outlierCount: distribution.outliers.length,
      topPostMultipleOfMedian: distribution.topMultipleOfMedian,
      videosWithViews: video.withViews,
    },

    behavioral: buildBehavioralFeatures(comments, activity),

    comments: {
      available: ca.available,
      total: ca.total,
      postsCovered: ca.postsCovered,
      uniqueCommenters: ca.uniqueCommenters,
      repeatedCommenters: ca.repeatedCommenters,
      duplicateRatio: ca.duplicateShare,
      nearDuplicateRatio: ca.nearDuplicateShare,
      shortCommentRatio: ca.total > 0 ? ca.veryShort / ca.total : null,
      emojiOnlyRatio: ca.total > 0 ? ca.emojiOnly / ca.total : null,
      genericRatio: ca.genericShare,
      medianLength: ca.medianLength,
      repeatedPhrases: ca.repeatedPhrases.slice(0, 10),
      representativeComments: sampleComments(comments, activity),
      samplingNote:
        "Instagram serves only a preview of each comment thread to logged-out clients. " +
        "These counts describe the collected sample, not the full threads.",
    },

    coordination: buildCoordinationEvidence(comments, activity),
    rhythm: buildPostingRhythm(posts),

    historical: {
      available: false,
      note: "This tool does not persist snapshots between runs, so follower and engagement growth over time cannot be assessed.",
    },

    anomalies: findings,

    // score needs the finished evidence, so it is filled in below
    signalScore: EMPTY_SCORE,
  };

  return { ...evidence, signalScore: scoreEvidence(evidence) };
}

const EMPTY_SCORE: SignalScore = {
  score: 0,
  band: "CLEAN",
  verdict: "",
  coverage: 0,
  components: [],
  missing: [],
};
