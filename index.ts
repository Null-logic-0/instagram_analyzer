#!/usr/bin/env npx tsx
/*
 * Instagram Influencer Audit
 * Copyright (C) 2026 Luka Tchelidze
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Instagram influencer audit.
 * npx tsx index.ts
 */

import { runAudit } from "./src/audit.js";
import { c } from "./src/util.js";

// The only line you need to change.
const USERNAME = "annloladze";
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
