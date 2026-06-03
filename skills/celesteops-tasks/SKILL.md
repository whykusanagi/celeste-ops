---
name: celesteops-tasks
description: Use when reading, creating, or updating tasks and documents in CelesteOps, a local-first task planner that doubles as a cross-repo message board for AI agents. Triggers include "check CelesteOps", "what tasks for <repo>", "create a task in CelesteOps", "update task X", "leave a note for the <other-repo> agent", or any reference to "the task planner". Reach it via the celeste-ops MCP tools, or HTTP at http://127.0.0.1:43121.
---

# CelesteOps task planner — agent access

CelesteOps is a local-first creator control panel. It tracks tasks, a content
pipeline, stream events, milestones, assets, and documents. Agents working across
several repos use it as a shared message board: when you change repo A in a way
that affects repo B, leave a task tagged for repo B so the next agent there sees it.

Use the `celeste-ops` MCP tools when they're available (they're typed and
validated). HTTP is the fallback; examples below use it.

## 1. Confirm the app is running

```bash
curl -s http://127.0.0.1:43121/health
```

Expect `{"ok":true,...}`. Connection refused means the desktop app is closed: ask
the user to launch it. Don't start it yourself.

## 2. Find a project's work (minimal prompting)

1. `projects_list` — every project with open-task and doc counts.
2. `tasks_list({ repo: "<repo>" })` — that project's tasks. Add `status:"todo"` for
   actionable, or `tag:"<theme>"` for cross-cutting work.
3. `documents_list({ folder: "<repo>" })` — its specs, plans, notes, and drafts.

Over HTTP: `GET /api/tasks?repo=<repo>&status=todo`, `GET /api/documents?folder=<repo>`.

## 3. Create a task

```bash
curl -s -X POST http://127.0.0.1:43121/api/tasks \
  -H 'content-type: application/json' \
  -d '{
    "title": "Sync baseline in repo-b to match repo-a abc1234",
    "description": "repo-a changed lib/baseline.json (commit abc1234). The mirrored copy in repo-b/baseline.json is stale. Apply the same three-line diff.",
    "area": "ops",
    "priority": "P2",
    "status": "todo",
    "tags": ["repo-b", "repo-a", "sync"],
    "repo": "repo-b",
    "task_kind": "ai"
  }'
```

Field rules:

- `area`: `content`, `stream`, `interview`, `ops`, or `health`.
- `priority`: `P0` (blocker), `P1` (today, max 3 active per due-date), `P2` (this week), `P3` (backlog).
- `status`: `todo`, `doing`, `blocked`, `done`. Default `todo`.
- `repo`: the affected repo slug. Makes the task filterable by project.
- `task_kind`: `ai` for agent-authored tasks, `human` otherwise.
- `description`: put the reasoning, file paths, and commit SHAs here. The title alone rarely carries enough.

## 4. Update a task

```bash
curl -s -X PATCH http://127.0.0.1:43121/api/tasks/<id> \
  -H 'content-type: application/json' -d '{"status":"doing"}'
```

Patch any subset: `{"status":"done"}` to finish, `{"status":"blocked"}` when
waiting on something, `{"description":"..."}` to add context.

## 5. Documents

Specs, plans, and notes live as documents foldered by project: `<repo>/specs`,
`<repo>/plans`, `<repo>/notes`, `<repo>/drafts`. Create one with
`POST /api/documents` (or `document_create`), attach it to its task with
`document_attach`, and cross-link via `[[task:<id>]]` / `[[doc:<id>]]` wikilinks.

## Don't

- Don't write R2 credentials over the API. The user sets those in the app's
  Settings panel.
- Don't delete tasks unless asked. Use `{"status":"done"}` to preserve history.
- Don't bulk-create more than ~10 tasks at once without telling the user.
