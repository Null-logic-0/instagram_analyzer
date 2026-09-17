import type { AnalysisBundle } from "../analysis.js";
import { AI_ENABLED, MAX_AI_COMMENTS } from "../config.js";
import type { Finding, Severity } from "../types.js";
import { buildEvidence, type FraudEvidence } from "./evidence.js";
import { OllamaClient, OllamaError, type ChatMessage } from "./ollama.js";

export interface AIFraudAnalysis {
  assessment: Severity;
  confidence: Severity;
  strongestSignals: {
    signal: string;
    severity: Severity;
    evidence: string;
    explanation: string;
  }[];
  weakSignals: { signal: string; evidence: string }[];
  legitimateExplanations: string[];
  missingEvidence: string[];
  recommendedNextChecks: string[];
  summary: string;
}

export type AIAnalysisResult =
  | { ok: true; analysis: AIFraudAnalysis; model: string; durationMs: number; evidence: FraudEvidence }
  | { ok: false; detail: string; evidence: FraudEvidence };

const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const SYSTEM_PROMPT = `You are analyzing Instagram engagement for potential artificial, coordinated, or low-quality engagement.

You are NOT a definitive bot detector.

Analyze the supplied evidence. Distinguish between:
1. Observed facts
2. Statistical anomalies
3. Behavioral anomalies
4. Coordination signals
5. Possible artificial-engagement signals
6. Legitimate alternative explanations
7. Missing evidence

RULES YOU MUST FOLLOW:

- Do not invent statistics. Every number you cite must appear in the evidence object you were given. If a figure is null or absent, say it is unavailable rather than estimating it.
- Do not calculate new statistics. All arithmetic has already been done for you.
- Do not claim an account uses bots unless the evidence actually supports that conclusion. Prefer "multiple signals are consistent with potentially coordinated or artificial engagement".
- Never output a fabricated precision figure such as "87% of followers are bots". You have no follower-quality data and no validated model for such a claim.
- A single suspicious signal is insufficient. Weigh multiple independent signals together.
- Every conclusion must reference measurable evidence. Write "repeated commenter concentration is high: 2.1% of commenters produced 17.8% of comments" rather than "this account looks fake".

HOW TO WEIGH COMBINATIONS:

Concerning combinations are ones where independent signal types agree, for example:
  high repeated-commenter concentration + high comment similarity + tight comment timing + the same accounts recurring across many posts.

Reassuring combinations look like:
  high engagement + many distinct commenters + a normal engagement distribution + varied comment text.

A generic emoji comment on its own is a weak signal; short reactions dominate normal social media. A group of accounts recurring across many posts with similar text and clustered timing is a much stronger signal and deserves more weight.

RANK your signals by strength, independence from each other, reliability of the underlying measurement, and how well an innocent explanation accounts for them.

A deterministic signal score (0-100) has already been computed from this evidence and is included as signalScore. It is the project's own measurement, not yours. Your assessment must be consistent with it and with the severities you assign: if you list HIGH severity signals, or the score is 50 or above, the assessment cannot be LOW. Explain the score rather than recomputing or contradicting it.

Assessment means: how much the evidence warrants further investigation.
Confidence means: how much data supported your judgement, NOT how likely fraud is. Sparse data means LOW confidence whatever the assessment.

Respond with JSON only.`;

function responseSchema(): Record<string, unknown> {
  const severity = { type: "string", enum: [...SEVERITIES] };
  const stringArray = { type: "array", items: { type: "string" } };

  return {
    type: "object",
    properties: {
      assessment: severity,
      confidence: severity,
      strongestSignals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            signal: { type: "string" },
            severity,
            evidence: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["signal", "severity", "evidence", "explanation"],
        },
      },
      weakSignals: {
        type: "array",
        items: {
          type: "object",
          properties: { signal: { type: "string" }, evidence: { type: "string" } },
          required: ["signal", "evidence"],
        },
      },
      legitimateExplanations: stringArray,
      missingEvidence: stringArray,
      recommendedNextChecks: stringArray,
      summary: { type: "string" },
    },
    required: [
      "assessment",
      "confidence",
      "strongestSignals",
      "weakSignals",
      "legitimateExplanations",
      "missingEvidence",
      "recommendedNextChecks",
      "summary",
    ],
  };
}

function round(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) < 1 ? Number(value.toFixed(5)) : Number(value.toFixed(2));
  }
  if (Array.isArray(value)) return value.map(round);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
  }
  return value;
}

function buildMessages(evidence: FraudEvidence, strict = false): ChatMessage[] {
  const payload = JSON.stringify(round(evidence), null, 1);
  const instruction = strict
    ? "Your previous reply was not valid JSON. Return ONLY a JSON object matching the schema, with no prose, no markdown and no code fences.\n\n"
    : "";

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `${instruction}Analyze this evidence object. Every figure you cite must come from it.\n` +
        `The representative comments are a sample of at most ${MAX_AI_COMMENTS}, not the full set.\n\n` +
        `${payload}`,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asSeverity(value: unknown): Severity | null {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value.toUpperCase())
    ? (value.toUpperCase() as Severity)
    : null;
}

function asStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, limit);
}

export function parseAnalysis(raw: unknown): AIFraudAnalysis | null {
  if (!isRecord(raw)) return null;

  const assessment = asSeverity(raw.assessment);
  const confidence = asSeverity(raw.confidence);
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!assessment || !confidence || summary.length === 0) return null;

  const strongestSignals = (Array.isArray(raw.strongestSignals) ? raw.strongestSignals : [])
    .filter(isRecord)
    .map((s) => ({
      signal: typeof s.signal === "string" ? s.signal : "",
      severity: asSeverity(s.severity) ?? "LOW",
      evidence: typeof s.evidence === "string" ? s.evidence : "",
      explanation: typeof s.explanation === "string" ? s.explanation : "",
    }))
    .filter((s) => s.signal.length > 0 && s.evidence.length > 0)
    .slice(0, 10);

  const weakSignals = (Array.isArray(raw.weakSignals) ? raw.weakSignals : [])
    .filter(isRecord)
    .map((s) => ({
      signal: typeof s.signal === "string" ? s.signal : "",
      evidence: typeof s.evidence === "string" ? s.evidence : "",
    }))
    .filter((s) => s.signal.length > 0)
    .slice(0, 10);

  return {
    assessment,
    confidence,
    strongestSignals,
    weakSignals,
    legitimateExplanations: asStringArray(raw.legitimateExplanations),
    missingEvidence: asStringArray(raw.missingEvidence),
    recommendedNextChecks: asStringArray(raw.recommendedNextChecks),
    summary,
  };
}

export async function analyzeInfluencerWithAI(
  bundle: AnalysisBundle,
  findings: Finding[],
  client = new OllamaClient(),
): Promise<AIAnalysisResult> {
  const evidence = buildEvidence(bundle, findings);

  if (!AI_ENABLED) {
    return { ok: false, detail: "AI analysis is disabled (AI_ENABLED is false in src/config.ts).", evidence };
  }

  const status = await client.status();
  if (!status.ready) return { ok: false, detail: status.detail, evidence };

  const started = Date.now();
  const schema = responseSchema();

  // second try asks for strict json only
  for (const strict of [false, true]) {
    try {
      const raw = await client.chatJson({
        messages: buildMessages(evidence, strict),
        format: schema,
        options: { temperature: 0 },
      });
      const analysis = parseAnalysis(raw);
      if (analysis) {
        return { ok: true, analysis, model: client.model, durationMs: Date.now() - started, evidence };
      }
      if (strict) {
        return { ok: false, detail: "The model returned JSON that did not match the required shape.", evidence };
      }
    } catch (err) {
      const retryable = err instanceof OllamaError && err.kind === "bad_response";
      if (retryable && !strict) continue;
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, detail, evidence };
    }
  }

  return { ok: false, detail: "The model did not return a usable analysis.", evidence };
}
