# CelesteOps

CelesteOps is a local-first creator control panel for macOS. It tracks tasks, a
content pipeline, a stream calendar, milestones, and documents — which now carry
collaborative decisions/comments and embeddable sandboxed HTML prototypes. AI
agents (Claude Code, Claude Desktop, Cursor, Codex, Celeste CLI) drive it over MCP.

This repository is the public distribution and agent kit. The app source stays
private; here you get the built app plus what a client needs to connect to it.

## Contents

- `server/`: the MCP shim, a pure-Node stdio server that forwards all 69 tools to
  the running app's HTTP API. Run `npm install` inside it to vendor its deps.
- `scripts/install-mcp.ts`: detects your installed clients and wires them up.
- `skills/`: a drop-in skill that teaches an agent how to read and write CelesteOps tasks.
- `MCP.md`: the 69-tool reference for agents.
- `INSTALL.md`: how to connect your clients.
- `VERIFY.md`: how to verify a signed release download.
- `celeste-ops.mcpb`: one-click Claude Desktop extension — install it and paste a
  pairing code; no clone needed.
- Releases host the signed macOS app, `checksums.txt`, and its signature.

## Quick start

1. Download the macOS app from the latest
   [Release](https://github.com/whykusanagi/celeste-ops/releases/latest):
   `CelesteOps-<version>-macos-arm64.zip` for Apple Silicon. Verify it
   ([VERIFY.md](./VERIFY.md)), unzip it, move `CelesteOps.app` to `/Applications`,
   and launch it. The build is ad-hoc signed, so on first launch right-click the
   app and choose Open.
2. Clone this repo, then connect your clients ([INSTALL.md](./INSTALL.md) has the detail):
   ```bash
   git clone https://github.com/whykusanagi/celeste-ops.git && cd celeste-ops
   cd server && npm install && cd ..
   # In the app: Settings → Connections → pick a client (Claude Code, Claude
   # Desktop, Cursor, Codex, or Celeste CLI) → Add Client, copy the code.
   # One client per run — pass the matching --client slug:
   bun run install:mcp --pair <code> --client claude-code
   ```

   **Claude Desktop is simpler** — no clone needed: install `celeste-ops.mcpb`
   (Settings → Extensions) and paste a pairing code. See [INSTALL.md](./INSTALL.md).

## License

Proprietary. Free to download and run to connect your own clients to your own
CelesteOps app; redistribution and resale are reserved. See [LICENSE](./LICENSE).
