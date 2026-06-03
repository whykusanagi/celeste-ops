---
name: celesteops-tasks
description: Use when the user (whyKusanagi) asks to read, create, or update tasks in CelesteOps — their personal local task planner that doubles as a cross-repo message board between Claude agents. Triggers include "check CelesteOps", "what tasks are tagged <repo>", "create a task in CelesteOps", "update task X", "leave a note for the [tts-bot / cli / discord-bot] agent", or any reference to "the task planner". The system runs locally on this Mac at http://127.0.0.1:43121 and exposes a small HTTP API.
---

# CelesteOps task planner — agent access

CelesteOps is whyKusanagi's local-first creator control panel (Electrobun + bun:sqlite). It tracks tasks, content pipeline items, stream events, milestones, assets, and scheduled posts. Crucially it is **also used as a cross-repo message board** for Claude agents working in his other repos (`celeste-core-persona`, `celeste-tts-bot`, `celeste-cli`, the Celeste Discord bot, `content-control` itself). When you make a change in one repo that affects another, leave a task in CelesteOps so the agent in the other repo (or the user) sees it.

The repo for the planner itself is `~/Development/content-control`. Source of truth for the data model is `~/Development/content-control/MCP.md`.

## 1. Check that CelesteOps is running

Before any operation, hit the health endpoint:

```bash
curl -s http://127.0.0.1:43121/health
```

Expected: `{"ok":true,"apiBaseUrl":"http://127.0.0.1:43121"}`. If you get connection refused, the desktop app is not running. Tell the user: "CelesteOps doesn't seem to be open — launch /Applications/CelesteOps.app and I'll retry." Don't try to start it yourself; that's the user's choice.

The app uses SSE on `GET /api/events` to push live updates to its own UI within ~1s. So when you write to the API, the user sees the change in their desktop window almost immediately.

## 2. Tagging conventions (read this before writing)

Tags are the primary mechanism for routing tasks across the user's repo ecosystem. **Always tag tasks you create with both the repo they relate to and the kind of work** so the right agent picks them up later.

**Repo tags** (use one matching the affected repo):

- `celeste-core-persona`
- `celeste-tts-bot`
- `celeste-cli`
- `discord-bot`
- `content-control`

**Cross-repo sync tag**: `persona-sync` whenever a change in `celeste-core-persona` needs to propagate to a downstream repo's copies.

**Workflow tags**:

- `commission-idea` + `refs-needed` — early-stage commission concept that still needs reference images / artist choice / NSFW-level decision before it can be sent.
- `vgen` / `skeb` — active commission tracking. Include `artist:<handle>` (e.g. `artist:OuO`, `artist:allstaryesi`).
- `weekly-schedule` / `sunday-post` / `announcement` — recurring Sunday-night stream-schedule post.
- `nikke` / `union-raid` / `vrchat` etc. — game/event tags for stream-related work.
- `brief-needed` — commission task where the brief details are still TBD on the user's side.
- `blocking-commission` — user-side deliverable that's blocking an artist's work.
- `overdue` / `follow-up` — commissions past their original deadline that need a polite check-in.

When in doubt about which tag to use, prefer creating the right ones — tags are free-form strings and the user can rename later.

## 3. Common operations (HTTP curl)

### Read tasks tagged with a specific repo

There is no tag-filter endpoint yet (gap noted in the planner's own backlog). Pull all tasks and filter client-side:

```bash
curl -s http://127.0.0.1:43121/api/tasks | jq '.tasks | map(select(.tags | index("celeste-tts-bot")))'
```

Or use `area` + `status` filters at the URL to narrow the pull first:

```bash
curl -s 'http://127.0.0.1:43121/api/tasks?area=ops&status=todo'
```

### Read today's dashboard

```bash
curl -s 'http://127.0.0.1:43121/api/today'
```

Returns `top3` (up to 3 highest-priority P1 tasks due today), `overdue`, `dueToday`, and `p1ActiveCount`. **The P1 cap is 3 active P1 tasks per due-date** — don't create a 4th P1 with the same due-date or it'll fail.

### Create a task

```bash
curl -s -X POST http://127.0.0.1:43121/api/tasks \
  -H 'content-type: application/json' \
  -d '{
    "title": "Sync persona files in celeste-tts-bot to match core 0e1a2b3",
    "description": "celeste-core-persona changed: lib/voice/baseline.json updated this morning (commit 0e1a2b3). The mirrored copy in celeste-tts-bot/persona/baseline.json is now stale and needs the same update. Diff is small — three new tone descriptors added at the bottom of the JSON.",
    "area": "ops",
    "priority": "P2",
    "status": "todo",
    "due_date": null,
    "estimate_min": 15,
    "tags": ["celeste-tts-bot", "celeste-core-persona", "persona-sync"]
  }'
```

**Field rules:**

- `area`: one of `content` (video/editing/writing), `stream` (live ops/tech), `interview` (collabs/guests), `ops` (admin/logistics/cross-repo-sync), `health` (wellbeing).
- `priority`: `P0` (blocker), `P1` (must-do today), `P2` (this week), `P3` (backlog).
- `status`: `todo`, `doing`, `blocked`, `done`. Default `todo`.
- `due_date`: `YYYY-MM-DD` or `null`.
- `estimate_min`: integer minutes or `null`.
- `tags`: string array. Tag aggressively for findability (see section 2).
- `description`: this is where the agent's reasoning, file paths, commit SHAs, and any context the user needs to judge or act go. **Title alone is rarely enough — use the description**.

### Update a task

```bash
curl -s -X PATCH http://127.0.0.1:43121/api/tasks/<id> \
  -H 'content-type: application/json' \
  -d '{"status":"doing"}'
```

Patch any subset of fields. Common patterns:

- `{"status":"doing"}` when starting work
- `{"status":"done"}` when finishing
- `{"description":"...updated context..."}` to leave new notes for the user
- `{"due_date":"2026-05-15"}` to reschedule

### Pipeline (content production — videos, shorts, posts)

Pipeline items go through stages: `idea → outline → record → edit → post → repurpose`. Use these for video/short ideas, not the tasks list:

```bash
curl -s -X POST http://127.0.0.1:43121/api/pipeline \
  -H 'content-type: application/json' \
  -d '{
    "title": "How to <topic> tutorial",
    "stage": "idea",
    "platforms": ["youtube", "youtube-shorts"],
    "notes": "..."
  }'
```

Move stage:

```bash
curl -s -X PATCH http://127.0.0.1:43121/api/pipeline/<id> \
  -H 'content-type: application/json' \
  -d '{"stage":"outline"}'
```

## 4. Cross-repo message-board workflow (the core use case)

When you make changes in repo A that affect repo B, the convention is:

1. Finish your work in repo A. Note the commit SHA.
2. Create a task in CelesteOps with:
   - `area: 'ops'`
   - `tags: ['<repo-B>', '<repo-A>', 'persona-sync']` (or other relevant tag)
   - `description`: includes repo-A's commit SHA, the affected files, and what repo-B needs to do.
   - `priority`: usually `P2` (this week) unless there's a deadline.
3. The next agent working in repo B reads `tasks` filtered by their repo tag and sees the message.

Before starting work in any of his repos, **always check** for tasks tagged with the current repo's name and `status` in (`todo`, `doing`):

```bash
curl -s http://127.0.0.1:43121/api/tasks | jq --arg repo celeste-tts-bot '
  .tasks
  | map(select(.tags | index($repo)))
  | map(select(.status == "todo" or .status == "doing"))
'
```

## 5. Don't

- Don't write to `r2*` settings via the HTTP API — those are credentials. Tell the user to update them in the desktop app's Settings panel.
- Don't delete tasks unless the user explicitly asks. Prefer `{"status":"done"}` to preserve history.
- Don't bulk-create more than ~10 tasks at a time without telling the user — looks like spam in the live UI.
- Don't generate full Skeb-request text from inside this skill. There's a separate `skeb_request_format.md` memory file in the content-control project specifically for that — when working IN content-control, that workflow takes over.

## 6. MCP alternative

If you'd rather use the MCP tools than HTTP curl, the user can register the MCP server in the current project's `.mcp.json` like this:

```json
{
  "mcpServers": {
    "celeste-ops": {
      "command": "bun",
      "args": ["run", "/Users/kusanagi/Development/content-control/app/src/mcp/server.ts"],
      "cwd": "/Users/kusanagi/Development/content-control"
    }
  }
}
```

Once registered, the same operations are available as MCP tools (`task_create`, `task_update`, `tasks_list`, `tasks_create_batch`, `pipeline_create`, etc.). HTTP is simpler for one-off reads; MCP is nicer when you'll be doing many operations and want type-checked tool calls. Either is fine.

## Recap

When the user asks you to interact with their tasks:

1. `curl /health` to confirm app is running.
2. Read existing tasks tagged with the current repo name to see if there's already a relevant entry (don't create duplicates).
3. Create or update tasks via the HTTP API with thorough `description` and well-chosen `tags`.
4. Tell the user concisely what you did.
