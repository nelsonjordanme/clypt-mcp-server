#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ApiCallError, ClyptApiClient, MissingApiKeyError } from "./client.js";

const PACKAGE_NAME = "@useclypt/mcp-server";
const PACKAGE_VERSION = "0.1.0";

const sourceTypes = ["video_url", "audio_url", "rss_feed_url", "youtube_url"] as const;

export type BuildServerOptions = {
  apiKey?: string;
  baseUrl?: string;
};

// Exported for tests so they can construct + drive the server without the
// stdio transport. Production callers go through main() below.
export function buildServer(opts: BuildServerOptions = {}): {
  server: McpServer;
  client: ClyptApiClient;
} {
  const apiKey = opts.apiKey ?? process.env.CLYPT_API_KEY;
  const baseUrl = opts.baseUrl ?? process.env.CLYPT_BASE_URL;
  const client = new ClyptApiClient({ apiKey, baseUrl });

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  });

  server.tool(
    "submit_job",
    "Submit a podcast for processing. Returns a job id immediately with status='queued'; the pipeline runs asynchronously — call get_job to poll. Typical wall-clock to terminal is ~2-5 min for audio_url/rss_feed_url, ~10-12 min for video_url with include_trailer=true. Source type 'youtube_url' is in beta — sandbox keys return a fixture failure; live keys reject it for now. For free deterministic testing, use a sandbox key (prefix clk_test_) — every submission returns canned fixture output ~10-70s later.",
    {
      source: z
        .object({
          type: z
            .enum(sourceTypes)
            .describe(
              "Where the media lives. video_url = publicly fetchable MP4, audio_url = MP3/M4A, rss_feed_url = podcast RSS (most recent episode is picked), youtube_url = beta.",
            ),
          url: z
            .string()
            .url()
            .describe("Public HTTPS URL of the media or RSS feed."),
        })
        .describe("Where to fetch the source media from."),
      options: z
        .object({
          include_trailer: z
            .boolean()
            .optional()
            .describe(
              "Set true on video_url submissions to also produce a 60-90s vertical highlights MP4 alongside the clips. Audio sources can't produce trailers.",
            ),
          caption_style: z
            .string()
            .optional()
            .describe(
              "Optional caption preset override. Examples: 'bold-pop', 'yellow-pop'. Omit to use the org default.",
            ),
        })
        .partial()
        .optional()
        .describe("Optional job-level overrides."),
      idempotency_key: z
        .string()
        .min(8)
        .max(255)
        .optional()
        .describe(
          "Optional idempotency token (8-255 chars). Re-submitting the same body with the same key inside 24h returns the original job instead of creating a new one.",
        ),
    },
    async (args) => {
      try {
        const job = await client.submitJob({
          source: args.source,
          options: args.options,
          idempotencyKey: args.idempotency_key,
        });
        return toolResult(job, `Job submitted: ${job.id} (status=${job.status}). Poll with get_job until status becomes 'complete' or 'failed'.`);
      } catch (err) {
        return toolError(err, "submit_job");
      }
    },
  );

  server.tool(
    "get_job",
    "Fetch the current state of a previously submitted job. When status='complete', the returned envelope contains the output object with clips, optional trailer, guest_share_url, show_notes, and transcript. When status='failed', the envelope contains an error object with code + message. Call this repeatedly (every 30-60s is plenty — jobs take minutes, not seconds) until status is one of complete/failed.",
    {
      id: z
        .string()
        .regex(/^job_[0-9a-f]{32}$/i, "Job IDs must look like `job_<32 hex chars>`.")
        .describe("The job id returned by submit_job."),
    },
    async (args) => {
      try {
        const job = await client.getJob(args.id);
        return toolResult(job, `Job ${job.id} status=${job.status}.`);
      } catch (err) {
        return toolError(err, "get_job");
      }
    },
  );

  server.tool(
    "list_jobs",
    "List recent jobs for the authenticated organisation, newest first. Cursor-paginated via starting_after. Useful for inspecting recent submissions when you don't have the id to hand.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max items per page (1-100, default 20)."),
      starting_after: z
        .string()
        .regex(/^job_[0-9a-f]{32}$/i)
        .optional()
        .describe("Cursor: pass the last job id from the previous page to fetch the next page."),
    },
    async (args) => {
      try {
        const list = await client.listJobs({
          limit: args.limit,
          startingAfter: args.starting_after,
        });
        return toolResult(
          list,
          `Returned ${list.data.length} job(s)${list.has_more ? " (more available)" : ""}.`,
        );
      } catch (err) {
        return toolError(err, "list_jobs");
      }
    },
  );

  return { server, client };
}

function toolResult(envelope: unknown, summary: string) {
  return {
    content: [
      { type: "text" as const, text: `${summary}\n\n${JSON.stringify(envelope, null, 2)}` },
    ],
    structuredContent: envelope as Record<string, unknown>,
  };
}

function toolError(err: unknown, toolName: string) {
  if (err instanceof MissingApiKeyError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: err.message }],
    };
  }
  if (err instanceof ApiCallError) {
    const parts = [
      `Clypt API error in ${toolName}: ${err.message}`,
      `code=${err.code}`,
      err.httpStatus !== null ? `http_status=${err.httpStatus}` : null,
      err.requestId ? `request_id=${err.requestId}` : null,
      err.param ? `param=${err.param}` : null,
    ].filter(Boolean);
    return {
      isError: true,
      content: [{ type: "text" as const, text: parts.join(" · ") }],
      structuredContent: {
        code: err.code,
        message: err.message,
        http_status: err.httpStatus,
        request_id: err.requestId,
        param: err.param,
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Unexpected error in ${toolName}: ${message}` }],
  };
}

async function main(): Promise<void> {
  const { server } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now listens on stdio; the host (Claude Desktop, Cursor, etc.)
  // will issue JSON-RPC requests. SDK handles graceful shutdown when the
  // host closes its end of the pipe.
}

// Only run main() when invoked as a CLI, not when imported by tests.
// `import.meta.url === pathToFileURL(process.argv[1]).href` is the canonical
// ESM check; using a simpler endsWith match keeps the dep surface tiny.
const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (invokedAsCli) {
  main().catch((err) => {
    console.error("[clypt-mcp] fatal:", err);
    process.exit(1);
  });
}
