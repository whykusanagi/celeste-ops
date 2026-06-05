# CelesteOps MCP Server

This document is the single source of truth for any LLM operating the CelesteOps MCP server. It covers what the system is, how to connect, every data entity, all business rules, all 68 tools with full input/output documentation, recommended workflows, example prompts, and error handling. Read this document fully before making any tool calls.

> **Tool count:** the shim exposes **68** tools. Confirm what your client sees after connecting — Claude Code: `/mcp`; Celeste CLI: the TUI's MCP panel.

---

## Table of Contents

1. [What is CelesteOps](#what-is-celesteops)
2. [Connection](#connection)
3. [Data Model](#data-model)
4. [Business Rules](#business-rules)
5. [Recommended Workflows](#recommended-workflows)
6. [Tool Reference](#tool-reference)
   - [Dashboard & Tasks](#group-1-dashboard--tasks)
   - [Content Pipeline](#group-2-content-pipeline)
   - [Stream Calendar](#group-3-stream-calendar)
   - [Thumbnails](#group-4-thumbnails)
   - [Milestones](#group-5-milestones)
   - [Assets](#group-6-assets)
   - [Scheduled Posts](#group-7-scheduled-posts)
   - [Calendar](#group-8-calendar)
   - [Exports & Briefs](#group-9-exports--briefs)
   - [Settings](#group-10-settings)
   - [Backups](#group-11-backups)
   - [Documents](#group-12-documents)
   - [Daily Notes](#group-13-daily-notes)
   - [Projects & Tags](#group-14-projects--tags)
   - [Prototypes](#group-15-prototypes)
7. [Example Prompts](#example-prompts)
8. [Error Handling](#error-handling)

---

## What is CelesteOps

CelesteOps is a local-first creator control panel built for a VTuber/streamer called Celeste (@whykusanagi). It is a macOS desktop application that manages everything involved in running a consistent streaming and content creation operation.

CelesteOps manages:

- **Daily tasks and priorities** — structured task list with P0–P3 priority tiers and a hard cap of 3 active P1 tasks per day
- **Content production pipeline** — YouTube videos, clips, and social posts tracked through stages from idea to repurpose
- **Subathon planning** — stream calendar, milestone goals, and scheduled social posts for a multi-day fundraising marathon event
- **Asset library** — thumbnails, overlays, and other creative files catalogued with R2 backup support
- **Daily export briefs** — generated markdown documents (DAILY_BRIEF.md, STREAM_PLAN.md, POSTS_TODO.md) written to disk and stored in SQLite
- **Cloudflare R2 backups** — AES-256-GCM encrypted zips of the SQLite database, exports folder, and settings uploaded to R2, with a restore flow available in the desktop UI

All data lives in a local SQLite database. There are two front-ends over the same database layer, both entirely local:

- **The app's HTTP API**, hosted by the running desktop app on `127.0.0.1:43121`. This is the single writer — its UI live-updates as changes land.
- **A stdio MCP shim** (`server/index.js` in this kit), which exposes all 68 tools over the Model Context Protocol and forwards each call to that HTTP API. This is what MCP clients (Claude Code, Claude Desktop, Cursor, Codex, …) connect to.

---

## Connection

Every client connects over **stdio** to the same shim (`server/index.js`), which forwards to the running app's HTTP API. Because the client↔shim hop is stdio (no network), this works identically in every client — including sandboxed ones like Codex that block direct loopback connections.

### Step 1: Start the CelesteOps app

The shim forwards to the app's HTTP API, so **the app must be running** before any client can use the tools. Launch `CelesteOps.app` from `/Applications` (or Spotlight). Confirm the API is up — this is also the health check to run any time a client reports it can't reach CelesteOps:

```bash
curl -s http://127.0.0.1:43121/api/health
# → {"ok":true,"apiBaseUrl":"http://127.0.0.1:43121",...}
```

If `curl` connects and returns `{"ok":true,...}`, the app is up and the fault is elsewhere (client config or sandbox). If it refuses the connection, the app isn't running — launch `CelesteOps.app`.

### Step 2: One-command install (recommended)

From the cloned repo root:

```bash
cd server && npm install && cd ..   # once, vendors the shim's deps
bun run install:mcp                 # detect installed clients and wire them up
```

This merges a `celeste-ops` MCP server into each detected client's config — **Claude Code** (`.mcp.json`), **Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json`), **Codex** (`~/.codex/config.toml`), and **Celeste CLI** (`~/.celeste/mcp.json`) — preserving any other servers and backing up each file to `<file>.bak`. Use `--dry-run` to preview, `--port <n>` for a non-default API port. Restart each client afterward. **The CelesteOps app must be running** (the shim talks to its HTTP API).

> **Celeste CLI note:** external MCP servers are loaded only by the interactive `celeste chat` TUI (not `message`/`agent`/`serve`). On launch it connects to the shim and registers all 68 tools — confirm in the TUI's MCP panel.

For Claude Desktop, the packaged `celeste-ops.mcpb` bundle is the preferred one-click path (drag onto **Settings → Extensions**).

### Generic stdio config (manual)

Use this only if your client isn't auto-detected by `install:mcp`. Resolve the two absolute paths with `which node` (e.g. `/opt/homebrew/bin/node`) and the repo's absolute path — use absolute paths, not bare `node`, since GUI/sandboxed clients don't inherit your shell `PATH`:

```json
{
  "command": "/abs/path/to/node",
  "args": ["/abs/path/to/celeste-ops/server/index.js"],
  "env": { "CELESTE_OPS_API_PORT": "43121" }
}
```

(The installer fills these in for you automatically; running `bun run install:mcp --dry-run` prints the exact resolved values.)

### Prerequisites

- [Bun](https://bun.sh) to run the installer (`bun run install:mcp`)
- [Node](https://nodejs.org) 18+ (the shim is pure Node; Claude Desktop's bundled runtime works for the `.mcpb`)
- Shim dependencies vendored: `cd server && npm install`
- The CelesteOps app installed and running — the shim forwards to its HTTP API

### Optional: R2 environment variables for backups

Backup tools require R2 credentials. These can be stored in Settings (via the desktop UI) or provided as environment variables when launching the server. If not set, all other tools continue to work; only `backup_run_manual` will fail.

The settings fields used for R2 are `r2AccountId`, `r2AccessKeyId`, `r2SecretAccessKey`, and `r2Bucket`.

### Data storage location

All persistent data (SQLite database, settings, exports) is stored at:

```
~/Library/Application Support/CelesteOps/
```

This location is outside the app bundle and survives app rebuilds and updates.

---

## Data Model

This section documents every entity, every field, and every enum value. When creating or updating records, only use values defined here.

---

### Task

A unit of work with an area, priority, status, and optional due date.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. Always obtained from list/create responses. |
| `title` | `string` | Human-readable description of the work. |
| `area` | `TaskArea` enum | Which domain this task belongs to. |
| `priority` | `TaskPriority` enum | Urgency/importance tier. |
| `status` | `TaskStatus` enum | Current lifecycle state. |
| `due_date` | `string` (YYYY-MM-DD) or `null` | When the task must be done. |
| `estimate_min` | `integer` or `null` | Estimated time in minutes. |
| `tags` | `string[]` | Arbitrary labels, e.g. `["sponsor", "subathon"]`. |
| `task_kind` | `TaskKind` enum | Ownership flag: `'human'` (default) or `'ai'`. Set `'ai'` when the task is for or from an AI agent — the UI shows a `◆ AI` chip + violet left border. |
| `repo` | `string` or `null` | Repository slug, e.g. `"celeste-cli"`. Surfaces as a `repo:branch` chip in the UI. Filterable via `tasks_list({ repo })`. |
| `branch` | `string` or `null` | Branch the task targets, e.g. `"feat/foo"`. |
| `commit_sha` | `string` or `null` | Commit SHA (short or long) tying this task to a code change. Displayed as a 7-char chip. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

#### TaskKind enum

| Value | Meaning |
|---|---|
| `human` | (default) Task owned/worked by @whykusanagi. |
| `ai` | Task owned/worked by an AI agent. The UI distinguishes these visually (violet border + AI chip) so the user can scan cross-agent work at a glance. |

#### TaskArea enum

| Value | Meaning |
|---|---|
| `content` | YouTube videos, short-form clips, writing, editing |
| `stream` | Live stream operations, moderation, tech setup |
| `interview` | Collaborations, guest appearances, outreach |
| `ops` | Admin, scheduling, logistics, business |
| `health` | Personal wellbeing, rest, routines |

#### TaskPriority enum

| Value | Meaning |
|---|---|
| `P0` | Blocker; must be resolved immediately. No cap. |
| `P1` | Must-do today; high importance. **Max 3 active P1s per due_date enforced.** |
| `P2` | Normal priority; do this week. |
| `P3` | Nice-to-have; backlog. |

#### TaskStatus enum

| Value | Meaning |
|---|---|
| `todo` | Not started. |
| `doing` | In progress (counts toward active P1 cap). |
| `done` | Completed. Does not count toward P1 cap. |
| `blocked` | Waiting on something external. Does not count toward P1 cap. |

---

### ContentItem (Pipeline)

A piece of content tracked through its production lifecycle.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `title` | `string` | Name of the content piece. |
| `stage` | `ContentStage` enum | Current production stage. |
| `platforms` | `string[]` | Target platforms, e.g. `["youtube", "tiktok"]`. |
| `notes` | `string` | Free-text notes, approvals, links, etc. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

#### ContentStage enum (production order)

| Value | Meaning |
|---|---|
| `idea` | Just a concept, not yet developed. |
| `outline` | Structure is planned but recording not started. |
| `record` | Being recorded or captured. |
| `edit` | In post-production / editing. |
| `post` | Ready to post or actively being posted. |
| `repurpose` | Extracting clips or social cuts from finished content. |

Stages do not auto-advance. Use `pipeline_move` or `pipeline_update` to advance them explicitly.

---

### StreamEvent

A single day on the stream calendar. Represents one stream session, rest day, or special event.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `date` | `string` (YYYY-MM-DD) | The calendar date of this event. |
| `title` | `string` | Name/title for this stream day. |
| `stream_type` | `StreamType` enum | Category of stream day. |
| `start_time` | `string` (HH:MM) or `null` | Planned start time in 24h format. |
| `end_time` | `string` (HH:MM) or `null` | Planned end time in 24h format. |
| `notes` | `string` | Planning notes, agenda, guest info, etc. |
| `thumbnail_url` | `string` or `null` | Manually set thumbnail URL (overrides generated). |
| `thumbnail_params` | `ThumbnailParams` object | Parameters for the thumbnail generator. |
| `tags` | `string[]` | Labels, e.g. `["day1", "charity"]`. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

#### StreamType enum

| Value | UI Color | Meaning |
|---|---|---|
| `subathon` | Pink/accent | Marathon stream, part of a multi-day subathon run. |
| `stream` | Green | Regular live show. |
| `special` | Yellow | Events, collabs, announcements, milestones. |
| `rest` | Muted/gray | Off day; no stream scheduled. |

#### ThumbnailParams object

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | `""` | Main title text on the thumbnail. |
| `subtitle` | `string` | `""` | Secondary line / subtitle text. |
| `characterImage` | `string` | `""` | Identifier or URL for the character art to use. |
| `glowColor` | `string` | `"magenta"` | CSS color value for the glow effect. |

---

### Milestone

A numeric goal for the subathon, e.g. "reach 5000 subscribers" or "stream 100 hours total."

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `label` | `string` | Human-readable goal label, e.g. "5000 Subs". |
| `milestone_type` | `MilestoneType` enum | Category of metric being tracked. |
| `target_value` | `integer` (positive) | The number to reach. |
| `current_value` | `integer` (≥ 0) | Current progress value. |
| `color` | `string` (CSS hex) | Display color in the UI, e.g. `"#ff5fb0"`. Default `"#ff5fb0"`. |
| `reached_at` | `string` (ISO 8601) or `null` | Timestamp when the milestone was achieved. `null` means not yet reached. |
| `display_order` | `integer` (≥ 0) | Sort order in the milestone panel. Lower = higher. |
| `notes` | `string` | Extra context or reward description. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

#### MilestoneType enum

| Value | Meaning |
|---|---|
| `subs` | Subscriber count goal. |
| `donations` | Currency/donations total goal. |
| `hours` | Total stream hours goal. |
| `raids` | Incoming raid count goal. |
| `custom` | Any other numeric metric. |

To mark a milestone as reached, call `milestone_update` with `reached_at` set to the current ISO 8601 timestamp.

---

### Asset

A creative file registered in the asset library (thumbnail, overlay, image, etc.).

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `name` | `string` | Human-readable asset name. |
| `asset_type` | `AssetType` enum | Category of asset. |
| `source_url` | `string` or `null` | Remote URL the asset was sourced from. |
| `local_path` | `string` or `null` | Absolute path to the file on disk. |
| `r2_key` | `string` or `null` | Cloudflare R2 object key (populated by backup). |
| `r2_url` | `string` or `null` | Public R2 URL (populated by backup). |
| `file_size_bytes` | `integer` or `null` | File size in bytes. |
| `tags` | `string[]` | Labels for filtering, e.g. `["subathon", "day1"]`. |
| `notes` | `string` | Usage notes, credit, or context. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

#### AssetType enum

| Value | Meaning |
|---|---|
| `thumbnail` | Stream or video thumbnail image. |
| `overlay` | Stream overlay graphic. |
| `image` | General-purpose image. |
| `other` | Any other file type. |

Note: `asset_add` does not upload files. It registers metadata. R2 fields (`r2_key`, `r2_url`) are populated separately by the backup system, not via `asset_add`.

---

### ScheduledPost

A social media post tied to a stream day, with content, platform, and publish status.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `content` | `string` | The post body text. |
| `platform` | `PostPlatform` enum | Target social platform. |
| `stream_event_id` | `string` (UUID) or `null` | Optional link to a StreamEvent. |
| `asset_id` | `string` (UUID) or `null` | Optional link to an Asset (for attached media). |
| `scheduled_for` | `string` (ISO 8601) or `null` | Planned publish datetime. `null` means unscheduled. |
| `status` | `PostStatus` enum | Current lifecycle state. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

#### PostPlatform enum

`twitter` | `bluesky` | `instagram` | `tiktok` | `other`

#### PostStatus enum

| Value | Meaning |
|---|---|
| `draft` | Work in progress; not ready to post. |
| `ready` | Approved and ready to publish. |
| `posted` | Already published. |

---

### Settings

Application configuration stored in a local JSON file (`~/Library/Application Support/CelesteOps/settings.json`), not in SQLite.

| Field | Type | Description |
|---|---|---|
| `autoBackup` | `boolean` | Whether scheduled automatic backups are enabled. |
| `autoBackupHour` | `integer` (0–23) | Hour of day (24h) for the auto-backup to run. Default `2`. |
| `defaultCadence` | `Record<string, string>` | Day-of-week to stream type mapping, e.g. `{"monday": "Deep Dive", "wednesday": "Build Stream"}`. |
| `r2AccountId` | `string` | Cloudflare R2 account ID. |
| `r2AccessKeyId` | `string` | Cloudflare R2 access key ID. |
| `r2SecretAccessKey` | `string` | Cloudflare R2 secret access key. |
| `r2Bucket` | `string` | Cloudflare R2 bucket name. |
| `backupEncryptionPassword` | `string` | Password used to encrypt backups. Empty string `""` means encryption is disabled. When set, backups are encrypted with AES-256-GCM before upload. **Required to restore any backup where `is_encrypted = 1`.** |
| `appInstanceId` | `string` (UUID) | Unique identifier for this installation. Auto-generated on first run. Used as the PBKDF2 salt for backup encryption. |

---

### DailyBrief

A generated daily briefing document stored in SQLite after `daily_export_generate` runs.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `day` | `string` (YYYY-MM-DD) | The date this brief covers. |
| `markdown` | `string` | Full Markdown content of the brief. |
| `created_at` | `string` (ISO 8601) | When the brief was generated. |

---

### BackupRecord

Metadata about a completed R2 backup.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `created_at` | `string` (ISO 8601) | When the backup was created. |
| `r2_key` | `string` | The R2 object key for the backup zip. |
| `size_bytes` | `integer` | Size of the data uploaded to R2 (post-encryption if applicable). |
| `sha256` | `string` | SHA-256 hash of the **plaintext** ZIP (before encryption). Used for integrity verification during restore. |
| `is_encrypted` | `integer` | `1` if the backup was encrypted before upload; `0` if plaintext. |
| `iv` | `string` or `null` | Hex-encoded 12-byte IV used for AES-256-GCM encryption. `null` when `is_encrypted = 0`. Required for decryption during restore. |

---

### CalendarDay

A single day in the calendar month view (returned by `calendar_get_month`).

| Field | Type | Description |
|---|---|---|
| `date` | `string` (YYYY-MM-DD) | The calendar date. |
| `streamEvent` | `StreamEvent` or `null` | The stream event scheduled for this day, if any. |
| `taskCount` | `integer` | Count of non-done tasks due on this date. |
| `tasksDue` | `Task[]` | All non-done tasks due on this date (only populated for days that have a stream event). |

---

### CalendarMonth

The full monthly calendar view returned by `calendar_get_month`.

| Field | Type | Description |
|---|---|---|
| `year` | `integer` | The year. |
| `month` | `integer` | The month (1–12). |
| `days` | `CalendarDay[]` | All days in the month. |
| `milestones` | `Milestone[]` | All milestones, ordered by `display_order`. |

---

### Document

A standalone, multi-attachable markdown note. Used for specs, plans, lyrics drafts, cross-agent handoffs, and any longer-form content that doesn't fit in a task's `description`. Documents can be attached to any number of tasks and/or content_items at once; the same doc can be relevant to many task threads without duplication.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier. |
| `title` | `string` | Human-readable title. |
| `body` | `string` | Markdown source. Supports GFM (tables, task lists, strikethrough, fenced code), syntax-highlighted code blocks, and `[[wikilink]]` / `[[task:<id>]]` / `[[doc:<id>]]` / `[[item:<id>]]` internal references. **Storage format is always raw markdown** — the desktop app lets the user choose between two editors (textarea or CodeMirror 6), but both write and read the same markdown bytes. Tool callers never have to think about which editor is in use. |
| `tags` | `string[]` | Arbitrary tag list. |
| `created_at` | `string` (ISO 8601) | Creation timestamp. |
| `updated_at` | `string` (ISO 8601) | Last modification timestamp. |

### DocumentAttachment

A many-to-many link between a document and a task or content_item.

| Field | Type | Description |
|---|---|---|
| `document_id` | `string` (UUID) | The attached document. |
| `entity_type` | `'task'` \| `'content_item'` | Which entity table the attachment points at. |
| `entity_id` | `string` (UUID) | The id of the task or content_item. |
| `attached_at` | `string` (ISO 8601) | When the attachment was created. |

When a document is deleted, all its attachments are removed via `ON DELETE CASCADE`. When a task or content_item is deleted, the app code cleans up its attachment rows so no orphans remain.

---

## Business Rules

These rules are enforced by the server. Violations result in thrown errors, not silent failures.

### Rule 1: Maximum 3 active P1 tasks per due_date

At most 3 tasks with `priority=P1` and `status` of `todo` or `doing` can exist for any single `due_date` value simultaneously.

- `task_create` checks this before inserting. If the cap is already at 3, the call throws: `"P1 active task cap reached for YYYY-MM-DD. Maximum is 3."`
- `task_update` also checks when the resulting state would exceed the cap.
- `tasks_create_batch` checks per task; if any task in the batch would exceed the cap, that specific task throws.
- **What to do**: Check `p1ActiveCount` from `today_dashboard_get` before creating P1 tasks. If at 3, either use P2, set `due_date` to a different day, or complete/block an existing P1 first.
- P0 tasks have no cap.
- Tasks without a `due_date` do not trigger the cap check.

### Rule 2: One stream event per date (convention)

There is no database-level constraint preventing two stream events on the same date, but duplicates cause UI confusion in the calendar grid. Follow the convention of one event per date. Use `stream_event_get` with a date before creating to verify no event exists.

### Rule 3: R2 credentials required for backup

`backup_run_manual` reads R2 credentials from Settings. If any of `r2AccountId`, `r2AccessKeyId`, `r2SecretAccessKey`, or `r2Bucket` are empty strings, the backup call will fail with a clear error. Use `settings_get` to confirm credentials are present before calling `backup_run_manual`.

If `backupEncryptionPassword` is a non-empty string in Settings, the backup ZIP is encrypted with AES-256-GCM (PBKDF2-SHA256 key derivation, 200k iterations, `appInstanceId` as salt) before upload. The `iv` and `is_encrypted` fields in the returned `BackupRecord` reflect this. The `sha256` field always contains the hash of the plaintext ZIP (pre-encryption).

### Rule 4: Patch objects cannot be empty

All `task_update`, `pipeline_update`, `stream_event_update`, `milestone_update`, `scheduled_post_update`, and `settings_update` calls require their `patch` argument to contain at least one field. Providing an empty `{}` patch throws a Zod validation error: `"patch cannot be empty"`.

### Rule 5: IDs are UUIDs — never guess them

Every entity ID is a randomly generated UUID (v4). Always obtain IDs from the response of a list or create call. Never construct, guess, or hardcode an ID.

### Rule 6: tasks_create_batch default priority is P2

When using `tasks_create_batch`, the default priority is `P2`, not `P1`. This differs from `task_create` (which defaults to `P1`). Set priority explicitly in each batch item when P1 is intended.

### Rule 7: stream_events_batch_create limit is 31

A single call to `stream_events_batch_create` accepts between 1 and 31 events. This corresponds to the maximum days in a calendar month. Split larger scaffolding operations across multiple calls if needed (unlikely to be necessary in practice).

### Rule 8: tasks_create_batch limit is 100

A single call to `tasks_create_batch` accepts between 1 and 100 tasks.

---

## Recommended Workflows

### Start of day

```
1. today_dashboard_get                → see top 3 P1s, overdue tasks, p1ActiveCount
2. tasks_list({ status: "doing" })    → find any in-progress work to resume
3. daily_export_generate              → produce DAILY_BRIEF.md, STREAM_PLAN.md, POSTS_TODO.md
```

Review `p1ActiveCount` in the dashboard response before creating any P1 tasks that day.

### Planning a subathon month

```
1. calendar_get_month(year, month)              → full month view; identify gaps
2. stream_events_batch_create([...])            → scaffold all stream days at once (max 31)
3. tasks_create_batch([...])                    → add prep tasks in bulk (max 100)
4. milestone_create(...)                        → set subathon goals (subs, donations, hours, etc.)
5. scheduled_post_create(...) per stream day    → queue social posts linked to each event
```

### Moving content through the pipeline

```
1. pipeline_list                                → see all items and their current stages
2. pipeline_move(id, "edit")                    → advance a specific item to the next stage
3. pipeline_update(id, { notes: "approved" })   → add notes or context
```

### Updating milestone progress during a stream

```
1. milestone_list                               → see all milestones and current_value
2. milestone_update(id, { current_value: N })   → update progress
3. milestone_update(id, { reached_at: "<iso>" }) → mark reached if target met
```

### Queuing and publishing social posts

```
1. stream_event_get({ date: "YYYY-MM-DD" })     → get stream_event_id
2. scheduled_post_create(...)                   → create post linked to the event
3. scheduled_post_list({ status: "ready" })     → review posts ready to publish
4. scheduled_post_update(id, { status: "posted" }) → mark as published
```

### Building a thumbnail URL

```
1. stream_event_get({ date: "YYYY-MM-DD" })     → get event with thumbnail_params
2. thumbnail_url_build({ stream_event_id: id }) → generate the URL from stored params
   OR
   thumbnail_url_build({ params: { ... } })     → generate from explicit params
```

### Backing up

```
1. settings_get                                 → confirm R2 credentials are non-empty
2. backup_run_manual                            → upload zip to R2 (encrypted if backupEncryptionPassword is set)
3. backups_list                                 → verify backup appears in the record; check is_encrypted field
```

### Restoring a backup

Restore is available only via the desktop app UI (Settings → Backup History → Restore). There is no MCP tool for restore. The restore flow:

```
1. Open the desktop app Settings panel
2. Click "Load History" to fetch recent backups
3. Click "Restore" next to the desired backup
4. The app downloads the backup from R2, decrypts it (if encrypted), verifies the SHA-256 hash, then atomically replaces the local SQLite database
5. Restart the app to apply the restored data
```

**Important**: Restoring replaces the live database. The old database is saved as `celeste_ops.db.bak` before replacement. If the backup was encrypted, the current `backupEncryptionPassword` in Settings must match the password used when the backup was created.

---

## Tool Reference

All 68 tools are documented below in groups. Every tool returns a JSON object serialized as a text content block. Parse the `text` field of the first content item as JSON.

Response envelope shape for all tools:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{ ...JSON payload... }"
    }
  ]
}
```

The specific payload shape for each tool is documented in its "Returns" section.

---

### Group 1: Dashboard & Tasks

---

#### `today_dashboard_get`

Returns the daily priority view for a specific date: the top 3 active P1 tasks, all overdue tasks, all tasks due today, and the current P1 active count. This is the recommended first call at the start of any session.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | `string` (YYYY-MM-DD) | No | The date to query. Defaults to today's date if omitted. |

**Returns**

```json
{
  "day": "2026-02-22",
  "top3": [Task, Task, Task],
  "overdue": [Task, ...],
  "dueToday": [Task, ...],
  "p1ActiveCount": 2
}
```

- `top3`: Up to 3 tasks with `priority=P1` and `status` in `todo|doing` for the given day. Ordered with `doing` first, then by `updated_at` descending.
- `overdue`: All non-done tasks with a `due_date` before the given day, ordered by `due_date ASC, priority ASC`.
- `dueToday`: All non-done tasks with `due_date` equal to the given day, ordered by `priority ASC, updated_at DESC`.
- `p1ActiveCount`: Count of tasks with `priority=P1` and `status` in `todo|doing` for the given day. Use this to check the cap before creating P1 tasks.

**Notes**

- Always call this before creating P1 tasks to verify headroom.
- `p1ActiveCount` counts against the 3-task cap. If it returns `3`, do not create more P1 tasks for that day.

---

#### `tasks_list`

Returns a filtered list of tasks. All filters are optional and combinable. Without filters, returns all tasks sorted by due date, then priority, then most recently updated.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `area` | `TaskArea` | No | Filter to a specific area. |
| `status` | `TaskStatus` | No | Filter to a specific status. |
| `dueDate` | `string` (YYYY-MM-DD) | No | Filter to tasks due on this exact date. |
| `priority` | `TaskPriority` | No | Filter to a specific priority tier. |
| `taskKind` | `'human' \| 'ai'` | No | Filter to a single ownership kind. Use `taskKind: 'ai'` to survey cross-agent work. |
| `repo` | `string` | No | Exact-match repo slug, e.g. `"celeste-cli"`. |

**Returns**

```json
{
  "count": 12,
  "tasks": [Task, ...]
}
```

**Notes**

- All filters are combined with AND logic.
- Tasks are ordered: `COALESCE(due_date, '9999-12-31') ASC, priority ASC, updated_at DESC`.
- To find all blocked tasks: `tasks_list({ status: "blocked" })`.
- To find all overdue tasks for a specific area: combine `area` + loop over dates, or use `today_dashboard_get` for the overdue list.

---

#### `task_create`

Creates a single task. Enforces the max-3 active P1 tasks per `due_date` rule if the new task has `priority=P1`, a `due_date`, and `status` of `todo` or `doing`.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (min 1) | Yes | Task description. |
| `area` | `TaskArea` | Yes | Domain area. |
| `priority` | `TaskPriority` | No | Defaults to `P1`. Set explicitly to `P2` or `P3` for non-urgent tasks. |
| `status` | `TaskStatus` | No | Defaults to `todo`. |
| `due_date` | `string` (YYYY-MM-DD) or `null` | No | Due date. `null` means no due date. |
| `estimate_min` | `integer` (positive) or `null` | No | Estimated minutes to complete. |
| `tags` | `string[]` | No | Defaults to `[]`. |
| `task_kind` | `'human' \| 'ai'` | No | Defaults to `'human'`. Set `'ai'` when the task is for/from another agent. |
| `repo` | `string` or `null` | No | Repository slug. |
| `branch` | `string` or `null` | No | Branch the task targets. |
| `commit_sha` | `string` or `null` | No | Commit SHA tying the task to a code change. |

**Returns**

```json
{
  "created": Task
}
```

**Notes**

- Default priority is `P1`. For bulk work, prefer `P2` explicitly to avoid hitting the P1 cap.
- Tags are arbitrary strings; use consistent conventions like `"sponsor"`, `"subathon"`, `"urgent"`.
- When creating a task for another agent, set `task_kind: 'ai'` and populate `repo` (and `branch` if relevant) so it shows up clearly in the receiving agent's view of CelesteOps.

---

#### `task_update`

Patches an existing task by ID. Only fields included in `patch` are changed; all other fields retain their current values.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Task ID to update. |
| `patch` | `object` | Yes | At least one field required (see below). |
| `patch.title` | `string` (min 1) | No | New title. |
| `patch.area` | `TaskArea` | No | New area. |
| `patch.priority` | `TaskPriority` | No | New priority. |
| `patch.status` | `TaskStatus` | No | New status. |
| `patch.due_date` | `string` (YYYY-MM-DD) or `null` | No | New due date. |
| `patch.estimate_min` | `integer` (positive) or `null` | No | New estimate. |
| `patch.tags` | `string[]` | No | Replaces the entire tags array. |
| `patch.task_kind` | `'human' \| 'ai'` | No | Flip ownership. |
| `patch.repo` | `string` or `null` | No | Set/clear repo slug. |
| `patch.branch` | `string` or `null` | No | Set/clear branch. |
| `patch.commit_sha` | `string` or `null` | No | Stamp the commit SHA when work lands. |

**Returns**

```json
{
  "updated": Task
}
```

**Notes**

- The P1 cap check runs after merging the patch. Updating `status` from `done` back to `todo` on a P1 task can trigger a cap violation if there are already 3 active P1s on that day.
- To mark a task complete: `task_update(id, { patch: { status: "done" } })`.
- Providing `patch: {}` throws a validation error.

---

#### `task_delete`

Permanently deletes a task. This action is irreversible.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Task ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

**Notes**

- No confirmation prompt. Verify the correct ID before calling.
- Soft deletion is not supported; use `status: "done"` or `status: "blocked"` if you want to keep the record.

---

#### `tasks_create_batch`

Creates multiple tasks in a single call. Ideal for converting a rough plan into structured tasks. Each item in the array is processed individually, so a P1 cap violation on one task does not prevent others from being created — the failed task throws while others succeed.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `tasks` | `array` (1–100 items) | Yes | Array of task objects. |
| `tasks[].title` | `string` (min 1) | Yes | Task description. |
| `tasks[].area` | `TaskArea` | Yes | Domain area. |
| `tasks[].priority` | `TaskPriority` | No | Defaults to `P2` (different from `task_create`). |
| `tasks[].status` | `TaskStatus` | No | Defaults to `todo`. |
| `tasks[].due_date` | `string` (YYYY-MM-DD) or `null` | No | Due date. |
| `tasks[].estimate_min` | `integer` (positive) or `null` | No | Estimated minutes. |
| `tasks[].tags` | `string[]` | No | Defaults to `[]`. |

**Returns**

```json
{
  "createdCount": 5,
  "created": [Task, Task, Task, Task, Task]
}
```

**Notes**

- Default priority in batch is `P2`, not `P1`. Be explicit when P1 is intended.
- The batch is not atomic; partial success is possible if some items hit the P1 cap.
- Maximum 100 tasks per call. Split larger imports across multiple calls.

---

#### `tasks_search`

Full-text search across task `title`, `description`, `tags`, `repo`, and `branch` using SQLite FTS5 with bm25 ranking. Use this when you have a topical keyword (a commit SHA, a feature name, a repo slug) and want every task referencing it. Prefer this over `tasks_list` once the corpus is more than ~30 tasks.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `q` | `string` (min 1) | Yes | Search text. Multi-word queries are phrase-matched. |
| `limit` | `integer` (1–200) | No | Max hits to return. Defaults to 50. |

**Returns**

```json
{
  "count": 4,
  "hits": [
    {
      "id": "uuid",
      "title": "Wire SSE survival across 25s heartbeat",
      "description": "Bun.serve idleTimeout was 30s …",
      "area": "code",
      "priority": "P1",
      "status": "done",
      "tags": ["server", "sse"],
      "task_kind": "ai",
      "repo": "my-repo",
      "branch": "fix/sse-idle-timeout",
      "snippet": "Bun.serve **idleTimeout** was 30s, SSE heartbeat …",
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

**Notes**

- `snippet` is a plain-text excerpt around the match (~16 tokens wide) with `**bold**` markers wrapping matched tokens — render directly.
- Hits are ordered by bm25 relevance (best first).
- FTS index stays in sync via triggers on `tasks`. Newly created/updated/deleted tasks are immediately searchable.
- Multi-word input is phrase-matched: `idle timeout` finds "idle timeout", not arbitrary "idle … timeout".

---

#### `tasks_unblocked`

Returns tasks in `status: "todo"` whose every `blocked_by` id resolves to a task with `status: "done"`. Use this to find work that just became actionable. Pairs with the task dependencies model (see `task_create` / `task_update` `blocked_by`): agent submits a Spec doc → creates an Implementation task with `blocked_by: [spec_task_id]` → user approves the Spec → Spec status flips to `done` → Implementation surfaces here.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `includeNoBlockers` | `boolean` | No | Include tasks with empty `blocked_by`. Defaults to `false`. |

**Returns** `{ "count": N, "tasks": [Task, …] }` ordered by priority, then `updated_at` descending.

**Notes**

- Default behaviour (`includeNoBlockers: false`) excludes tasks that never had blockers — they're always ready by definition, and excluding them keeps the result focused on tasks that *just* became unblocked.
- Pass `includeNoBlockers: true` when you want every actionable task, not just newly-unblocked ones.
- Combine with `task_update { status: "done" }` on a parent to atomically unblock its dependents.

---

### Group 2: Content Pipeline

---

#### `pipeline_list`

Returns all content pipeline items across all stages, ordered by most recently updated first.

**Inputs**

None.

**Returns**

```json
{
  "count": 8,
  "items": [ContentItem, ...]
}
```

---

#### `pipeline_create`

Creates a new content item, defaulting to the `idea` stage.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (min 1) | Yes | Title or working title of the content. |
| `stage` | `ContentStage` | No | Defaults to `idea`. |
| `platforms` | `string[]` | No | Target platforms, e.g. `["youtube", "tiktok"]`. Defaults to `[]`. |
| `notes` | `string` | No | Free-text notes. Defaults to `""`. |

**Returns**

```json
{
  "created": ContentItem
}
```

---

#### `pipeline_update`

Patches any fields on a content item. Use this to update notes, platforms, or stage simultaneously.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Content item ID. |
| `patch` | `object` | Yes | At least one field required. |
| `patch.title` | `string` (min 1) | No | New title. |
| `patch.stage` | `ContentStage` | No | New stage. |
| `patch.platforms` | `string[]` | No | Replaces entire platforms array. |
| `patch.notes` | `string` | No | New notes (replaces existing). |

**Returns**

```json
{
  "updated": ContentItem
}
```

---

#### `pipeline_move`

Convenience wrapper to advance (or revert) a content item to a specific stage. Equivalent to `pipeline_update` with only `stage` in the patch.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Content item ID. |
| `stage` | `ContentStage` | Yes | Target stage to move to. |

**Returns**

```json
{
  "updated": ContentItem
}
```

**Notes**

- Stages can be moved in any direction; there is no enforcement of forward-only movement.
- To advance through all stages in order: `idea → outline → record → edit → post → repurpose`.

---

#### `pipeline_delete`

Permanently deletes a content item.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Content item ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

---

### Group 3: Stream Calendar

---

#### `stream_event_create`

Creates a single stream event for a specific date. Use `stream_events_batch_create` when scaffolding multiple days at once.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | `string` (YYYY-MM-DD) | Yes | The calendar date of this event. |
| `title` | `string` (min 1) | Yes | Title for the stream day. |
| `stream_type` | `StreamType` | No | Defaults to `stream`. |
| `start_time` | `string` (HH:MM) or `null` | No | Planned start time. |
| `end_time` | `string` (HH:MM) or `null` | No | Planned end time. |
| `notes` | `string` | No | Planning notes. Defaults to `""`. |
| `thumbnail_url` | `string` or `null` | No | Manual thumbnail URL override. Defaults to `null`. |
| `thumbnail_params` | `ThumbnailParams` object | No | Generator params. Defaults to empty strings / `"magenta"` glow. |
| `tags` | `string[]` | No | Labels. Defaults to `[]`. |

**Returns**

```json
{
  "created": StreamEvent
}
```

**Notes**

- Check for an existing event on the date first with `stream_event_get({ date: "YYYY-MM-DD" })` to avoid duplicates.
- If `thumbnail_params` is omitted, the event is created with an empty params object. Populate it later with `stream_event_update` when thumbnail details are known.

---

#### `stream_event_get`

Retrieves a single stream event by either its UUID or its date. At least one of `id` or `date` must be provided.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | `string` (YYYY-MM-DD) | No* | Look up by date. |
| `id` | `string` (UUID) | No* | Look up by ID. |

*At least one of `date` or `id` is required. If both are provided, `id` takes precedence.

**Returns**

```json
{
  "event": StreamEvent | null
}
```

**Notes**

- Returns `null` in the `event` field if no matching event is found (does not throw).

---

#### `stream_event_update`

Patches any fields on a stream event, including its date.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Stream event ID. |
| `patch` | `object` | Yes | At least one field required. |
| `patch.date` | `string` (YYYY-MM-DD) | No | Move the event to a different date. |
| `patch.title` | `string` (min 1) | No | New title. |
| `patch.stream_type` | `StreamType` | No | New type. |
| `patch.start_time` | `string` (HH:MM) or `null` | No | New start time. |
| `patch.end_time` | `string` (HH:MM) or `null` | No | New end time. |
| `patch.notes` | `string` | No | New notes (replaces existing). |
| `patch.thumbnail_url` | `string` or `null` | No | New thumbnail URL. |
| `patch.thumbnail_params` | `ThumbnailParams` object | No | Replaces entire params object. |
| `patch.tags` | `string[]` | No | Replaces entire tags array. |

**Returns**

```json
{
  "updated": StreamEvent
}
```

---

#### `stream_event_delete`

Permanently deletes a stream event. Note: scheduled posts linked to this event via `stream_event_id` are not automatically deleted.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Stream event ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

---

#### `stream_events_list`

Lists stream events with optional date range filtering. Returns events ordered by date ascending.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `from` | `string` (YYYY-MM-DD) | No | Start of date range (inclusive). |
| `to` | `string` (YYYY-MM-DD) | No | End of date range (inclusive). |

**Returns**

```json
{
  "count": 14,
  "events": [StreamEvent, ...]
}
```

**Notes**

- Without filters, returns all stream events ever created.
- For a monthly view, prefer `calendar_get_month` which also includes task counts and milestones.

---

#### `stream_events_batch_create`

Creates up to 31 stream events in a single call. The primary use case is scaffolding an entire subathon month at once.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `events` | `array` (1–31 items) | Yes | Array of stream event objects. Each has the same shape as `stream_event_create` inputs. |

Each item in the array accepts:

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | `string` (YYYY-MM-DD) | Yes | Calendar date. |
| `title` | `string` (min 1) | Yes | Stream day title. |
| `stream_type` | `StreamType` | No | Defaults to `stream`. |
| `start_time` | `string` (HH:MM) or `null` | No | |
| `end_time` | `string` (HH:MM) or `null` | No | |
| `notes` | `string` | No | |
| `thumbnail_url` | `string` or `null` | No | |
| `thumbnail_params` | `ThumbnailParams` | No | |
| `tags` | `string[]` | No | |

**Returns**

```json
{
  "createdCount": 28,
  "created": [StreamEvent, ...]
}
```

**Notes**

- Not atomic. If an event fails mid-batch (e.g., a DB error), earlier events are already committed.
- Verify no duplicate dates before calling to avoid calendar confusion.

---

### Group 4: Thumbnails

---

#### `thumbnail_url_build`

Builds the thumbnail generator URL from either a stream event's stored `thumbnail_params` or from explicit parameters. The resulting URL opens the online thumbnail generator tool pre-populated with the given values.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `stream_event_id` | `string` (UUID) | No* | Load params from an existing stream event. |
| `params` | `ThumbnailParams` object | No* | Explicit params object. |

*At least one of `stream_event_id` or `params` is required. If `stream_event_id` is provided, it loads `thumbnail_params` from that event. If both are provided, `stream_event_id` takes precedence. Throws if `stream_event_id` is given but the event has no `thumbnail_params` and no fallback `params` is provided.

**ThumbnailParams fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | `""` | Main text on the thumbnail. |
| `subtitle` | `string` | `""` | Secondary text line. |
| `characterImage` | `string` | `""` | Character art identifier or URL. |
| `glowColor` | `string` | `"magenta"` | CSS glow color value. |

**Returns**

```json
{
  "url": "https://whykusanagi.xyz/tools/thumbnail-generator/?title=...&subtitle=...&characterImage=...&glowColor=..."
}
```

**Notes**

- The base URL is `https://whykusanagi.xyz/tools/thumbnail-generator/`.
- All params are passed as URL query string parameters.
- This tool only generates a URL; it does not capture a screenshot or download the image.

---

### Group 5: Milestones

---

#### `milestone_create`

Creates a new subathon milestone goal.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | `string` (min 1) | Yes | Human-readable goal name, e.g. `"5000 Subs"`. |
| `milestone_type` | `MilestoneType` | No | Defaults to `custom`. |
| `target_value` | `integer` (positive) | Yes | The numeric goal to reach. |
| `current_value` | `integer` (≥ 0) | No | Starting progress. Defaults to `0`. |
| `color` | `string` (CSS hex) | No | Display color. Defaults to `"#ff5fb0"`. |
| `display_order` | `integer` (≥ 0) | No | Sort order in the panel. Defaults to `0`. |
| `notes` | `string` | No | Reward or context description. Defaults to `""`. |

**Returns**

```json
{
  "created": Milestone
}
```

---

#### `milestone_list`

Returns all milestones ordered by `display_order` ascending, then `created_at` ascending.

**Inputs**

None.

**Returns**

```json
{
  "count": 5,
  "milestones": [Milestone, ...]
}
```

---

#### `milestone_update`

Updates a milestone. Use this to track current progress or mark a milestone as reached.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Milestone ID. |
| `patch` | `object` | Yes | At least one field required. |
| `patch.label` | `string` | No | New label. |
| `patch.target_value` | `integer` (positive) | No | New target. |
| `patch.current_value` | `integer` (≥ 0) | No | Updated progress value. |
| `patch.color` | `string` | No | New CSS color. |
| `patch.reached_at` | `string` (ISO 8601) or `null` | No | Set to current ISO timestamp when reached; `null` to un-mark. |
| `patch.display_order` | `integer` (≥ 0) | No | New sort order. |
| `patch.notes` | `string` | No | New notes. |

**Returns**

```json
{
  "updated": Milestone
}
```

**Notes**

- To mark a milestone as reached: set `reached_at` to `new Date().toISOString()` equivalent.
- The server does not auto-set `reached_at` when `current_value >= target_value`. You must set it manually.
- To un-reach a milestone: set `reached_at: null`.

---

#### `milestone_delete`

Permanently deletes a milestone.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Milestone ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

---

### Group 6: Assets

---

#### `asset_add`

Registers an asset in the library. This records metadata only — it does not upload the file anywhere.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` (min 1) | Yes | Human-readable asset name. |
| `asset_type` | `AssetType` | No | Defaults to `image`. |
| `source_url` | `string` or `null` | No | URL the asset was downloaded from. |
| `local_path` | `string` or `null` | No | Absolute path to the file on disk. |
| `notes` | `string` | No | Usage notes or credits. Defaults to `""`. |
| `tags` | `string[]` | No | Labels for filtering. Defaults to `[]`. |

**Returns**

```json
{
  "created": Asset
}
```

**Notes**

- `r2_key`, `r2_url`, and `file_size_bytes` are always `null` on creation. They are populated by the backup system.
- At least one of `source_url` or `local_path` is strongly recommended as a locator, though neither is required by the schema.

---

#### `asset_list`

Returns assets from the library, optionally filtered by type.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `AssetType` | No | Filter to a specific asset type. Returns all if omitted. |

**Returns**

```json
{
  "count": 6,
  "assets": [Asset, ...]
}
```

**Notes**

- Results are ordered by `created_at DESC` (most recent first).

---

#### `asset_delete`

Permanently deletes an asset record from the library. Does not delete any file on disk or in R2.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Asset ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

---

### Group 7: Scheduled Posts

---

#### `scheduled_post_create`

Creates a scheduled social media post, optionally linked to a stream event and/or an asset.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | `string` (min 1) | Yes | The post body text. |
| `platform` | `PostPlatform` | No | Defaults to `twitter`. |
| `stream_event_id` | `string` (UUID) or `null` | No | Link to a stream event. |
| `asset_id` | `string` (UUID) or `null` | No | Link to an asset (attached image/media). |
| `scheduled_for` | `string` (ISO 8601) or `null` | No | Planned publish datetime. `null` if unscheduled. |
| `status` | `PostStatus` | No | Defaults to `draft`. |

**Returns**

```json
{
  "created": ScheduledPost
}
```

**Notes**

- To queue a post for a stream day, provide its `stream_event_id`. Use `stream_event_get` to look up the ID from a date.
- `scheduled_for` accepts any ISO 8601 datetime string. Use `null` for posts that have no specific time target yet.

---

#### `scheduled_post_list`

Returns scheduled posts with optional filters. Results are ordered by `scheduled_for ASC, created_at ASC` (nulls sort last).

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `streamEventId` | `string` (UUID) | No | Filter to posts linked to a specific stream event. |
| `platform` | `PostPlatform` | No | Filter by platform. |
| `status` | `PostStatus` | No | Filter by status. |

**Returns**

```json
{
  "count": 4,
  "posts": [ScheduledPost, ...]
}
```

**Notes**

- All filters are combined with AND logic.
- To find all posts ready to publish: `scheduled_post_list({ status: "ready" })`.
- To find all posts for a specific stream day: `scheduled_post_list({ streamEventId: "..." })`.

---

#### `scheduled_post_update`

Edits post content, reschedules, changes platform, attaches an asset, or marks the post as posted.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Post ID to update. |
| `patch` | `object` | Yes | At least one field required. |
| `patch.content` | `string` (min 1) | No | New post body text. |
| `patch.platform` | `PostPlatform` | No | New platform. |
| `patch.asset_id` | `string` (UUID) or `null` | No | New or removed asset link. |
| `patch.scheduled_for` | `string` (ISO 8601) or `null` | No | New scheduled time. |
| `patch.status` | `PostStatus` | No | New status (`draft`, `ready`, or `posted`). |

**Returns**

```json
{
  "updated": ScheduledPost
}
```

**Notes**

- `stream_event_id` is not patchable after creation. To re-link a post to a different stream event, delete it and recreate it.

---

#### `scheduled_post_delete`

Permanently deletes a scheduled post.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Post ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

---

### Group 8: Calendar

---

#### `calendar_get_month`

Returns a full monthly calendar view: every day of the month with its stream event, task count, and tasks due (for days with a stream event). Also includes all milestones. This is the recommended first call when planning or reviewing a month.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `year` | `integer` (2024–2030) | No | Defaults to the current year. |
| `month` | `integer` (1–12) | No | Defaults to the current month. |

**Returns**

```json
{
  "year": 2026,
  "month": 3,
  "days": [
    {
      "date": "2026-03-01",
      "streamEvent": StreamEvent | null,
      "taskCount": 3,
      "tasksDue": [Task, ...]
    },
    ...
  ],
  "milestones": [Milestone, ...]
}
```

**Notes**

- `tasksDue` is only populated for days that have a `streamEvent`. For days without a stream event, `tasksDue` is `[]` and `taskCount` reflects the count from a separate aggregate query.
- `milestones` contains all milestones (not filtered by month). The calendar view always shows the full milestone state.
- The response contains exactly as many `days` entries as there are days in the requested month.
- Year range is validated to 2024–2030.

---

### Group 9: Exports & Briefs

---

#### `daily_export_generate`

Generates three markdown export files for a day and stores the daily brief in SQLite. The files are written to `data/exports/YYYY-MM-DD/` relative to the project root.

The three files generated:
- **DAILY_BRIEF.md** — Top 3 P1 tasks, overdue tasks, tasks due today, content items in `edit` or `post` stage.
- **STREAM_PLAN.md** — Template with Focus, Segments, and Notes sections.
- **POSTS_TODO.md** — Checklist of content items in `edit` or `post` stage for posting.

DAILY_BRIEF.md is also saved to the `daily_briefs` SQLite table (upserted — calling again for the same day overwrites the previous brief).

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | `string` (YYYY-MM-DD) | No | The day to generate for. Defaults to today. |

**Returns**

```json
{
  "result": {
    "day": "2026-02-22",
    "folder": "/absolute/path/to/data/exports/2026-02-22",
    "files": [
      "/absolute/path/.../DAILY_BRIEF.md",
      "/absolute/path/.../STREAM_PLAN.md",
      "/absolute/path/.../POSTS_TODO.md"
    ],
    "dailyBriefMarkdown": "# Daily Brief — 2026-02-22\n..."
  }
}
```

**Notes**

- The `dailyBriefMarkdown` field in the response contains the full text of the brief, so you can read it directly without opening the file.
- Calling this tool multiple times for the same day overwrites the stored brief and re-writes the files.
- STREAM_PLAN.md and POSTS_TODO.md contain template placeholders; they are starting points, not auto-filled plans.

---

#### `daily_brief_get`

Reads a previously generated daily brief from SQLite by date. Does not regenerate it.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | `string` (YYYY-MM-DD) | Yes | The date of the brief to retrieve. |

**Returns**

```json
{
  "brief": DailyBrief | null
}
```

**Notes**

- Returns `null` in the `brief` field if no brief has been generated for that day yet. Call `daily_export_generate` first.
- To get the most current brief for today, prefer `daily_export_generate` (which regenerates) over `daily_brief_get` (which reads a cached version).

---

### Group 10: Settings

---

#### `settings_get`

Reads the current application settings from the local `settings.json` file. If the file does not exist, it is created with defaults.

**Inputs**

None.

**Returns**

```json
{
  "settings": Settings
}
```

**Notes**

- Use this to check whether R2 credentials are configured before calling `backup_run_manual`.
- The `appInstanceId` is auto-generated on first run and should never be changed manually. It serves as the PBKDF2 salt for backup encryption — changing it would break decryption of existing encrypted backups.
- R2 credential fields will be empty strings `""` if not yet configured.
- `backupEncryptionPassword` will be an empty string `""` if encryption is disabled. A non-empty value means all subsequent backups will be encrypted.

---

#### `settings_update`

Patches the application settings. Only `autoBackup`, `autoBackupHour`, and `defaultCadence` are patchable through this tool. R2 credentials and the backup encryption password must be set via the desktop UI.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `patch` | `object` | Yes | At least one field required. |
| `patch.autoBackup` | `boolean` | No | Enable or disable scheduled auto-backup. |
| `patch.autoBackupHour` | `integer` (0–23) | No | Hour of day for the auto-backup. |
| `patch.defaultCadence` | `Record<string, string>` | No | Day-of-week to stream type mapping. Merged with existing cadence (does not replace entirely). |

**Returns**

```json
{
  "settings": Settings
}
```

**Notes**

- `defaultCadence` is **merged** with the existing cadence object, not replaced. To remove a key, the settings file must be edited directly.
- R2 credentials (`r2AccountId`, `r2AccessKeyId`, `r2SecretAccessKey`, `r2Bucket`) and `backupEncryptionPassword` are not exposed as patchable fields through this tool to prevent accidental overwriting by an LLM. They are managed via the desktop UI.

---

### Group 11: Backups

---

#### `backup_run_manual`

Creates a zip archive of the SQLite database, the exports folder, and settings.json. If a backup encryption password is set in Settings, the zip is encrypted with AES-256-GCM before upload. The result is uploaded to Cloudflare R2 and the backup metadata is recorded in SQLite.

**Inputs**

None.

**Returns**

```json
{
  "backup": BackupRecord
}
```

**Notes**

- Requires all four R2 fields in Settings (`r2AccountId`, `r2AccessKeyId`, `r2SecretAccessKey`, `r2Bucket`) to be non-empty. Fails with a clear error if any are missing.
- Call `settings_get` first to verify credentials are present.
- If `backupEncryptionPassword` is set in Settings, the ZIP is encrypted (AES-256-GCM, PBKDF2-SHA256 key, 200k iterations, `appInstanceId` as salt) before upload. The returned `BackupRecord` will have `is_encrypted: 1` and a non-null `iv`.
- `sha256` is always the hash of the **plaintext** ZIP (before encryption). This is used to verify integrity during restore after decryption.
- `size_bytes` reflects the size of the data uploaded to R2 (which will be slightly larger than the plaintext ZIP when encryption is enabled, due to the 16-byte auth tag).

---

#### `backups_list`

Returns recent backup metadata records from SQLite, ordered by `created_at DESC`.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `limit` | `integer` (1–200) | No | Max records to return. Defaults to `20`. |

**Returns**

```json
{
  "backups": [BackupRecord, ...]
}
```

**Notes**

- Use this after `backup_run_manual` to confirm the backup was recorded.
- Records include `r2_key`, `sha256`, `is_encrypted`, and `iv` for manual verification or restore planning.
- Backups with `is_encrypted: 1` can only be restored if the same `backupEncryptionPassword` (and same `appInstanceId`) are still in Settings. If either has changed, the backup cannot be decrypted.
- Restore is performed via the desktop app UI, not via an MCP tool. See the **Restoring a backup** workflow in [Recommended Workflows](#recommended-workflows).

---

### Group 12: Documents

Standalone markdown documents that can be attached to any number of tasks or content_items. Use these for specs, implementation plans, lyrics drafts, cross-agent handoffs, and anything that's too long-form for a task `description`.

---

#### `documents_list`

Lists all documents most-recent-first. Each entry includes an `attachments` array showing every task and content_item the doc is linked to.

**Inputs**: none.

**Returns**

```json
{
  "count": 18,
  "documents": [
    {
      "id": "uuid",
      "title": "Markdown Validation Sheet",
      "body": "# …",
      "tags": ["reference", "test"],
      "attachments": [
        { "document_id": "uuid", "entity_type": "task", "entity_id": "task-uuid", "attached_at": "2026-05-27T…" }
      ],
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

**Notes**

- Order is `updated_at DESC`.
- Filter client-side by title or tags — there's no server filter (the document set is expected to be small).

---

#### `document_get`

Fetches a single document by id.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Document id from `documents_list` or `document_create`. |

**Returns** `{ "document": Document, "comments": [DocumentComment, …], "decisions": [DocumentDecision, …] }`. The response now embeds the doc's full comment chain (the reasoning log) and its decisions (open/resolved/cancelled) alongside the Document, so one call gives the complete review context. Errors with `Document not found` if the id doesn't exist.

**Notes**

- `comments` is chronological (oldest first); `decisions` carries every decision regardless of status. Use `document_comments_list` / `documents_pending_decisions` if you only need one or the other.

---

#### `document_create`

Creates a new document. Pair with `document_attach` if it belongs to a specific task or content_item.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (min 1) | Yes | Human-readable title. |
| `body` | `string` | Yes | Markdown body. Empty string is allowed for a placeholder. |
| `tags` | `string[]` | No | Defaults to `[]`. |

**Returns** `{ "document": Document }` (id, timestamps populated).

**Notes**

- Body supports GFM (tables, task lists, strikethrough, fenced code with syntax highlighting) and the `[[wikilink]]` family: `[[task:<id>]]`, `[[doc:<id>]]`, `[[item:<id>]]`, or a bare title (case-insensitive match against tasks/docs/items).
- Clicking a wikilink in the UI navigates to the target entity's tab.

---

#### `document_update`

Patches a document. Bumps `updated_at`.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Document id. |
| `patch` | object | Yes | At least one of: `title`, `body`, `tags`, `folder`, `review_status`. |

**Returns** `{ "document": Document }` (full updated record). Errors with `Document not found` if the id doesn't exist.

> **Auto-modified on content edits.** If the doc is in a review workflow
> (`review_status` is `in-review` or `approved`) and you change its content
> (`title`/`body`/`tags`/`folder`) **without** also passing `review_status`, the
> status auto-flips to `modified` and `review_status_updated_at` is bumped. This
> is the signal a watching agent polls on (`documents_review_changes_since`): it
> means the doc changed, so the agent must **re-read it from CelesteOps** instead
> of trusting a cached/in-context copy or the local mirrored markdown. No-op saves
> (identical content) don't trigger it. To edit without signaling, pass the
> intended `review_status` explicitly in the same patch — an explicit value
> always wins. Docs with `review_status: null` have no workflow and never auto-flip.

---

#### `document_delete`

Deletes a document. `ON DELETE CASCADE` removes all its `document_attachments` rows. Irreversible.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Document id. |

**Returns** `{ "deleted": id }`.

---

#### `document_attach`

Links a document to a task or content_item. Idempotent — attaching the same pair twice is a no-op.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `document_id` | `string` (UUID) | Yes | The document. |
| `entity_type` | `'task' \| 'content_item'` | Yes | What kind of entity to attach to. |
| `entity_id` | `string` (UUID) | Yes | The target entity. |

**Returns** `{ "ok": true }`.

**Notes**

- Multi-attach: the same document can be linked to many tasks and/or content_items.

---

#### `document_detach`

Removes a single attachment between a document and an entity. The document itself is preserved.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `document_id` | `string` (UUID) | Yes | |
| `entity_type` | `'task' \| 'content_item'` | Yes | |
| `entity_id` | `string` (UUID) | Yes | |

**Returns** `{ "ok": true }` (even if the attachment didn't exist — idempotent).

---

#### `documents_search`

Full-text search across document titles, bodies, and tags using SQLite FTS5 with bm25 ranking. Prefer this over `documents_list` + client-side filtering once the doc corpus is more than ~30 entries.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `q` | `string` (min 1) | Yes | Search text. Multi-word queries are treated as a phrase by default. |
| `limit` | `integer` (1–200) | No | Defaults to 50. |

**Returns**

```json
{
  "count": 3,
  "hits": [
    {
      "id": "uuid",
      "title": "OWARANAI",
      "body": "[Intro]…",
      "tags": ["music"],
      "created_at": "…",
      "updated_at": "…",
      "snippet": "I am the **kill signal** for me"
    }
  ]
}
```

- `snippet` is a plain-text excerpt around the match (~16 tokens wide), with `**bold**` markers wrapping the matched tokens — ready to render directly.
- Hits are ordered by relevance (bm25 ascending = best first).

**Notes**

- Multi-word input is phrase-matched: `kill signal` finds "kill signal", not arbitrary "kill … signal".
- FTS index stays in sync via triggers on `documents`. Newly created/updated/deleted docs are immediately searchable.

---

#### `documents_for_entity`

Lists all documents attached to a specific task or content_item. Use this at the start of work on a task to surface relevant context (specs, plans, prior conversation).

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `entity_type` | `'task' \| 'content_item'` | Yes | |
| `entity_id` | `string` (UUID) | Yes | |

**Returns** `{ "count": N, "documents": [Document, …] }` ordered `updated_at DESC`.

---

#### `document_backlinks`

Returns every doc, task, and content_item whose body / description / notes contains a wikilink to the given document. Useful at the start of work on a doc: discover what other notes and tasks reference it.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Document id. |

**Returns**

```json
{
  "backlinks": {
    "docs": [{ "id": "uuid", "title": "Implementation Plan A" }],
    "tasks": [{ "id": "uuid", "title": "Wire up the review workflow" }],
    "items": [{ "id": "uuid", "title": "Subathon launch trailer" }]
  }
}
```

**Notes**

- Matches three syntaxes: `[[doc:<id>]]`, bare title `[[<title>]]` (case-insensitive), and piped `[[<title>|<label>]]`.
- Each entry contains just `{id, title}`. Use the relevant getter (`document_get`, `task_update`, `pipeline_list`) to fetch the body.
- Ordered `updated_at` desc within each bucket.

---

#### `document_folders_list`

Returns every unique `folder` path used by documents, with usage counts. Use this before creating a new doc to re-use an established path instead of inventing a new one.

**Inputs**: none.

**Returns**

```json
{
  "count": 6,
  "folders": [
    { "folder": "",                "doc_count": 4 },
    { "folder": "celeste-cli",     "doc_count": 9 },
    { "folder": "my-repo", "doc_count": 12 },
    { "folder": "daily",           "doc_count": 31 },
    { "folder": "music",           "doc_count": 5 },
    { "folder": "reference",       "doc_count": 7 }
  ]
}
```

**Notes**

- The empty path `""` is the Unfiled bucket.
- Sorted alphabetically.
- Pair with `projects_list` (top-level folder segments contribute to project rollups).

---

#### `document_set_review_status`

Set or clear the `review_status` on a document. This is the atomic, single-purpose alternative to `document_update` for the approval workflow — use it when handing off a spec/plan to the user, after the user approves, or to mark a doc the user modified.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Document id. |
| `review_status` | `'in-review' \| 'approved' \| 'modified' \| null` | Yes | Set the new status, or `null` to clear. |

**Returns** `{ "document": Document }` (full updated record, with refreshed `review_status_updated_at`).

**Notes**

- Bumps `review_status_updated_at` and sets the status directly. Use this for explicit transitions (submit / approve / clear). Content edits via `document_update` to an in-review/approved doc also bump it (auto-`modified`).
- Errors with `Document not found` if the id doesn't exist.
- Status meanings: `in-review` = awaiting user; `approved` = user signed off; `modified` = the doc changed since the agent last saw it — **re-read before acting** (set explicitly, or auto-set when an in-review/approved doc's content is edited); `null` = no workflow.

---

#### `documents_pending_review`

Returns every document currently in `review_status: "in-review"`. Use this at session start to discover what specs/plans the user (or this agent) is blocked on.

**Inputs**: none.

**Returns** `{ "count": N, "documents": [Document, …] }` ordered by `review_status_updated_at` ascending (oldest pending first — these have been waiting longest).

---

#### `documents_review_changes_since`

Polling primitive for agents waiting on user review. Returns every document whose `review_status_updated_at` is at or after the given ISO timestamp.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `since` | `string` (ISO timestamp) | Yes | e.g. `"2026-05-28T07:30:00.000Z"`. |
| `ids` | `string[]` | No | Optional: filter to this set of document ids. The typical agent flow scopes the poll to the specific doc(s) submitted for review. |

**Returns** `{ "count": N, "documents": [Document, …] }` ordered newest first by `review_status_updated_at`.

**Notes**

- Pair with the doc's `review_status_updated_at` field from a prior `document_create` / `document_set_review_status` call — record that timestamp, then periodically call this with it until the doc's status flips to `approved` or `modified`.
- The signal fires on explicit status changes **and** when the user edits the content of a doc that's `in-review`/`approved` (which auto-flips it to `modified`). It does **not** fire for edits to docs with no review workflow (`review_status: null`), nor for no-op saves. So a hit always means "this doc you're tracking actually changed — re-read it."
- Without `ids`, returns the global change list (useful for a single watcher coordinating multiple submissions).

---

#### Decisions & comments (the reasoning chain)

The review workflow above (`document_set_review_status` / `documents_pending_review` / `documents_review_changes_since`) tracks a single approve / modify signal. The tools below layer two finer-grained channels onto the same document, both surfaced in the doc's Review panel and embedded in `document_get`:

- **Comments** — immutable, free-form remarks appended to a doc (the reasoning log). Comments added via MCP are authored as `"agent"`; the user's own comments are `"user"`. A comment that accompanies an approve/modified action carries that `review_status`.
- **Decisions** — structured questions (a prompt + 2 or more options) handed to the user to pick from. Poll for the resolution the same way you poll for review state, then read the chosen option + note back off the document. This is the decision counterpart of the review-status workflow: where `review_status` answers "is this approved?", a decision answers "which of these alternatives?".

---

#### `document_comment_add`

Append an immutable, free-form comment to a document — a remark or explanation that joins the doc's reasoning chain. For a question that needs the user to choose between alternatives, use `document_decision_create` instead.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `document_id` | `string` (UUID) | Yes | Document to comment on. |
| `body` | `string` (min 1) | Yes | Comment text. |

**Returns** `{ "comment": DocumentComment }`.

**Notes**

- Comments are immutable — there is no edit/delete tool.
- Author is recorded as `"agent"` when added via MCP. User comments (authored `"user"`) come from the desktop UI.

---

#### `document_comments_list`

Lists a document's comments in chronological order (oldest first) — the reasoning chain for that doc.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `document_id` | `string` (UUID) | Yes | Document whose comments to list. |

**Returns** `{ "comments": [DocumentComment, …] }`.

**Notes**

- Each `DocumentComment` is `{ id, document_id, author: 'user' | 'agent', body, review_status: 'in-review' | 'approved' | 'modified' | null, created_at }`. `review_status` is set only when the comment accompanied an approve/modified action.
- `document_get` already embeds this list in its `comments` field.

---

#### `document_decision_create`

Attach a structured decision to a document: a prompt plus 2 or more options for the user to pick from. Use this when handing off a spec/plan and you need the user to choose between alternatives rather than just approve or reject.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `document_id` | `string` (UUID) | Yes | Document the decision belongs to. |
| `prompt` | `string` (min 1) | Yes | The question to ask the user. |
| `options` | `[{ label: string, description?: string }]` | Yes | At least **2** options. Each option's `id` is generated server-side and returned. |

**Returns** `{ "decision": DocumentDecision }` with the option ids populated.

**Notes**

- Poll `documents_decision_changes_since` (or `documents_pending_decisions`) to learn when the user resolves it, then call `document_get` for the chosen option + resolution note.
- A decision is the "pick one" counterpart to the approve/modify review signal.

---

#### `document_decision_resolve`

Resolves an open decision by choosing an option and/or leaving a note. Primarily a user action via the UI; exposed here for tests and delegated answering.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Decision id (from `document_decision_create`, `documents_pending_decisions`, or `document_get`). |
| `chosen_option_id` | `string` | No | The picked option's id. |
| `resolution_note` | `string` | No | Free-text note. |

At least one of `chosen_option_id` / `resolution_note` is required.

**Returns** `{ "decision": DocumentDecision }` (now `status: "resolved"` with `resolved_at` set).

---

#### `document_decision_cancel`

Cancels an open decision you no longer need answered (e.g. you revised the spec and the question is moot). The decision is kept for the record with its original prompt and options.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (UUID) | Yes | Decision id to cancel. |

**Returns** `{ "decision": DocumentDecision }` (now `status: "cancelled"`).

---

#### `documents_pending_decisions`

Returns every document that has at least one open (unresolved) decision, with those decisions. The decision counterpart of `documents_pending_review` — use it at session start to find what choices the user still owes an answer on.

**Inputs**: none.

**Returns** `{ "count": N, "pending": [{ "document": Document, "decisions": [DocumentDecision, …] }] }`.

**Notes**

- Only docs with ≥1 `status: "open"` decision appear; the `decisions` array lists that doc's decisions.

---

#### `documents_decision_changes_since`

Polling primitive for agents waiting on a decision. Returns every document whose decisions changed — created, resolved, or cancelled — at or after the given ISO timestamp. Mirrors `documents_review_changes_since`.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `since` | `string` (ISO timestamp) | Yes | e.g. `"2026-06-04T07:30:00.000Z"`. Returns docs with a decision change at/after this. |
| `ids` | `string[]` | No | Optional: filter to this set of document ids (the typical flow scopes the poll to the doc(s) you submitted a decision on). |

**Returns** `{ "count": N, "documents": [Document, …] }`.

**Notes**

- After creating a decision, record the time, then poll this until the doc shows up; then call `document_get` to read the resolved choice + note.
- Without `ids`, returns the global change list.

---

### Group 13: Daily Notes

Auto-generated per-day documents seeded from that day's dashboard. After first access the body belongs to the user.

---

#### `daily_note_get_or_create`

Returns the daily-note document for the given day, creating it on first access. The body is auto-generated **once** from that day's dashboard (Top 3, Due Today, Overdue carry-over) with `[[task:<id>]]` wikilinks for every referenced task. Tagged `daily-note` plus the date.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `day` | `string` (YYYY-MM-DD) | No | Defaults to today (UTC). |

**Returns**

```json
{
  "document": Document,
  "created": true
}
```

**Notes**

- `created` is `true` iff this call materialized the row. On subsequent calls it's `false` and the existing body is returned untouched — the tool *never* re-generates an existing note.
- Folder is `daily/`; title is the date.
- Clicking a `[[task:<id>]]` wikilink in the UI navigates to that task.

---

#### `daily_notes_list`

Returns every existing daily-note document, sorted by date descending. Useful for jumping between recent days or summarizing the last week of work.

**Inputs**: none.

**Returns** `{ "count": N, "daily_notes": [Document, …] }`.

**Notes**

- Filtered to docs tagged `daily-note` — does not include arbitrary docs that happen to live under `daily/`.

---

### Group 14: Projects & Tags

Cross-cutting rollups derived from existing task and document state. No standalone tables back these tools — they aggregate on the fly.

---

#### `projects_list`

Returns every "project" (repository) with a rollup of tasks, docs, and pending reviews. Projects are derived from the union of (1) distinct `tasks.repo` values and (2) the top-level segment of every document `folder` (e.g. `"celeste-cli/specs"` contributes `"celeste-cli"`). Known non-project folders (`music`, `daily`, `reference`) are excluded.

Use this at session start to scope into a specific project, or to surface cross-cutting work patterns (e.g. which repos still have open `0.2.x` upgrade tasks).

**Inputs**: none.

**Returns**

```json
{
  "count": 4,
  "projects": [
    {
      "repo": "my-repo",
      "task_count": 47,
      "open_task_count": 12,
      "p0_count": 0,
      "ai_task_count": 18,
      "doc_count": 12,
      "pending_review_count": 1,
      "last_activity_at": "2026-05-28T03:42:11.000Z"
    }
  ]
}
```

**Notes**

- Sorted by `open_task_count DESC`, then alphabetical by `repo`.
- `last_activity_at = max(tasks.updated_at, documents.updated_at)` across the project.
- `pending_review_count` counts docs in this project's folder with `review_status: "in-review"`.

---

#### `tags_list`

Returns every unique tag across documents and tasks with usage counts. Useful for orienting a session: what topics dominate the current backlog, which tags are stale singletons.

**Inputs**: none.

**Returns**

```json
{
  "count": 23,
  "tags": [
    { "tag": "server",       "doc_count": 2, "task_count": 14, "total": 16 },
    { "tag": "ui",           "doc_count": 1, "task_count": 11, "total": 12 },
    { "tag": "daily-note",   "doc_count": 31, "task_count": 0,  "total": 31 }
  ]
}
```

**Notes**

- Sorted by `total DESC`, then alphabetical.
- A tag with `total: 1` is usually a singleton; consider consolidating or deleting it.

---

### Group 15: Prototypes

A **prototype** is a stored, self-contained HTML artifact (it may include inline CSS and JS). It is embedded in a document via a fenced code block whose language is `prototype` and whose body is the prototype's id (optionally followed by `height=NNN` for the iframe height):

````
```prototype
<prototype-id>
height=480
```
````

**Security model (read before authoring):** a prototype renders inside `<iframe sandbox="allow-scripts" srcdoc=…>` — a **null origin** (no `allow-same-origin`), so it cannot reach the local API, the auth token, cookies, or the parent page. An injected CSP (`default-src 'none'; … connect-src 'none'`) blocks **all** network requests; images/styles/fonts may only load from a user-managed host allowlist (Settings → `prototype_allowlisted_hosts`). The server stores the HTML **verbatim and does not sanitize it** — the sandbox + CSP is the control. A prototype must be **approved by the user in the UI** before it first renders; approval is bound to a content hash, so editing the html re-arms the gate. **There is no `prototype_approve` MCP tool** — an authoring agent cannot approve its own prototype. See `docs/SECURITY-SPEC.md` §7.

---

#### `prototype_create`

Creates a self-contained HTML artifact that can be embedded in a document via a ```prototype fenced block containing the returned id. The HTML may include inline CSS and JS. The **user** must approve it in the UI before it first renders — you cannot approve your own prototype.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (min 1) | Yes | Human-readable title shown in the management UI. |
| `html` | `string` (min 1) | Yes | The self-contained HTML document. Stored verbatim; rendered in a sandboxed iframe. |
| `tags` | `string[]` | No | Labels for filtering. Defaults to `[]`. |

**Returns**

```json
{
  "prototype": Prototype
}
```

**Notes**

- The created prototype is **unapproved**; it will not render until the user approves it. Poll `prototype_get` to learn when that happens.

---

#### `prototype_update`

Patches a prototype's `title`, `html`, and/or `tags`. At least one field is required. Editing `html` **re-arms the approval gate** — the user must re-approve before the new version renders. Cannot set approval (user-only).

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (min 1) | Yes | Prototype ID to patch. |
| `title` | `string` (min 1) | No | New title. |
| `html` | `string` (min 1) | No | New HTML. Changing this clears the prior approval. |
| `tags` | `string[]` | No | Replacement tag array. |

**Returns**

```json
{
  "prototype": Prototype
}
```

**Notes**

- An empty patch (no fields) is rejected.

---

#### `prototype_get`

Fetches a prototype by id, including its `html` and current approval state.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (min 1) | Yes | Prototype ID. |

**Returns**

```json
{
  "prototype": Prototype,
  "approved": true
}
```

**Notes**

- `approved` is `true` only when the user has signed off on the **current** html. Poll this to learn when the user approves your prototype.

---

#### `prototype_list`

Lists all prototypes, newest first.

**Inputs**: none.

**Returns**

```json
{
  "count": 3,
  "prototypes": [Prototype, ...]
}
```

---

#### `prototype_delete`

Permanently deletes a prototype by id. Irreversible.

**Inputs**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` (min 1) | Yes | Prototype ID to delete. |

**Returns**

```json
{
  "deleted": "uuid-string"
}
```

---

## Example Prompts

The following are concrete prompts an operator might issue and which tools to call in response.

### 1. "What should I work on today?"

```
1. today_dashboard_get({ day: "<today>" })
   → Inspect top3, overdue, p1ActiveCount
2. tasks_list({ status: "doing" })
   → Find any in-progress tasks to resume
```
Summarize the top3 P1 tasks and any overdue items. If `p1ActiveCount` is 0, suggest creating focused P1 tasks.

---

### 2. "Generate my daily brief for today"

```
1. daily_export_generate({ day: "<today>" })
   → Returns dailyBriefMarkdown in the response; files written to disk
```
Present the `dailyBriefMarkdown` content directly. Mention the file paths for reference.

---

### 3. "Scaffold the subathon calendar for March 2026 with streams on Mon/Wed/Fri and rest days otherwise"

```
1. calendar_get_month({ year: 2026, month: 3 })
   → Review which dates are Mon/Wed/Fri
2. stream_events_batch_create({ events: [
     { date: "2026-03-02", title: "Subathon Day 1", stream_type: "subathon", tags: ["subathon"] },
     { date: "2026-03-04", title: "Subathon Day 2", stream_type: "subathon", tags: ["subathon"] },
     { date: "2026-03-01", title: "Rest", stream_type: "rest" },
     ... (all 31 days)
   ]})
```

---

### 4. "Add a milestone: reach 5000 subscribers, currently at 3200"

```
1. milestone_create({
     label: "5000 Subs",
     milestone_type: "subs",
     target_value: 5000,
     current_value: 3200,
     color: "#ff5fb0",
     display_order: 1
   })
```

---

### 5. "Update the subscriber count to 4100 — we're getting close!"

```
1. milestone_list()
   → Find the subs milestone ID
2. milestone_update({ id: "<subs-milestone-id>", patch: { current_value: 4100 } })
```
If `current_value >= target_value`, also set `reached_at: new Date().toISOString()`.

---

### 6. "Create a batch of 5 prep tasks for the subathon starting next Monday"

```
1. today_dashboard_get({ day: "<next-monday>" })
   → Check p1ActiveCount to know how many P1 slots are free
2. tasks_create_batch({ tasks: [
     { title: "Prep stream alerts", area: "stream", priority: "P1", due_date: "<monday>", tags: ["subathon"] },
     { title: "Test donation widget", area: "ops", priority: "P1", due_date: "<monday>", tags: ["subathon"] },
     { title: "Write subathon announcement post", area: "content", priority: "P1", due_date: "<monday>", tags: ["subathon"] },
     { title: "Check overlay assets", area: "stream", priority: "P2", due_date: "<monday>", tags: ["subathon"] },
     { title: "Prep milestone graphics", area: "content", priority: "P2", due_date: "<monday>", tags: ["subathon"] }
   ]})
```
Note: Only 3 P1s allowed per day. Check `p1ActiveCount` first; use P2 if cap is approaching.

---

### 7. "Move the YouTube vlog from outline to record stage"

```
1. pipeline_list()
   → Find the vlog content item ID
2. pipeline_move({ id: "<vlog-id>", stage: "record" })
```

---

### 8. "Queue a tweet announcement for the March 15 stream"

```
1. stream_event_get({ date: "2026-03-15" })
   → Get the stream_event_id
2. scheduled_post_create({
     content: "We're live tonight at 8PM JST! Subathon Day X — come join! 🎮",
     platform: "twitter",
     stream_event_id: "<event-id>",
     scheduled_for: "2026-03-15T11:00:00.000Z",
     status: "draft"
   })
```

---

### 9. "Run a backup and confirm it worked"

```
1. settings_get()
   → Verify r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket are non-empty
   → Note whether backupEncryptionPassword is set (non-empty = backup will be encrypted)
2. backup_run_manual()
   → Returns BackupRecord with r2_key, sha256, is_encrypted, and iv
3. backups_list({ limit: 1 })
   → Confirm the new record appears with the expected is_encrypted value
```

---

### 10. "Show me everything due this week and mark the done ones as complete"

```
1. tasks_list({ dueDate: "2026-02-23" })   ← repeat for each day of the week
   OR
   today_dashboard_get({ day: "<each-day>" })
   → Identify tasks to mark done
2. task_update({ id: "<task-id>", patch: { status: "done" } })
   ← repeat for each completed task
```

---

## Error Handling

### CelesteOps not reachable (app offline)

**Error message**: `CelesteOps isn't reachable at http://127.0.0.1:43121 — is the app running? (<cause>)`

**Cause**: The shim could not reach the app's HTTP API. Almost always the app isn't running; less often the API is on a non-default port, or the shim was configured with the wrong `CELESTE_OPS_API_PORT`.

**Resolution**:
1. Health-check the API: `curl -s http://127.0.0.1:43121/api/health`. If it returns `{"ok":true,...}`, the app is up — skip to step 3.
2. If `curl` is refused, the app is down. Launch `CelesteOps.app`. Then re-run the health check.
3. App is up but a client still can't see the tools → the client isn't wired to the shim. Re-run `bun run install:mcp` (or `--dry-run` to inspect the resolved config) and restart the client. A **sandboxed client (e.g. Codex) that blocks loopback is not the cause** — the client↔shim hop is stdio, so the sandbox never sees the HTTP call; the shim (a normal subprocess) makes it.
4. Non-default port: ensure the app's port and the shim's `CELESTE_OPS_API_PORT` match; reinstall with `bun run install:mcp --port <n>`.

---

### P1 cap violation

**Error message**: `"P1 active task cap reached for YYYY-MM-DD. Maximum is 3."`

**Cause**: Attempting to create or update a task that would result in more than 3 active (`todo` or `doing`) P1 tasks on the same `due_date`.

**Resolution**:
- Call `today_dashboard_get({ day: "YYYY-MM-DD" })` and check `p1ActiveCount`.
- If at 3, change the new task to `priority: "P2"`, set a different `due_date`, or complete/block one of the existing P1 tasks first via `task_update`.

---

### Empty patch

**Error message**: `"patch cannot be empty"` (Zod validation error)

**Cause**: A `patch` argument was provided as `{}` to any update tool.

**Resolution**: Include at least one field in the patch object. Review which fields are patchable for the relevant tool.

---

### Entity not found

**Error messages**: `"Task not found"`, `"Content item not found"`, `"Stream event not found"`, `"Milestone not found"`, `"Asset not found"`, `"Scheduled post not found"`

**Cause**: The provided `id` does not match any record in the database.

**Resolution**: Call the corresponding list tool to retrieve valid IDs. Never guess or construct UUIDs.

---

### Missing id or date (stream_event_get)

**Error message**: `"Provide id or date"`

**Cause**: `stream_event_get` was called without either `id` or `date`.

**Resolution**: Provide at least one of the two fields.

---

### Missing params (thumbnail_url_build)

**Error message**: `"Provide stream_event_id or params"`

**Cause**: `thumbnail_url_build` was called without either `stream_event_id` or `params`.

**Resolution**: Provide at least one of the two inputs.

---

### R2 backup failure

**Error message**: Varies — typically mentions missing credentials or a network/upload failure.

**Cause**: R2 credentials are empty or invalid in Settings, or there is a network connectivity issue.

**Resolution**:
- Call `settings_get` and verify all four R2 fields (`r2AccountId`, `r2AccessKeyId`, `r2SecretAccessKey`, `r2Bucket`) are non-empty strings.
- If credentials are missing, they must be configured via the desktop UI (not via `settings_update`, which does not expose R2 fields).
- If credentials are present but the backup still fails, the error message from the R2 SDK will indicate whether it is an auth error or a network issue.

---

### Database initialization error

**Cause**: The MCP server could not initialize the SQLite database or required runtime directories.

**Resolution**: Ensure `bun install` has been run from the project root and the process has write access to `~/Library/Application Support/CelesteOps/`. (This applies to the dev direct-to-SQLite server, `bun run mcp` — not the shim, which never opens the database. The **shim** depends on the app's HTTP API being reachable on port 43121; if it isn't, see "CelesteOps not reachable" above.)

---

### Backup restore errors

These errors surface in the desktop app UI when a restore fails:

| Error | Cause | Resolution |
|---|---|---|
| `"Backup not found"` | The backup ID no longer exists in SQLite. | Use Load History to refresh the list and select a valid backup. |
| `"Backup is marked encrypted but has no IV stored"` | Data integrity issue in the backup record. | The backup cannot be restored. Run a new backup. |
| `"Backup is encrypted but no password is set"` | `backupEncryptionPassword` is empty but the backup was encrypted. | Set the encryption password in Settings to match the one used when the backup was created. |
| `"SHA-256 mismatch"` | The decrypted (or downloaded) ZIP does not match the stored hash. | The backup file may be corrupt or the wrong password was used. Try again or use a different backup. |
| `"Backup ZIP does not contain celeste_ops.db"` | The ZIP archive is missing the database file. | The backup is unusable. Run a new backup. |

---

### Tool throws unexpected error

All tools are wrapped in a `safeRun` handler that catches all errors, logs them to stderr with the prefix `[celeste-ops-mcp]`, and re-throws a plain `Error` with the original message. The MCP SDK surfaces this as a tool call error in the client.

If an unexpected error occurs:
1. Check the stderr output of the MCP server process for the `[celeste-ops-mcp] <tool-name> failed: <message>` log line.
2. Verify the input types match the documented schemas exactly (UUIDs are strings, dates are `YYYY-MM-DD`, times are `HH:MM`).
3. Verify the database is not locked by another process.
