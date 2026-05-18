// Public-API mirror types. Intentionally NOT shared with clypt-site —
// keeping the MCP package self-contained lets it version independently of
// the API repo. If the upstream contract changes, fix here and rev the
// minor version.

export type SourceType = "video_url" | "audio_url" | "rss_feed_url" | "youtube_url";

export type JobStatus = "queued" | "processing" | "complete" | "failed";

export type JobEnvelope = {
  id: string;
  object: "job";
  status: JobStatus;
  source: { type: SourceType | null; url: string };
  options: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
  output: unknown;
  error: unknown;
};

export type JobList = {
  object: "list";
  has_more: boolean;
  data: JobEnvelope[];
};

export type ApiErrorEnvelope = {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string | null;
    request_id?: string;
  };
};
