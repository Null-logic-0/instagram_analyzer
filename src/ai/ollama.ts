import { OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_RETRIES, OLLAMA_TIMEOUT_MS } from "../config.js";

export type OllamaErrorKind =
  | "unavailable"
  | "model_missing"
  | "timeout"
  | "request_failed"
  | "bad_response";

export class OllamaError extends Error {
  constructor(
    readonly kind: OllamaErrorKind,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** JSON schema passed to Ollama's structured-output support. */
  format?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface OllamaStatus {
  ready: boolean;
  model: string;
  models: string[];
  detail: string;
}

/**
 * Minimal Ollama client. Local-only, so it has no throttle of its own: the
 * politeness delay in http.ts exists for Instagram, not for localhost.
 */
export class OllamaClient {
  constructor(
    private readonly baseUrl = OLLAMA_BASE_URL,
    readonly model = OLLAMA_MODEL,
  ) {}

  /** Checks the server is up and the configured model is installed. */
  async status(): Promise<OllamaStatus> {
    try {
      const body = await this.request("/api/tags", { method: "GET" });
      const entries = isRecord(body) && Array.isArray(body.models) ? body.models : [];
      const models = entries
        .map((e) => (isRecord(e) && typeof e.name === "string" ? e.name : null))
        .filter((n): n is string => n !== null);
      const ready = models.map(stripTag).includes(stripTag(this.model));

      return {
        ready,
        model: this.model,
        models,
        detail: ready
          ? `Ollama is running at ${this.baseUrl} with model ${this.model}.`
          : `Ollama is running but ${this.model} is not installed (have: ${models.join(", ") || "none"}). ` +
            `Run: ollama pull ${this.model}`,
      };
    } catch (err) {
      const detail =
        err instanceof OllamaError && err.kind === "unavailable"
          ? `Cannot reach Ollama at ${this.baseUrl}. Start it with "ollama serve".`
          : err instanceof Error
            ? err.message
            : String(err);
      return { ready: false, model: this.model, models: [], detail };
    }
  }

  async chat({ messages, format, options }: ChatRequest): Promise<string> {
    const body = await this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        ...(format && { format }),
        ...(options && { options }),
      }),
    });
    const message = isRecord(body) ? body.message : null;
    if (!isRecord(message) || typeof message.content !== "string") {
      throw new OllamaError("bad_response", "Unexpected response shape from /api/chat");
    }
    return message.content;
  }

  /** Chats and parses JSON, tolerating a model that wraps output in prose or fences. */
  async chatJson(request: ChatRequest): Promise<unknown> {
    const content = await this.chat(request);
    const parsed = parseJsonLoosely(content);
    if (parsed === undefined) {
      throw new OllamaError("bad_response", "The model did not return valid JSON");
    }
    return parsed;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.once(path, init);
      } catch (err) {
        const retryable = err instanceof OllamaError && err.retryable;
        if (!retryable || attempt >= OLLAMA_RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  private async once(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    try {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: { "content-type": "application/json" },
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new OllamaError("timeout", `Ollama did not answer within ${OLLAMA_TIMEOUT_MS} ms`, true);
        }
        throw new OllamaError("unavailable", `Cannot reach Ollama at ${this.baseUrl}`);
      }

      const body = await res.json().catch(() => undefined);
      const message = isRecord(body) && typeof body.error === "string" ? body.error : null;

      if (res.status === 404) throw new OllamaError("model_missing", message ?? `Not found: ${path}`);
      if (!res.ok) {
        throw new OllamaError(
          "request_failed",
          `Ollama responded HTTP ${res.status}${message ? `: ${message}` : ""}`,
          res.status >= 500,
        );
      }
      if (body === undefined) throw new OllamaError("bad_response", "Ollama returned a non-JSON body");
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Accepts bare JSON, fenced JSON, or JSON with surrounding prose. */
function parseJsonLoosely(content: string): unknown {
  const candidates = [content.trim()];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)?.[1];
  if (fenced) candidates.push(fenced.trim());

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripTag(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}
