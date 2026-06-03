# CelesteOps

CelesteOps is a local-first creator control panel (macOS desktop app) for tasks,
content pipeline, stream calendar, milestones, and documents — with an MCP layer
so AI agents (Claude Code, Claude Desktop, Cursor, Codex, Celeste CLI) can drive it.

This repository is the **public distribution + agent kit**. The application source
is maintained privately; this repo ships the built app plus everything a client
needs to connect.

## What's here

```
server/          The MCP shim — pure-Node stdio server that forwards all 56 tools
                 to the running app's HTTP API. (npm install to vendor its deps.)
scripts/         install-mcp.ts — detect installed clients and wire them up.
skills/          Drop-in skill(s) so an agent knows how to use CelesteOps.
MCP.md           Authoritative 56-tool reference for agents.
INSTALL.md       How to connect your clients.
VERIFY.md        How to verify a signed release download.
celeste-ops.mcpb Claude Desktop one-click extension bundle.
Releases         The signed macOS app (.zip/.dmg) + checksums.txt(.asc).
```

## Quick start

1. Install the CelesteOps app (from a Release — see [VERIFY.md](./VERIFY.md)) and launch it.
2. Connect your clients — see **[INSTALL.md](./INSTALL.md)**:
   ```bash
   cd server && npm install && cd ..
   # In the app: Settings → Connections → Add Client → copy the code
   bun run install:mcp --pair <code>
   ```

## Status

🚧 Pre-release. The shim + `MCP.md` are synced from the private `content-control`
repo's `extension/` at each release; don't edit them here directly.

## Verifying a download

See **[VERIFY.md](./VERIFY.md)** for PGP signature verification and macOS launch
instructions.
