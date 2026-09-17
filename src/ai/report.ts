import { RULE, kv, note, out, printBullet, printWrapped, section, severityTag } from "../report.js";
import { c, fmtInt, fmtNum, fmtPct } from "../util.js";
import type { AIAnalysisResult } from "./fraud.js";
import type { ScoreBand, SignalScore } from "./score.js";

function heading(title: string): void {
  out();
  out(c.bold(title));
  out("-".repeat(RULE.length));
  out();
}

function bandColor(band: ScoreBand): (s: string) => string {
  if (band === "STRONG") return c.red;
  if (band === "MIXED") return c.yellow;
  if (band === "LOW") return c.blue;
  return c.green;
}

function scoreBar(score: number): string {
  const filled = Math.round((score / 100) * 40);
  return `[${"#".repeat(filled)}${"-".repeat(40 - filled)}]`;
}

export function printVerdict(score: SignalScore): void {
  section("                   FINAL VERDICT");

  const tint = bandColor(score.band);
  kv("Bot / fake-engagement score:", tint(c.bold(`${score.score} / 100`)), 30);
  note("0 means nothing suspicious was found. 100 means many suspicious things were found at once.");
  kv("Band:", tint(c.bold(score.band)), 30);
  note("CLEAN = looks normal. LOW = weak signs. MIXED = part of it may be fake. STRONG = many signs, be careful.");
  out();
  out(`  ${tint(scoreBar(score.score))}`);
  out(c.dim("   0 = no signals                        100 = strong signals"));
  out();
  printWrapped(score.verdict, "  ");
  out();
  printWrapped(
    "A higher score means more independent signals consistent with bot or coordinated engagement; a lower score means fewer. It measures signal strength in the collected sample, not a verified count of fake followers.",
    "  ",
  );

  heading("SCORE BREAKDOWN");
  out(c.dim("  each line is one check. left number is the points it gave,"));
  out(c.dim("  right number is the most it could give. under it is why."));
  out();
  for (const component of score.components) {
    if (component.value === null) continue;
    const points = component.weight * component.value;
    out(
      `  ${component.name.padEnd(32)}${fmtNum(points, 1).padStart(5)} / ${String(component.weight).padStart(2)}`,
    );
    out(c.dim(`    ${component.evidence}`));
  }

  if (score.missing.length > 0) {
    out();
    out(c.dim("  Not scored, no data available:"));
    for (const name of score.missing) out(c.dim(`    - ${name}`));
    out();
    printWrapped(
      `Scoring covered ${fmtPct(score.coverage, 0)} of the available weight. Components without data are excluded rather than scored zero, so a thin sample cannot look like a clean account.`,
      "  ",
    );
  }
}

export function printAiReport(result: AIAnalysisResult): void {
  const ev = result.evidence;

  printVerdict(ev.signalScore);

  section("                 AI FRAUD ANALYSIS");

  if (!result.ok) {
    out(c.yellow("  AI interpretation unavailable"));
    out();
    printWrapped(result.detail, "  ");
    out();
    printWrapped(
      "The score and statistics above are unaffected: they are computed in TypeScript and do not depend on the model. Start Ollama and re-run to add the written interpretation.",
      "  ",
    );
    out();
    out(c.cyan(RULE));
    out();
    return;
  }

  const { analysis } = result;
  const tone = (s: string) => (s === "HIGH" ? c.red(s) : s === "MEDIUM" ? c.yellow(s) : c.green(s));

  kv("Assessment:", tone(analysis.assessment), 14);
  note("how much the ai thinks this account needs a closer look");
  kv("Confidence:", tone(analysis.confidence), 14);
  note("how much data there was to judge from. not how likely fraud is.");
  out();
  out(c.dim(`  model: ${result.model} · ${(result.durationMs / 1000).toFixed(1)}s`));

  if (analysis.strongestSignals.length > 0) {
    heading("STRONGEST SIGNALS");
    for (const s of analysis.strongestSignals) {
      out(`${severityTag(s.severity)}${s.signal}`);
      out();
      out("  Evidence:");
      printWrapped(s.evidence, "  ");
      out();
      out("  Analysis:");
      printWrapped(s.explanation, "  ");
      out();
    }
  }

  if (analysis.weakSignals.length > 0) {
    heading("WEAK SIGNALS");
    for (const s of analysis.weakSignals) printBullet(`${s.signal} — ${s.evidence}`);
  }

  if (analysis.legitimateExplanations.length > 0) {
    heading("LEGITIMATE EXPLANATIONS");
    for (const e of analysis.legitimateExplanations) printBullet(e);
  }

  if (analysis.missingEvidence.length > 0) {
    heading("MISSING EVIDENCE");
    for (const m of analysis.missingEvidence) printBullet(m);
  }

  if (analysis.recommendedNextChecks.length > 0) {
    heading("RECOMMENDED NEXT CHECKS");
    analysis.recommendedNextChecks.forEach((check, i) => {
      wrapNumbered(check, i + 1).forEach((line, j) => out(j === 0 ? line : `   ${line}`));
    });
  }

  heading("SUMMARY");
  printWrapped(analysis.summary);

  heading("EVIDENCE THE MODEL WAS GIVEN");
  out(c.dim("  Every figure above had to come from these deterministic values."));
  out();
  kv("  Posts analyzed:", fmtInt(ev.profile.postsAnalyzed), 30);
  kv("  Median likes:", fmtInt(ev.engagement.medianLikes), 30);
  kv("  Median engagement:", fmtPct(ev.engagement.medianEngagementRate, 3), 30);
  kv("  Comments analyzed:", fmtInt(ev.comments.total), 30);
  kv("  Distinct commenters:", fmtInt(ev.coordination.distinctCommenters), 30);
  kv("  Top 5% of accounts:", fmtPct(ev.coordination.concentrationTop5Pct, 1), 30);
  kv("  Gini (comments/account):", fmtNum(ev.coordination.giniCoefficient, 3), 30);
  kv("  Duplicate comments:", fmtPct(ev.comments.duplicateRatio, 1), 30);
  kv("  Recurring account pairs:", fmtInt(ev.coordination.recurringPairs.length), 30);
  kv("  Comments sampled for AI:", fmtInt(ev.comments.representativeComments.length), 30);
  kv("  Deterministic indicators:", fmtInt(ev.anomalies.length), 30);

  out();
  out(c.cyan(RULE));
  out();
}

function wrapNumbered(text: string, index: number): string[] {
  const prefix = `${index}. `;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = prefix;

  for (const w of words) {
    if (line === prefix) line += w;
    else if (`${line} ${w}`.length <= RULE.length) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line.trim()) lines.push(line);
  return lines;
}
