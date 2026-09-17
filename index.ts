#!/usr/bin/env npx tsx
/**
 * Instagram influencer audit.
 * npx tsx index.ts
 */

import { runAudit } from "./src/audit.js";
import { c } from "./src/util.js";

// The only line you need to change.
const USERNAME = "influencer-instagram-username";
const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${USERNAME}/`;

const target = process.argv[2] ?? INSTAGRAM_PROFILE_URL;

runAudit(target).catch((err: unknown) => {
  console.error();
  console.error(c.red("instagram-analyzer failed unexpectedly."));
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
  console.error();
  console.error(c.dim("  Set DEBUG=1 to see the stack trace."));
  process.exitCode = 1;
});
