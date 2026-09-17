# Instagram Influencer Audit

A terminal tool that audits a public Instagram account for signs of bot or
coordinated engagement.

You give it one profile URL. It collects what Instagram serves publicly, runs
statistics on it, gives a **0–100 score**, and prints a full report.

It never logs in, never uses cookies, never solves CAPTCHAs, and never works
around rate limits. Anything Instagram does not serve is reported as `N/A` or
`null` — never estimated or invented.

---

## Requirements

- **Node 18+** (tested on 22) — nothing else is required to run an audit
- **Ollama** — optional, only for the written AI interpretation

## Install

```bash
npm install
```

---

## Run

Pass a URL directly:

```bash
npx tsx index.ts "https://www.instagram.com/someusername/"
```

Or set your usual target in `index.ts` and run with no argument:

```ts
const USERNAME = "someusername";
```

```bash
npm run audit
```

A command-line URL always overrides the constant in the file.

Save the report, since it is long:

```bash
npx tsx index.ts "https://www.instagram.com/someusername/" | tee report.txt
```

### How long it takes

**3–5 minutes.** There is a deliberate 1.5-second delay between requests. The
tool prints progress while it works:

```
Auditing @someone (https://www.instagram.com/someone/)
  Reading profile...
  Discovering posts and reels...
  Collecting post metrics and comments...
  Post 12/12 - comments collected: 131
  Analyzing...
  Running AI fraud analysis...
```

---

## Turning on the AI interpretation

The AI part is optional. Without it you still get the complete report and the
score — only the written explanation is missing.

Start Ollama in a **separate terminal** and leave it running:

```bash
ollama serve
```

Make sure the model is installed:

```bash
ollama pull llama3.2
```

Then run the audit as normal. To stop Ollama afterwards, press `Ctrl+C` in that
terminal.

---

## Reading the result

### The score

```
Bot / fake-engagement score:  16 / 100
Band:                         CLEAN

  [######----------------------------------]
```

| Band | Score | Meaning |
| --- | --- | --- |
| `CLEAN` | 0–24 | No meaningful signals in the sample |
| `LOW` | 25–49 | Weak, mostly isolated signals |
| `MIXED` | 50–74 | Part of the engagement may be inauthentic |
| `STRONG` | 75–100 | Multiple independent signals; treat as high risk |

Higher means more signals consistent with bot or coordinated engagement. It
measures **signal strength in the collected sample**, not a verified count of
fake followers.

### Where the score comes from

Seven measurements, weighted by how reliable each one is:

| Measurement | Weight |
| --- | --- |
| Commenter concentration — do a few accounts write most comments? | 20 |
| Accounts recurring across posts — the same people everywhere? | 20 |
| Duplicate comment text — the same words repeated? | 15 |
| Comment timing clustering — comments seconds apart? | 15 |
| Engagement distribution — one post far above the rest? | 10 |
| Like/comment ratio — an unusual balance? | 10 |
| Generic comments — only `nice`, `🔥`, `😍`? | 10 |

A single measurement means little. Several together mean something.

**Missing data is skipped, not scored zero.** An account with thin data will
never look "clean" just because nothing could be measured. The report shows how
much of the scoring weight actually had data behind it.

### Report sections

```
PROFILE                followers, bio, verified, links
DATA COLLECTION        what was collected and what failed
ENGAGEMENT             average and median likes, comments, rates
VIDEO / REEL ANALYSIS  views and view-based ratios
ENGAGEMENT DISTRIBUTION  outliers via z-score, IQR and MAD
COMMENT ANALYSIS       unique vs repeat commenters, duplicates
ANOMALIES              deterministic indicators with severity
EVIDENCE               observed → interpretation → explanations
CONCLUSION             overall confidence
LIMITATIONS            exactly what was unavailable and why
FINAL VERDICT          the 0–100 score and its breakdown
AI FRAUD ANALYSIS      written interpretation from Ollama
```

---

## Configuration

Everything lives in `src/config.ts`.

| Setting | Default | Notes |
| --- | --- | --- |
| `MAX_POSTS` | `100` | Upper limit; expect ~12 in practice, see Limitations |
| `MAX_POSTS_FOR_COMMENTS` | `30` | Lower to `5` for a quick smoke test |
| `MAX_COMMENTS_PER_POST` | `50` | Comments kept per post |
| `REQUEST_DELAY_MS` | `1500` | **Do not lower.** This keeps you off rate limits |
| `AI_ENABLED` | `true` | `false` skips the AI section entirely |
| `OLLAMA_MODEL` | `"llama3.2"` | Larger models reason better about combinations |
| `MAX_AI_COMMENTS` | `100` | Size of the representative comment sample |
| `THRESHOLDS` | — | Detection cut-offs, all tunable |

Score weights are in `src/ai/score.ts`.

---

## How it works

```
Instagram profile URL
        ↓
collect profile, posts, comments      (public documents only)
        ↓
deterministic statistics              (TypeScript, no AI)
        ↓
behavioral + coordination features
        ↓
structured evidence  →  0–100 score   (TypeScript, no AI)
        ↓
Ollama interprets the evidence        (explanation only)
        ↓
terminal report
```

### Collection

Instagram serves an almost empty page to non-browser clients. The tool sends the
ordinary navigation headers a real browser sends, which is enough to receive the
normal public page. It then reads the JSON embedded in that page.

- Profile page → profile fields and post codes
- Each post page → likes, comments, date, caption
- Embed page → view counts, the only public place they appear

If Instagram answers `429` or `403`, collection **stops**. It is never retried
around.

### Scoring

Pure arithmetic in TypeScript. The same evidence always produces the same
number. The AI has no influence on it.

### The AI layer

Ollama runs a model on your own machine; nothing leaves your computer. The model
**never calculates anything**. It receives the structured evidence object and
explains what the numbers mean together.

Rules enforced on it:

- May only cite figures present in the evidence it was given
- May not invent statistics or calculate new ones
- May not claim an account uses bots
- May not output fabricated precision such as "87% of followers are bots"
- Must weigh several independent signals together

Its reply must match a JSON schema. If it returns malformed JSON, the tool
retries once demanding strict JSON, then gives up gracefully. **An AI failure
never breaks the audit** — the statistics and score still print.

---

## Testing without the network

```bash
npm run ai-harness
```

Runs a synthetic coordinated account (a 4-account clique commenting on every
post, seconds apart, with duplicate text) through the whole AI layer in about 30
seconds. It scores **53/100 MIXED**, versus **16/100 CLEAN** for a real account.

Useful for tuning weights in `src/ai/score.ts` without waiting on Instagram.

---

## Limitations

**Roughly 12 posts, not 100.** Instagram serves no pagination cursor to
logged-out clients, so only the first page of media is reachable.

**Comments are a preview.** Public documents expose a handful of comments per
post, not the full thread. All comment statistics describe that sample.

**Shares and saves are never public.** They are always `null`.

**Follower quality cannot be measured.** Impressions, reach, audience
demographics and follower authenticity are visible only to the account owner.
No follower-authenticity percentage is produced, because nothing here could
support one.

**Hidden like counts are excluded.** When an owner hides likes, Instagram still
emits a placeholder number. Using it would corrupt every statistic, so those
posts are dropped from like statistics and reported separately.

**A private account** gives only the profile header.

**Thresholds are heuristics** chosen for this tool, not industry standards.

### What the score cannot tell you

The tool can see that engagement is **coordinated**. It cannot see **why**.

Purchased followers, an engagement pod, and a genuinely devoted fan club all
look the same from outside. That is why the report says *"signals consistent
with artificial engagement"* rather than *"this account uses bots."*

Use the score to decide whether to trust an account or investigate further. It
is not proof.

---

## Project structure

```
index.ts              entry point and the target URL
src/
  audit.ts            pipeline orchestration
  config.ts           all tunable settings
  types.ts            ProfileData, PostData, CommentData
  http.ts             requests, throttling, failure policy
  extract.ts          HTML and embedded-JSON parsing
  profile.ts          URL parsing and profile collection
  posts.ts            post discovery, metrics, comments
  analysis.ts         engagement, video, distribution, comments
  stats.ts            mean, median, stdev, IQR, MAD, z-scores
  indicators.ts       deterministic findings
  report.ts           terminal rendering
  ai/
    ollama.ts         local Ollama client
    features.ts       behavioral and coordination features
    sampling.ts       representative comment sampling
    evidence.ts       builds the evidence object
    score.ts          the 0–100 signal score
    fraud.ts          prompt, schema, validation, retry
    report.ts         verdict and AI sections
ai-harness.ts         offline test with synthetic data
```

---

## Troubleshooting

**Everything shows `N/A`** — Instagram served nothing public. The account may
not exist, may be private, or may be gated. The two are indistinguishable
without signing in, and the report says so.

**`Instagram rate-limited this client (HTTP 429)`** — wait before trying again.
The limit is respected, not worked around.

**AI section says Ollama is unreachable** — run `ollama serve` in another
terminal. The rest of the report is unaffected.

**The AI interpretation feels thin** — `llama3.2` is a small model. Try a larger
one in `src/config.ts`, for example `qwen3:4b`. The score will not change; the
model has no influence on it.

**Type errors** — run `npm run typecheck`.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run audit` | Audit the account set in `index.ts` |
| `npx tsx index.ts "<url>"` | Audit a specific URL |
| `npm run ai-harness` | Offline test with synthetic data |
| `npm run typecheck` | Type-check the project |
