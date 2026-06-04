# Connecting clients to CelesteOps

Wire your MCP clients (Claude Code, Claude Desktop, Cursor, Codex, Celeste CLI) to
the running CelesteOps app. Each client talks to the app through a stdio shim
(`server/index.js`) that forwards to the app's local HTTP API. The client-to-shim
hop is stdio, so this works the same in every client, including sandboxed ones
like Codex that block direct loopback.

## Prerequisites

- **The CelesteOps app, installed and running.** Download
  `CelesteOps-<version>-macos-arm64.zip` (Apple Silicon) from this repo's
  [Releases](https://github.com/whykusanagi/celeste-ops/releases), verify it
  ([VERIFY.md](./VERIFY.md)), unzip it, move `CelesteOps.app` to `/Applications`,
  and launch it. The shim forwards to its API on `127.0.0.1:43121`.
- This repo, cloned locally (you run the installer from it).
- Node 18+ (runs the shim) and [Bun](https://bun.sh) (runs the installer). The
  installer writes the shim's absolute node path into each config, so GUI clients
  that don't inherit your shell `PATH` still launch it.

## Install

```bash
# 1. Vendor the shim's dependencies (once).
cd server && npm install && cd ..

# 2. In the app: Settings → Connections → pick a product → Add Client.
#    Copy the 6-digit code (it's bound to that one product).

# 3. Enroll THAT client and write its config. One client per run, single-use code.
#    --client is one of: claude-code | claude-desktop | cursor | codex | celeste-cli
bun run install:mcp --pair <code> --client claude-code

# 4. Restart the client so it loads the new MCP server.
#    Repeat steps 2-3 (fresh code each time) for any other clients.
```

`install:mcp --pair … --client <slug>` enrolls exactly one client and merges a
`celeste-ops` server into its config (Claude Code → `~/.claude.json` user scope;
others → `claude_desktop_config.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`,
`~/.celeste/mcp.json`). It preserves your other servers and backs up each file
before writing. Use `--dry-run` to preview and `--port <n>` for a non-default API port.

A pairing code is **single-use** and bound to one product: each code enrolls one
client, and re-running a spent code fails (no token sprawl). To wire several
clients, generate a fresh code per client and re-run with the matching `--client`.
Run `install:mcp` without `--pair`/`--client` to wire all detected clients with no
token (the app then rejects them with a 401 until you pair them).

Claude Desktop has a shortcut: drag `celeste-ops.mcpb` onto Settings → Extensions.

## Install the agent skill (optional)

The MCP tools work on their own. To also give an agent the `celesteops-tasks`
skill (it teaches the agent how to read and write CelesteOps tasks), copy it into
the client's skills directory. For Claude Code:

```bash
cp -r skills/celesteops-tasks ~/.claude/skills/
```

This skill format is for Claude Code and Claude Desktop. Cursor, Codex, and
Celeste CLI use the MCP tools directly (no skill file needed).

## Managing connections

In the app, Settings → Connections lists every client. Approve, revoke, or rotate
any token there, and set an expiry. The list updates as clients connect.

## See also

- [`MCP.md`](./MCP.md): the 56-tool reference for agents.
- [`VERIFY.md`](./VERIFY.md): verify a downloaded release with PGP.
- [`skills/celesteops-tasks`](./skills/celesteops-tasks): a skill that teaches an
  agent to read and write CelesteOps tasks.
