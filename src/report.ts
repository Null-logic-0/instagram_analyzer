import type { AnalysisBundle } from "./analysis.js";
import { THRESHOLDS } from "./config.js";
import { diagnostics } from "./diagnostics.js";
import type { Stats } from "./stats.js";
import type { Finding, Severity } from "./types.js";
import { NA, c, fmtBool, fmtInt, fmtNum, fmtPct, fmtText } from "./util.js";

export const WIDTH = 60;
export const RULE = "=".repeat(WIDTH);

export const out = (line = "") => console.log(line);

export function section(title: string): void {
  out();
  out(c.cyan(RULE));
  out(c.bold(c.cyan(title)));
  out(c.cyan(RULE));
  out();
}

export function kv(label: string, value: string, pad = 24): void {
  out(`${label.padEnd(pad)}${value}`);
}

export function severityTag(s: Severity): string {
  const tag = `[${s}]`.padEnd(9);
  if (s === "HIGH") return c.red(tag);
  if (s === "MEDIUM") return c.yellow(tag);
  return c.green(tag);
}

export function wrap(text: string, width = WIDTH, indent = ""): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const w of words) {
    if (line.length === 0) line = w;
    else if (`${line} ${w}`.length + indent.length <= width) line += ` ${w}`;
    else {
      lines.push(indent + line);
      line = w;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

export function note(text: string): void {
  for (const line of wrap(text, WIDTH - 6, "")) out(c.dim(`      ${line}`));
}

export function printWrapped(text: string, indent = ""): void {
  for (const l of wrap(text, WIDTH, indent)) out(l);
}

export function printBullet(text: string, indent = ""): void {
  wrap(text, WIDTH - indent.length - 2).forEach((l, i) => out(`${indent}${i === 0 ? "- " : "  "}${l}`));
}

function statBlock(label: string, s: Stats): void {
  kv(`  Average ${label}:`, fmtInt(s.mean), 26);
  note(`all ${label} added up, divided by the number of posts`);
  kv(`  Median ${label}:`, c.bold(fmtInt(s.median)), 26);
  note("the middle post. one viral post cannot drag this up, so it describes a normal post better than the average.");
  kv(`  Min ${label}:`, fmtInt(s.min), 26);
  note("the worst post");
  kv(`  Max ${label}:`, fmtInt(s.max), 26);
  note("the best post");
  kv("  Std deviation:", fmtInt(s.stdDev), 26);
  note(`how much ${label} jump around between posts. small means every post gets about the same.`);
  kv("  Sample size:", `${s.count} post(s)`, 26);
  note("how many posts these numbers come from");
}

function overallConfidence(a: AnalysisBundle, findings: Finding[]): Severity {
  const postsWithLikes = a.posts.filter((p) => p.likes !== null).length;
  const hasFollowers = a.profile.followers !== null && a.profile.followers > 0;
  const hasComments = a.commentAnalysis.available && a.commentAnalysis.total >= 50;
  const highs = findings.filter((f) => f.severity === "HIGH").length;

  if (postsWithLikes >= 30 && hasFollowers && hasComments && highs > 0) return "HIGH";
  if (postsWithLikes >= 10 && hasFollowers) return "MEDIUM";
  return "LOW";
}

function printProfile(a: AnalysisBundle): void {
  const p = a.profile;
  section("PROFILE");
  kv("Username:", `@${p.username}`, 20);
  kv("Display name:", fmtText(p.displayName, 60), 20);
  kv("Followers:", fmtInt(p.followers), 20);
  kv("Following:", fmtInt(p.following), 20);
  kv("Posts (total):", fmtInt(p.totalPosts), 20);
  kv("Private:", fmtBool(p.isPrivate), 20);
  kv("Verified:", fmtBool(p.isVerified), 20);
  kv("Category:", fmtText(p.category, 40), 20);
  kv("Account type:", fmtText(p.accountType, 40), 20);
  kv("External URL:", fmtText(p.externalUrl, 60), 20);
  kv("Profile picture:", p.profilePicUrl ? c.dim(fmtText(p.profilePicUrl, 60)) : NA, 20);
  out();
  out("Biography:");
  if (p.biography) printWrapped(p.biography, "  ");
  else out(`  ${NA}`);
  out();
  out("Profile URL:");
  out(`  ${p.profileUrl}`);
}

function printCollection(a: AnalysisBundle): void {
  section("DATA COLLECTION");
  kv("Posts discovered:", fmtInt(a.posts.length), 26);
  kv("Posts analyzed:", fmtInt(a.posts.length), 26);
  kv("Posts with like data:", fmtInt(a.posts.filter((x) => x.likes !== null).length), 26);
  kv("Posts with comment data:", fmtInt(a.posts.filter((x) => x.comments !== null).length), 26);
  kv("Comments analyzed:", a.commentAnalysis.available ? fmtInt(a.commentAnalysis.total) : "0 (unavailable)", 26);
  kv("Videos/Reels analyzed:", fmtInt(a.posts.filter((x) => x.type === "video" || x.type === "reel").length), 26);
  kv("Videos with view data:", fmtInt(a.video.withViews), 26);
  out();
  out(c.bold("Collection steps:"));

  for (const d of diagnostics) {
    const colour =
      d.status === "OK" ? c.green : d.status === "PARTIAL" ? c.yellow : d.status === "SKIPPED" ? c.gray : c.red;
    out(`  ${colour(`[${d.status}]`.padEnd(15))}${d.step}`);
    printWrapped(d.detail, "      ");
  }
}

function printEngagement(a: AnalysisBundle): void {
  const eng = a.engagement;
  section("ENGAGEMENT");

  if (eng.likeStats.count === 0 && eng.commentStats.count === 0) {
    printWrapped(
      "No like or comment counts were served for the discovered posts, so no engagement statistics could be computed.",
    );
    return;
  }

  out(c.bold("Likes"));
  statBlock("likes", eng.likeStats);
  out();
  out(c.bold("Comments"));
  statBlock("comments", eng.commentStats);
  out();
  out(c.bold("Rates (relative to follower count)"));

  if (!eng.followersKnown) {
    out(`  ${NA} - follower count unavailable or zero, so no rate can be computed.`);
  } else {
    kv("  Average like rate:", fmtPct(eng.avgLikeRate, 3), 26);
    kv("  Median like rate:", c.bold(fmtPct(eng.medianLikeRate, 3)), 26);
    note("out of 100 followers, how many press like on a post");
    kv("  Average comment rate:", fmtPct(eng.avgCommentRate, 3), 26);
    kv("  Median comment rate:", c.bold(fmtPct(eng.medianCommentRate, 3)), 26);
    note("out of 100 followers, how many write a comment");
    out();
    kv("  Average engagement:", fmtPct(eng.avgEngagementRate, 3), 26);
    kv("  Median engagement:", c.bold(c.green(fmtPct(eng.medianEngagementRate, 3))), 26);
    note("likes and comments together, as a share of followers. this is the number brands usually ask for.");
    out();
    printWrapped(
      "The MEDIAN engagement rate is the headline figure: a single viral post can inflate the average well beyond what a typical post achieves.",
      "  ",
    );
  }
  out();
  kv("Likes per comment:", fmtNum(eng.likesPerComment, 1), 26);
  note("how many likes arrive for each single comment. very high means people scroll and like but do not talk.");
}

function printVideo(a: AnalysisBundle): void {
  const video = a.video;
  section("VIDEO / REEL ANALYSIS");

  if (video.withViews === 0) {
    printWrapped(
      video.videoCount === 0
        ? "No video or reel posts were discovered."
        : `${video.videoCount} video/reel post(s) were discovered, but no view counts were served, so view-based ratios are unavailable.`,
    );
    return;
  }

  kv("Videos with views:", fmtInt(video.withViews), 26);
  kv("Median views:", c.bold(fmtInt(video.viewStats.median)), 26);
  kv("Average views:", fmtInt(video.viewStats.mean), 26);
  kv("Median likes (video):", fmtInt(video.likeStatsForVideos.median), 26);
  kv("Median comments (video):", fmtInt(video.commentStatsForVideos.median), 26);
  out();
  kv("View / like ratio:", fmtNum(video.medianViewToLike, 1), 26);
  note("how many people watch before one of them likes it");
  kv("View / comment ratio:", fmtNum(video.medianViewToComment, 1), 26);
  note("how many people watch before one of them comments");
  kv("Like / view rate:", c.bold(fmtPct(video.medianLikeToViewRate, 2)), 26);
  note("out of 100 viewers, how many press like. normally somewhere between 1 and 25.");
  kv("Comment / view rate:", c.bold(fmtPct(video.medianCommentToViewRate, 2)), 26);
  note("out of 100 viewers, how many write a comment. always much smaller than likes.");
  out();
  printWrapped(
    "Unusual relationships between views and engagement are reported as anomalies, not as evidence of fake engagement.",
    "  ",
  );
}

function printDistribution(a: AnalysisBundle): void {
  const dist = a.distribution;
  section("ENGAGEMENT DISTRIBUTION");

  if (!dist.sufficientData) {
    printWrapped(
      `Only ${dist.stats.count} post(s) carried like counts. At least 5 are needed before outlier detection is meaningful.`,
    );
    return;
  }

  kv("Median likes:", fmtInt(dist.stats.median), 26);
  note("the middle post");
  kv("Q1 / Q3:", `${fmtInt(dist.stats.q1)} / ${fmtInt(dist.stats.q3)}`, 26);
  note("a quarter of posts get less than the first number, a quarter get more than the second. most posts sit between them.");
  kv("IQR:", fmtInt(dist.stats.iqr), 26);
  note("the gap between those two. the normal range of this account.");
  kv("MAD:", fmtInt(dist.stats.mad), 26);
  note("typical distance from the middle post. used instead of the average because one huge post cannot break it.");
  kv("Coefficient of variation:", fmtNum(dist.stats.cv, 3), 26);
  note("how uneven the posts are. near 0 means every post gets almost the same, which is unusual for real reach.");
  kv("Top post / median:", dist.topMultipleOfMedian !== null ? `${fmtNum(dist.topMultipleOfMedian, 1)}x` : NA, 26);
  note("how many times bigger the best post is than a normal one");
  kv("Top post share of likes:", fmtPct(dist.topPostShare, 1), 26);
  note("how much of all the likes came from that single post");
  out();
  out(c.bold(`Statistical outliers detected: ${dist.outliers.length}`));
  note("posts that sit far outside the normal range for this account");
  out(c.dim("  Methods: z-score, MAD-based modified z-score, 1.5x IQR fence."));
  note("z and mz say how far a post is from normal. above 3 is far. a post can be far out for good reasons.");
  out();

  for (const o of dist.outliers.slice(0, 5)) {
    out(
      `  ${o.direction === "high" ? c.yellow("HIGH") : c.blue("LOW ")} ${fmtInt(o.value).padStart(10)} likes` +
        `  z=${o.z !== null ? fmtNum(o.z, 2).padStart(6) : "   N/A"}` +
        `  mz=${o.modifiedZ !== null ? fmtNum(o.modifiedZ, 2).padStart(6) : "   N/A"}` +
        `  ${o.multipleOfMedian !== null ? `${fmtNum(o.multipleOfMedian, 1)}x median` : ""}`,
    );
    out(c.dim(`       ${o.post.url}`));
  }

  if (dist.outliers.length > 0) {
    out();
    printWrapped(
      "An outlier is a statistical observation, not a verdict. Viral reach, paid promotion, collaborations and reposts by larger accounts all produce the same shape.",
      "  ",
    );
  }
}

function printComments(a: AnalysisBundle): void {
  const ca = a.commentAnalysis;
  section("COMMENT ANALYSIS");

  if (!ca.available) {
    out(c.yellow("  Comment data unavailable"));
    out();
    printWrapped(
      "No comment threads were served for this profile. Every other section of this report is unaffected and uses only the data that was collected.",
      "  ",
    );
    return;
  }

  kv("Comments analyzed:", fmtInt(ca.total), 32);
  note("how many comments we could read");
  kv("Posts covered:", fmtInt(ca.postsCovered), 32);
  note("how many posts those comments came from");
  kv("Unique commenters:", fmtInt(ca.uniqueCommenters), 32);
  note("how many different accounts wrote them");
  kv("Unique commenter share:", fmtPct(ca.uniqueCommenterPct, 1), 32);
  note("high means lots of different people. low means the same few keep writing.");
  kv("Repeated commenters:", fmtInt(ca.repeatedCommenters), 32);
  note("accounts that wrote more than one comment");
  kv("Repeated commenter share:", fmtPct(ca.repeatedCommenterPct, 1), 32);
  note("what part of the commenters they are");
  kv("Comments from repeaters:", fmtPct(ca.repeatCommentShare, 1), 32);
  note("what part of all comments they wrote. if a few accounts write most of them, that is worth a look.");
  out();
  kv("Duplicate comments:", `${fmtInt(ca.duplicateCount)} (${fmtPct(ca.duplicateShare, 1)})`, 32);
  note("exactly the same text written more than once");
  kv("Near-duplicate share:", fmtPct(ca.nearDuplicateShare, 1), 32);
  note("almost the same text, small changes only");
  kv("Emoji-only comments:", fmtInt(ca.emojiOnly), 32);
  note("comments with no words, only emoji");
  kv("Very short comments:", fmtInt(ca.veryShort), 32);
  note("four letters or fewer, like \"nice\"");
  kv("Generic comments:", `${fmtInt(ca.genericCount)} (${fmtPct(ca.genericShare, 1)})`, 32);
  note("empty praise, emoji only, or very short. normal people write a lot of these, so on its own it means little.");
  kv("Median comment length:", `${fmtInt(ca.medianLength)} chars`, 32);
  note("how long a typical comment is, in letters");

  if (ca.topCommenters.length > 0) {
    out();
    out(c.bold("Most frequent commenters:"));
    for (const t of ca.topCommenters.slice(0, 5)) {
      out(`  @${t.username.padEnd(28)} ${String(t.commentCount).padStart(4)} comments on ${t.postCount} post(s)`);
    }
    out();
    printWrapped("Repeat commenters are a signal for further investigation, not proof of bot activity.", "  ");
  }

  if (ca.repeatedPhrases.length > 0) {
    out();
    out(c.bold("Repeated phrases:"));
    for (const r of ca.repeatedPhrases.slice(0, 5)) {
      out(`  ${String(r.count).padStart(4)}x  "${fmtText(r.phrase, 44)}"`);
    }
  }
}

function printFindings(findings: Finding[]): void {
  section("ANOMALIES");

  if (findings.length === 0) {
    out(c.green("  No indicators were triggered by the data that could be collected."));
    out();
    printWrapped(
      "This is not a clean bill of health: it means nothing in the available sample crossed a threshold. Sparse data produces few indicators.",
      "  ",
    );
  } else {
    for (const f of findings) {
      out(`${severityTag(f.severity)}${f.name}`);
      out(`${" ".repeat(9)}${c.dim(`confidence: ${f.confidence}`)}`);
    }
  }

  section("EVIDENCE");

  if (findings.length === 0) {
    out("  No indicators, therefore no evidence to present.");
    return;
  }

  findings.forEach((f, i) => {
    out(c.bold(`${i + 1}. ${f.name}  ${severityTag(f.severity).trim()}`));
    out();
    out("   OBSERVED:");
    printWrapped(f.observed, "   ");
    out();
    out("   EVIDENCE:");
    printWrapped(f.evidence, "   ");
    out();
    out("   INTERPRETATION:");
    printWrapped(f.interpretation, "   ");
    out();
    out("   POSSIBLE EXPLANATIONS:");
    for (const e of f.possibleExplanations) printBullet(e, "   ");
    out();
    out(`   CONFIDENCE: ${f.confidence}`);
    out("   CONCLUSION: requires further investigation.");
    out();
  });
}

function printConclusion(a: AnalysisBundle, findings: Finding[]): void {
  section("CONCLUSION");
  const conf = overallConfidence(a, findings);
  const highs = findings.filter((f) => f.severity === "HIGH").length;

  if (findings.length === 0) {
    printWrapped(
      "The available data did not trigger any of the configured indicators. That is a statement about this sample, not a guarantee about the account.",
    );
  } else {
    printWrapped(
      "Several patterns associated with artificial or coordinated engagement were detected: " +
        `${findings.length} indicator(s), of which ${highs} ${highs === 1 ? "is" : "are"} HIGH severity.`,
    );
    out();
    printWrapped(
      "These signals do NOT prove the use of bots, purchased followers, or artificial engagement. Each one has legitimate explanations listed alongside it in the EVIDENCE section.",
    );
  }

  out();
  kv("Confidence:", conf === "HIGH" ? c.green(conf) : conf === "MEDIUM" ? c.yellow(conf) : c.red(conf), 20);
  out();
  printWrapped("Confidence here describes how much data supported the analysis - not how likely fraud is.", "  ");

  const hidden = a.posts.filter((p) => p.countsHidden === true).length;
  if (hidden > 0 && a.posts.length > 0 && hidden / a.posts.length >= THRESHOLDS.hiddenCountShareMedium) {
    out();
    out(c.yellow(c.bold("VERIFIABILITY")));
    out();
    printWrapped(
      `This account hides like counts on ${fmtPct(hidden / a.posts.length, 0)} of the analyzed posts, so its ` +
        "engagement cannot be independently checked against public data. That is a limitation of the audit, " +
        "not a finding about the account.",
    );
    out();
    printWrapped(
      "Before committing to a partnership, ask the account directly for Instagram Insights (reach, " +
        "impressions, saves, shares and audience demographics), or work through Instagram's Creator " +
        "Marketplace or an agency that can supply verified figures.",
    );
  }
}

function printLimitations(a: AnalysisBundle): void {
  section("LIMITATIONS");
  printWrapped(
    "This tool reads only what Instagram serves publicly to an unauthenticated client. It does not log in, use session cookies, solve CAPTCHAs, or work around rate limits.",
  );
  out();

  const unavailable = diagnostics.filter((d) => d.status !== "OK");
  if (unavailable.length > 0) {
    out("Data that was not fully available:");
    for (const d of unavailable) {
      out(`  - ${d.step} [${d.status}]`);
      printWrapped(d.detail, "      ");
    }
    out();
  }

  const approximate = a.posts.filter((x) => x.countsApproximate === true).length;
  const bullets = [
    ...(approximate > 0
      ? [
          `${approximate} post(s) only offered rounded link-preview counts (for example "203K likes"), so statistics involving them are approximate.`,
        ]
      : []),
    ...(a.posts.some((x) => x.countsHidden === true)
      ? [
          "Posts whose owner hid their like counts are excluded from the like statistics: Instagram emits a placeholder number for them, not a real count.",
        ]
      : []),
    "Shares and saves are never exposed publicly; they are always null.",
    "Impressions, reach, audience demographics and follower quality are visible only to the account owner, so no follower-authenticity percentage is produced.",
    "Comment threads served publicly are a preview, not the full thread, so comment statistics describe the sample, not the post.",
    "Thresholds are heuristics chosen for this tool, not industry standards.",
    "Every indicator is a prompt for human investigation. None is a conclusion.",
  ];

  for (const b of bullets) printBullet(b);
  out();
  out(c.cyan(RULE));
  out();
}

export function printReport(a: AnalysisBundle, findings: Finding[]): void {
  out();
  out(c.cyan(RULE));
  out(c.bold(c.cyan("             INSTAGRAM INFLUENCER AUDIT")));
  out(c.cyan(RULE));

  printProfile(a);
  printCollection(a);
  printEngagement(a);
  printVideo(a);
  printDistribution(a);
  printComments(a);
  printFindings(findings);
  printConclusion(a, findings);
  printLimitations(a);
}
