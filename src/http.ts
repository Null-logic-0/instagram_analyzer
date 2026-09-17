import {
  IG_WEB_APP_ID,
  MAX_NETWORK_RETRIES,
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
} from "./config.js";
import { CollectionError } from "./errors.js";
import type { FailureKind } from "./types.js";
import { sleep } from "./util.js";

export type IgRequestMode = "document" | "api";

export interface HttpResponse {
  status: number;
  body: string;
  finalUrl: string;
}

interface RequestOptions {
  mode?: IgRequestMode;
  headers?: Record<string, string>;
  referer?: string;
}

/** Set once Instagram tells this client to stop. Suppresses further requests. */
let stopped: { kind: FailureKind; message: string } | null = null;

export function isStopped(): { kind: FailureKind; message: string } | null {
  return stopped;
}

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS - elapsed);
  lastRequestAt = Date.now();
}

function headersFor(mode: IgRequestMode, referer?: string): Record<string, string> {
  const base = { "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9" };

  if (mode === "api") {
    return {
      ...base,
      accept: "*/*",
      "x-ig-app-id": IG_WEB_APP_ID,
      "x-requested-with": "XMLHttpRequest",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...(referer ? { referer } : {}),
    };
  }

  // Instagram returns an empty client-side shell to requests that omit the
  // ordinary top-level navigation headers a browser always sends. The embed
  // endpoint is the same: as an iframe subresource it serves nothing useful.
  return {
    ...base,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    ...(referer ? { referer } : {}),
  };
}

function classifyStatus(status: number, body: string): FailureKind | null {
  if (status === 429) return "RATE_LIMITED";
  if (status === 401) return "LOGIN_REQUIRED";
  if (status === 403) return "BLOCKED";
  if (status === 404) return "NOT_FOUND";
  if (status >= 400) return "NOT_SERVED";
  if (/"require_login"|loginForm|LoginAndSignupPage|challenge_required/i.test(body.slice(0, 20_000))) {
    return "LOGIN_REQUIRED";
  }
  return null;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function httpGet(url: string, init: RequestOptions = {}): Promise<HttpResponse> {
  if (stopped) throw new CollectionError(stopped.kind, stopped.message);

  let attempt = 0;
  for (;;) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { ...headersFor(init.mode ?? "document", init.referer), ...(init.headers ?? {}) },
      });
      const body = await res.text();
      const kind = classifyStatus(res.status, body);

      // 429 and 403 are Instagram telling this client to stop. That is terminal
      // for the whole run: no retry, no workaround.
      if (kind === "RATE_LIMITED" || kind === "BLOCKED") {
        stopped = {
          kind,
          message:
            kind === "RATE_LIMITED"
              ? "Instagram rate-limited this client (HTTP 429). Collection stopped."
              : "Instagram refused the request (HTTP 403). Collection stopped.",
        };
        throw new CollectionError(kind, stopped.message);
      }

      // 401 applies to one resource only, so other public documents may still
      // be served and the run continues.
      if (kind === "LOGIN_REQUIRED") {
        throw new CollectionError("LOGIN_REQUIRED", `an authenticated session is required for ${pathOf(url)}`);
      }
      if (kind) throw new CollectionError(kind, `HTTP ${res.status} for ${pathOf(url)}`);

      if (/^https:\/\/www\.instagram\.com\/accounts\/login/.test(res.url)) {
        throw new CollectionError("LOGIN_REQUIRED", "redirected to the Instagram login wall");
      }

      return { status: res.status, body, finalUrl: res.url };
    } catch (err) {
      if (err instanceof CollectionError) throw err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt >= MAX_NETWORK_RETRIES) {
        throw new CollectionError(
          isAbort ? "TIMEOUT" : "NETWORK",
          isAbort
            ? `Request timed out after ${REQUEST_TIMEOUT_MS} ms`
            : `Network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      attempt += 1;
      await sleep(REQUEST_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function httpGetJson<T = unknown>(url: string, referer?: string): Promise<T> {
  const res = await httpGet(url, { mode: "api", referer });
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new CollectionError("PARSE", "Response was not valid JSON (Instagram likely served HTML).");
  }
}
