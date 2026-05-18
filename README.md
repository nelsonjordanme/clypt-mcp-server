# @useclypt/mcp-server

Model Context Protocol server for **Clypt**. Lets AI agents (Claude Desktop, Claude Code, Cursor, ChatGPT operators) submit a podcast URL and receive clips, a trailer, and shareable URLs back.

## Status

v0 in development. Not yet published to npm. Implementation tracked in [`clypt-site/docs/agent-api-v0.md`](../clypt-site/docs/agent-api-v0.md) — see Chunk 9.

## What it does (when shipped)

Three tools, all thin wrappers over the Clypt REST API at `https://useclypt.com/api/v1`:

| Tool | Calls | Returns |
|---|---|---|
| `submit_job` | `POST /v1/jobs` | `{ id, status, ... }` |
| `get_job` | `GET /v1/jobs/{id}` | full job + output when complete |
| `list_jobs` | `GET /v1/jobs` | paginated list |

## Configuration (once published)

```bash
npm install -g @useclypt/mcp-server
```

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "clypt": {
      "command": "clypt-mcp",
      "env": {
        "CLYPT_API_KEY": "clk_live_..."
      }
    }
  }
}
```

Get an API key at https://useclypt.com/developers.

## Development

```bash
npm install
npm run build
npm run dev   # watch mode
```

## License

MIT
