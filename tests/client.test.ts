import { describe, expect, it } from "vitest";

import { ApiCallError, ClyptApiClient, MissingApiKeyError } from "../src/client.js";

type Captured = { url: string; init: RequestInit };

function makeFakeFetch(
  responses: Array<{ status: number; body: unknown }>,
): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    const bodyText =
      typeof r.body === "string" ? r.body : r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(bodyText, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("ClyptApiClient.submitJob", () => {
  it("POSTs the right URL + body + auth + content-type", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      {
        status: 202,
        body: { id: "job_abc", object: "job", status: "queued" },
      },
    ]);
    const client = new ClyptApiClient({ apiKey: "clk_live_xyz", fetchImpl });
    const job = await client.submitJob({
      source: { type: "audio_url", url: "https://e.example/a.mp3" },
    });
    expect(job).toMatchObject({ id: "job_abc", status: "queued" });
    expect(calls[0]?.url).toBe("https://useclypt.com/api/v1/jobs");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer clk_live_xyz");
    expect(headers["Content-Type"]).toBe("application/json");
    const sentBody = JSON.parse(calls[0]?.init.body as string);
    expect(sentBody).toEqual({
      source: { type: "audio_url", url: "https://e.example/a.mp3" },
      options: {},
    });
  });

  it("forwards Idempotency-Key when set", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 202, body: { id: "job_abc", object: "job", status: "queued" } },
    ]);
    const client = new ClyptApiClient({ apiKey: "k", fetchImpl });
    await client.submitJob({
      source: { type: "audio_url", url: "https://e.example/a.mp3" },
      idempotencyKey: "deadbeef-1234",
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("deadbeef-1234");
  });

  it("throws ApiCallError carrying the API's error envelope on non-2xx", async () => {
    const { fetchImpl } = makeFakeFetch([
      {
        status: 400,
        body: {
          error: {
            type: "invalid_request_error",
            code: "invalid_source_url",
            message: "Invalid URL",
            param: "source.url",
            request_id: "req_x",
          },
        },
      },
    ]);
    const client = new ClyptApiClient({ apiKey: "k", fetchImpl });
    await expect(
      client.submitJob({ source: { type: "audio_url", url: "not-a-url" } }),
    ).rejects.toMatchObject({
      name: "ApiCallError",
      message: "Invalid URL",
      code: "invalid_source_url",
      httpStatus: 400,
      requestId: "req_x",
      param: "source.url",
    });
  });

  it("throws ApiCallError with code='network_error' when fetch rejects", async () => {
    const client = new ClyptApiClient({
      apiKey: "k",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    await expect(
      client.submitJob({ source: { type: "audio_url", url: "https://x" } }),
    ).rejects.toMatchObject({ name: "ApiCallError", code: "network_error" });
  });

  it("throws MissingApiKeyError when CLYPT_API_KEY is unset", async () => {
    const client = new ClyptApiClient({ apiKey: undefined });
    await expect(
      client.submitJob({ source: { type: "audio_url", url: "https://x" } }),
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });
});

describe("ClyptApiClient.getJob", () => {
  it("GETs the right URL", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { id: "job_abc", status: "complete" } },
    ]);
    const client = new ClyptApiClient({ apiKey: "k", fetchImpl });
    await client.getJob("job_abc");
    expect(calls[0]?.url).toBe("https://useclypt.com/api/v1/jobs/job_abc");
    expect(calls[0]?.init.method).toBe("GET");
  });
});

describe("ClyptApiClient.listJobs", () => {
  it("builds the query string correctly", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { object: "list", has_more: false, data: [] } },
    ]);
    const client = new ClyptApiClient({ apiKey: "k", fetchImpl });
    await client.listJobs({ limit: 5, startingAfter: "job_xxx" });
    expect(calls[0]?.url).toBe(
      "https://useclypt.com/api/v1/jobs?limit=5&starting_after=job_xxx",
    );
  });

  it("omits empty query params", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { object: "list", has_more: false, data: [] } },
    ]);
    const client = new ClyptApiClient({ apiKey: "k", fetchImpl });
    await client.listJobs();
    expect(calls[0]?.url).toBe("https://useclypt.com/api/v1/jobs");
  });
});

describe("baseUrl override", () => {
  it("respects CLYPT_BASE_URL override + trims trailing slash", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { id: "job_abc", status: "queued" } },
    ]);
    const client = new ClyptApiClient({
      apiKey: "k",
      baseUrl: "https://staging.useclypt.com/",
      fetchImpl,
    });
    await client.getJob("job_abc");
    expect(calls[0]?.url).toBe("https://staging.useclypt.com/api/v1/jobs/job_abc");
  });
});
