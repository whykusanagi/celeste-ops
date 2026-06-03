# Connecting clients to CelesteOps

Wire your MCP clients (Claude Code, Claude Desktop, Cursor, Codex, Celeste CLI) to
the running CelesteOps app. Each client talks to the app through a stdio shim
(`server/index.js`) that forwards to the app's local HTTP API. The client-to-shim
hop is stdio, so this works the same in every client, including sandboxed ones
like Codex that block direct loopback.

## Prerequisites

- The CelesteOps app running. The shim forwards to its API on `127.0.0.1:43121`.
- Node 18+ (runs the shim) and [Bun](https://bun.sh) (runs the installer).

## Install

```bash
# 1. Vendor the shim's dependencies (once).
cd server && npm install && cd ..

# 2. In the app: Settings → Connections → Add Client. Copy the 6-digit pairing code.

# 3. Enroll your clients and write their configs. Each gets its own token.
bun run install:mcp --pair <code>

# 4. Restart each client so it loads the new MCP server.
```

`install:mcp` detects which clients are installed and merges a `celeste-ops`
server into each config (`.mcp.json`, `claude_desktop_config.json`,
`~/.cursor/mcp.json`, `~/.codex/config.toml`, `~/.celeste/mcp.json`). It preserves
your other servers and backs up each file before writing. Use `--dry-run` to
preview and `--port <n>` for a non-default API port.

Run it without `--pair` and the clients get wired but carry no token, so the app
rejects them with a 401. Always pass `--pair <code>`.

Claude Desktop has a shortcut: drag `celeste-ops.mcpb` onto Settings → Extensions.

## Managing connections

In the app, Settings → Connections lists every client. Approve, revoke, or rotate
any token there, and set an expiry. The list updates as clients connect.

## See also

- [`MCP.md`](./MCP.md): the 56-tool reference for agents.
- [`VERIFY.md`](./VERIFY.md): verify a downloaded release with PGP.
- [`skills/celesteops-tasks`](./skills/celesteops-tasks): a skill that teaches an
  agent to read and write CelesteOps tasks.
