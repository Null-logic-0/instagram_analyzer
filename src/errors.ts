import type { FailureKind } from "./types.js";

export class CollectionError extends Error {
  constructor(
    public kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = "CollectionError";
  }
}

const LABELS: Record<FailureKind, string> = {
  LOGIN_REQUIRED: "login required",
  RATE_LIMITED: "rate limited by Instagram",
  BLOCKED: "request blocked by Instagram",
  NOT_FOUND: "not found",
  PRIVATE_ACCOUNT: "private account",
  NETWORK: "network error",
  TIMEOUT: "timed out",
  PARSE: "unparseable response",
  NOT_SERVED: "not served publicly",
  CONFIG: "configuration problem",
};

export function describeError(err: unknown): string {
  if (err instanceof CollectionError) return `${LABELS[err.kind]} (${err.message})`;
  return err instanceof Error ? err.message : String(err);
}

export function friendlyFailure(err: CollectionError): string {
  switch (err.kind) {
    case "CONFIG":
      return err.message;
    case "NOT_FOUND":
      return "That profile does not exist, or Instagram will not serve it to logged-out clients.";
    case "PRIVATE_ACCOUNT":
      return "The account is private. Only the profile header is publicly visible.";
    case "LOGIN_REQUIRED":
      return "Instagram is requiring an authenticated session. This tool does not log in, so collection stops here.";
    case "RATE_LIMITED":
      return "Instagram rate-limited this client (HTTP 429). Wait before trying again; the limit is respected, not worked around.";
    case "BLOCKED":
      return "Instagram refused the request (HTTP 403). Collection stops here.";
    case "TIMEOUT":
      return "The request timed out. Check your connection and try again.";
    case "NETWORK":
      return `Network error: ${err.message}`;
    default:
      return err.message;
  }
}
