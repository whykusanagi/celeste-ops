# celeste-ops (public bootstrap kit)

This is the **public bootstrap kit** for CelesteOps — the released macOS app, the
stdio MCP shim (`server/`), the `.mcpb` Desktop bundle, the installer
(`scripts/install-mcp.ts`), `MCP.md` (the tool reference), and the connect docs
(`INSTALL.md`, `VERIFY.md`). The app's private source lives elsewhere; this repo
holds only what an LLM or person needs to connect a client (Claude Code / Desktop
/ Cursor / Codex / Celeste CLI) to a running CelesteOps app.

## Naming conventions (the contract is snake_case)

The MCP/HTTP contract is **`snake_case`, end to end**:

- **MCP tool names, tool input params, tool output JSON** — `snake_case`
  (`task_kind`, `due_date`, `include_archived`, `stream_event_id`).
- **HTTP API request/response JSON fields** — `snake_case` (`api_base_url`,
  `bun_version`, `auto_backup`).
- **DB columns / persisted settings** — `snake_case`.

Internal TypeScript (local vars, helpers) stays `camelCase` — that's correct TS.
Boundary: over-the-wire = `snake_case`; inside a module = `camelCase`.

`server/index.js` (the shim) and `celeste-ops.mcpb` are **synced from the private
app repo at release time** (via its `publish:kit`) — don't hand-edit the tool
contract here; it must mirror the app server exactly. `MCP.md` documents that
contract and must use the same `snake_case` names.

## Versioning

This kit **tracks the released app version**. Don't advertise tools or a version
the released app doesn't have — sync + bump only when a new app version ships.
