export type Severity = "LOW" | "MEDIUM" | "HIGH";

export type Json = Record<string, unknown>;

export interface ProfileData {
  username: string;
  displayName: string | null;
  biography: string | null;
  profilePicUrl: string | null;
  followers: number | null;
  following: number | null;
  totalPosts: number | null;
  profileUrl: string;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  externalUrl: string | null;
  category: string | null;
  accountType: string | null;
  userId: string | null;
}

export interface PostData {
  url: string;
  type: "photo" | "video" | "reel" | "carousel" | "unknown";
  publishedAt: string | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  shares: number | null;
  saves: number | null;

  shortcode?: string;
  countsHidden?: boolean;
  countsApproximate?: boolean;
}

export interface CommentData {
  postUrl: string;
  text: string | null;
  username: string | null;
  timestamp: string | null;
  likes: number | null;
}

export interface Indicator {
  name: string;
  severity: Severity;
  evidence: string;
  confidence: Severity;
}

export interface Finding extends Indicator {
  observed: string;
  interpretation: string;
  possibleExplanations: string[];
}

export type FailureKind =
  | "LOGIN_REQUIRED"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "NOT_FOUND"
  | "PRIVATE_ACCOUNT"
  | "NETWORK"
  | "TIMEOUT"
  | "PARSE"
  | "NOT_SERVED"
  | "CONFIG";

export type StepStatus = "OK" | "PARTIAL" | "UNAVAILABLE" | "SKIPPED";

export interface StepReport {
  step: string;
  status: StepStatus;
  detail: string;
}
