// Clypt MCP server — v0 scaffold.
//
// Implementation lands in Chunk 9 of clypt-site/docs/agent-api-v0.md.
//
// Planned tools (thin shim over POST /v1/jobs):
//   - submit_job(url, options?)
//   - get_job(id)
//   - list_jobs(limit?, status?)
//
// Auth: CLYPT_API_KEY env var forwarded as Authorization: Bearer ...

export const NAME = "@useclypt/mcp-server";
export const VERSION = "0.0.1";
