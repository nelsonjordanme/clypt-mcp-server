import type { ApiErrorEnvelope, JobEnvelope, JobList } from "./types.js";

const DEFAULT_BASE_URL = "https://useclypt.com";

type FetchImpl = typeof fetch;

export type ClientConfig = {
  apiKey: string | undefined;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  userAgent?: string;
};

export class ApiCallError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly param: string | null;

  constructor(opts: {
    message: string;
    code: string;
    httpStatus: number | null;
    requestId?: string | null;
    param?: string | null;
  }) {
    super(opts.message);
    this.name = "ApiCallError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.requestId = opts.requestId ?? null;
    this.param = opts.param ?? null;
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "CLYPT_API_KEY is not set. Add it to the env block of your MCP host config (e.g. claude_desktop_config.json) — get a key at https://useclypt.com/developers. Sandbox keys (clk_test_*) return deterministic fixtures for free.",
    );
    this.name = "MissingApiKeyError";
  }
}

// Thin typed wrapper over the public /v1/* surface. Every method either
// resolves to a typed envelope or throws ApiCallError / MissingApiKeyError —
// the tool layer translates those into MCP tool results.
export class ClyptApiClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchImpl;

  constructor(cfg: ClientConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.userAgent = cfg.userAgent ?? "Clypt-MCP/0.1.0";
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async submitJob(body: {
    source: { type: string; url: string };
    options?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<JobEnvelope> {
    return await this.request<JobEnvelope>("POST", "/api/v1/jobs", {
      body: { source: body.source, options: body.options ?? {} },
      idempotencyKey: body.idempotencyKey,
    });
  }

  async getJob(id: string): Promise<JobEnvelope> {
    return await this.request<JobEnvelope>("GET", `/api/v1/jobs/${encodeURIComponent(id)}`);
  }

  async listJobs(opts: { limit?: number; startingAfter?: string } = {}): Promise<JobList> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.startingAfter) params.set("starting_after", opts.startingAfter);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return await this.request<JobList>("GET", `/api/v1/jobs${suffix}`);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    if (!this.apiKey) throw new MissingApiKeyError();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": this.userAgent,
    };
    if (method === "POST") headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ApiCallError({
        message: `Could not reach Clypt API at ${this.baseUrl}${path}: ${message}`,
        code: "network_error",
        httpStatus: null,
      });
    }

    const rawText = await res.text();
    let parsed: unknown = undefined;
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // fall through; non-JSON 5xx is unusual but worth surfacing as the raw text
      }
    }

    if (res.status >= 200 && res.status < 300) {
      if (parsed === undefined) {
        // 204-style empty body — none of the tools we call expect this, but
        // surface a typed error rather than returning undefined cast as T.
        throw new ApiCallError({
          message: `Clypt API returned ${res.status} with empty body (expected JSON).`,
          code: "empty_response",
          httpStatus: res.status,
        });
      }
      return parsed as T;
    }

    // Non-2xx. Parse the standard error envelope; fall back to a synthetic
    // shape if the body isn't well-formed.
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const env = parsed as ApiErrorEnvelope;
      throw new ApiCallError({
        message: env.error.message,
        code: env.error.code,
        httpStatus: res.status,
        requestId: env.error.request_id ?? null,
        param: env.error.param ?? null,
      });
    }
    throw new ApiCallError({
      message: rawText.length < 500 ? rawText || `HTTP ${res.status}` : `HTTP ${res.status}`,
      code: "non_2xx",
      httpStatus: res.status,
    });
  }
}
