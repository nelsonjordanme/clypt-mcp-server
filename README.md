# @useclypt/mcp-server

Model Context Protocol server for **Clypt**. Lets AI agents (Claude Desktop, Cursor, Claude Code, any MCP-aware client) submit a podcast URL and receive clips, an optional trailer, show notes, a guest-share link, and the transcript.

Pure shim over the public REST API at `https://useclypt.com/api/v1` — three tools, no clever middleware.

## Tools

| Tool | Wraps | Returns |
|---|---|---|
| `submit_job` | `POST /v1/jobs` | `{ id, status: 'queued', ... }` — kicks the pipeline. Wall-clock to terminal: ~2-5 min for audio/RSS sources, ~10-12 min for video + trailer. |
| `get_job` | `GET /v1/jobs/{id}` | Current job state. When `status='complete'`, `output` contains clips, optional trailer, `guest_share_url`, `show_notes`, transcript. When `failed`, `error` carries a `code` + `message`. |
| `list_jobs` | `GET /v1/jobs` | Cursor-paginated list of the org's recent jobs. |

The flow is asynchronous: `submit_job` returns immediately with a queued id; the agent polls `get_job` until terminal. Once a webhook is registered against your org, `job.completed` and `job.failed` events fire on every terminal transition — register via the public API at `POST /v1/webhooks` (no MCP tool for this yet; coming in a later minor).

## Installation

```bash
npm install -g @useclypt/mcp-server
```

Or run without installing:

```bash
npx -y @useclypt/mcp-server
```

## Configuration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "clypt": {
      "command": "npx",
      "args": ["-y", "@useclypt/mcp-server"],
      "env": {
        "CLYPT_API_KEY": "clk_live_..."
      }
    }
  }
}
```

Restart Claude Desktop. Then prompt: *"Use Clypt to clip this podcast: <RSS or audio URL>"*.

### Cursor / Claude Code / other MCP hosts

Same recipe — the binary is `mcp-server` (or run without global install via `npx -y @useclypt/mcp-server`) and the only required env var is `CLYPT_API_KEY`.

## Sandbox keys (free testing)

If your key starts with `clk_test_` instead of `clk_live_`, every job returns a deterministic fixture instead of running the real pipeline. No transcription cost, no R2 storage cost, no Stripe charges. Useful for wiring up your agent before you commit to real submissions.

Fixture mapping:
- `source.type='video_url'` (any URL) → success fixture with 3 clips + optional trailer
- `source.type='audio_url'` / `rss_feed_url` (URL without "fail") → success fixture
- Any URL containing "fail" → `transcription_failed` error fixture
- `source.type='youtube_url'` → `youtube_ingestion_failed` error fixture
- Malformed URL → `invalid_source_url` validation error at submit

Get a sandbox key from your developer dashboard once it ships (until then, ask Nelson).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CLYPT_API_KEY` | yes | — | Bearer token for the Clypt API. `clk_live_*` or `clk_test_*`. |
| `CLYPT_BASE_URL` | no | `https://useclypt.com` | Override for staging or local development. Trailing slash is stripped. |

## Development

```bash
npm install
npm run build
npm test              # vitest unit tests with mocked fetch
npm run dev           # tsc --watch
```

Smoke against the live API with the MCP inspector CLI:

```bash
npm run build
CLYPT_API_KEY=clk_test_xxx \
  npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
```

## License

MIT — see [LICENSE](LICENSE).
