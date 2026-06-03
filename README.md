# CelesteOps

CelesteOps is a local-first creator control panel for macOS. It tracks tasks, a
content pipeline, a stream calendar, milestones, and documents. AI agents (Claude
Code, Claude Desktop, Cursor, Codex, Celeste CLI) drive it over MCP.

This repository is the public distribution and agent kit. The app source stays
private; here you get the built app plus what a client needs to connect to it.

## Contents

- `server/`: the MCP shim, a pure-Node stdio server that forwards all 56 tools to
  the running app's HTTP API. Run `npm install` inside it to vendor its deps.
- `scripts/install-mcp.ts`: detects your installed clients and wires them up.
- `skills/`: a drop-in skill that teaches an agent how to read and write CelesteOps tasks.
- `MCP.md`: the 56-tool reference for agents.
- `INSTALL.md`: how to connect your clients.
- `VERIFY.md`: how to verify a signed release download.
- `celeste-ops.mcpb`: one-click Claude Desktop extension.
- Releases host the signed macOS app, `checksums.txt`, and its signature.

## Quick start

1. Download `CelesteOps-<version>-macos-<arch>.zip` from this repo's
   [Releases](https://github.com/whykusanagi/celeste-ops/releases) (`arm64` for
   Apple Silicon, `x64` for Intel). Verify it ([VERIFY.md](./VERIFY.md)), unzip it,
   move `CelesteOps.app` to `/Applications`, and launch it.
2. Clone this repo, then connect your clients ([INSTALL.md](./INSTALL.md) has the detail):
   ```bash
   cd server && npm install && cd ..
   # In the app: Settings → Connections → Add Client, then copy the code.
   bun run install:mcp --pair <code>
   ```

## Status

Pre-release. `server/index.js` and `MCP.md` are generated from the private
`content-control` repo at each release. Edit them there, not here.
