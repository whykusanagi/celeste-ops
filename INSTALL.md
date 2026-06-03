# Connecting clients to CelesteOps

Wire your MCP clients — **Claude Code, Claude Desktop, Cursor, Codex, Celeste CLI** —
to the running CelesteOps app. Every client talks to the app over **stdio → the
shim (`server/index.js`) → the app's local HTTP API**, so it works the same in
every client, including sandboxed ones (Codex) that block direct loopback.

## Prerequisites
- The **CelesteOps app running** (the shim forwards to its API on `127.0.0.1:43121`).
- **Node 18+** (runs the shim) and **[Bun](https://bun.sh)** (runs the installer).

## Install
```bash
# 1. Vendor the shim's dependencies (once)
cd server && npm install && cd ..

# 2. In the app: Settings → Connections → Add Client → copy the 6-digit pairing code

# 3. Enroll your clients + write their configs (each gets its own token)
bun run install:mcp --pair <code>

# 4. Restart each client so it picks up the new MCP server
```

`install:mcp` detects which clients are installed and merges a `celeste-ops`
server into each config (`.mcp.json`, `claude_desktop_config.json`,
`~/.cursor/mcp.json`, `~/.codex/config.toml`, `~/.celeste/mcp.json`), preserving
other servers and backing each up. Flags: `--dry-run` (preview), `--port <n>`
(non-default API port).

> **Without `--pair`** the clients are wired but have no token and the app will
> reject them (401). Always pass `--pair <code>`.

**Claude Desktop** alternative: drag `celeste-ops.mcpb` onto **Settings →
Extensions** for a one-click install.

## Managing connections
In the app, **Settings → Connections** lists every client — approve, **revoke**,
or **rotate** any token, and set an expiry. The list live-updates as clients
connect.

## See also
- [`MCP.md`](./MCP.md) — the full 56-tool reference for agents.
- [`VERIFY.md`](./VERIFY.md) — verify a downloaded release with PGP.
- [`skills/celesteops-tasks`](./skills/celesteops-tasks) — drop-in skill so an
  agent knows how to read/write CelesteOps tasks.
