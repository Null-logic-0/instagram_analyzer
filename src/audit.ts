import {
  analyzeComments,
  analyzeDistribution,
  analyzeEngagement,
  analyzeVideos,
  type AnalysisBundle,
} from "./analysis.js";
import { AI_ENABLED, REQUEST_DELAY_MS } from "./config.js";
import { note } from "./diagnostics.js";
import { CollectionError, friendlyFailure } from "./errors.js";
import { isStopped } from "./http.js";
import { analyzeInfluencerWithAI } from "./ai/fraud.js";
import { printAiReport } from "./ai/report.js";
import { buildFindings } from "./indicators.js";
import { collectProfile, emptyProfile, parseProfileUrl } from "./profile.js";
import { discoverPosts, enrichPosts } from "./posts.js";
import { printReport } from "./report.js";
import type { CommentData, PostData, ProfileData } from "./types.js";
import { c } from "./util.js";

const write = (s: string) => process.stdout.write(s);

export async function runAudit(input: string): Promise<void> {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < 18) {
    console.error(c.red(`Node 18+ is required. You are on ${process.versions.node}.`));
    process.exitCode = 1;
    return;
  }

  let username: string;
  let profileUrl: string;
  try {
    ({ username, profileUrl } = parseProfileUrl(input));
  } catch (err) {
    console.error();
    console.error(c.red("Cannot start:"));
    console.error(`  ${err instanceof CollectionError ? friendlyFailure(err) : String(err)}`);
    console.error();
    console.error('  Expected:  const INSTAGRAM_PROFILE_URL = "https://www.instagram.com/<username>/";');
    console.error();
    process.exitCode = 1;
    return;
  }

  write(c.dim(`\nAuditing @${username} (${profileUrl})\n`));
  write(c.dim(`Politeness delay: ${REQUEST_DELAY_MS} ms between requests. This takes a while.\n\n`));

  let profile: ProfileData = emptyProfile(username, profileUrl);
  let posts: PostData[] = [];
  let comments: CommentData[] = [];

  try {
    write(c.dim("  Reading profile...\n"));
    const result = await collectProfile(username, profileUrl);
    profile = result.profile;

    if (profile.isPrivate === true) {
      note(
        "Access",
        "PARTIAL",
        "The account is private. Only the profile header is public; no media or comments were collected.",
      );
    }

    write(c.dim("  Discovering posts and reels...\n"));
    posts = await discoverPosts(profile, result.seedPosts, result.endCursor, result.profileHtml);

    write(c.dim("  Collecting post metrics and comments...\n"));
    const enriched = await enrichPosts(posts);
    posts = enriched.posts;
    comments = enriched.comments;

    write(c.dim("  Analyzing...\n"));
  } catch (err) {
    const why = err instanceof CollectionError ? friendlyFailure(err) : String(err);
    note("Collection", "UNAVAILABLE", why);
    write(c.yellow(`\n  Collection stopped: ${why}\n`));
    write(c.dim("  Continuing with whatever data was already obtained.\n"));
  }

  const stop = isStopped();
  if (stop) {
    note("Instagram access", "UNAVAILABLE", `${stop.message} No attempt was made to circumvent it.`);
  }

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
  printReport(bundle, findings);

  // ai runs last. if it fails the report above is already on screen.
  if (AI_ENABLED) {
    write(c.dim("  Running AI fraud analysis...\n"));
    try {
      printAiReport(await analyzeInfluencerWithAI(bundle, findings));
    } catch (err) {
      write(c.yellow(`  AI analysis failed: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }
}
