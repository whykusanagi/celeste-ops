---
name: "celesteops-review"
description: "Use when the user asks an agent to review specs, plans, notes, pending approvals, or content tracked in CelesteOps. Prefer the CelesteOps MCP tools when available; start from the pending-review queue or project rollups, read linked documents and tasks for context, summarize decision points, and only change review state when the user explicitly asks."
---

# CelesteOps Review

Use this skill when CelesteOps is the source of truth for review state. The goal is to help the user understand what is waiting in CelesteOps, what each item is asking for, and what should happen next.

## Quick start

1. Confirm the session exposes CelesteOps MCP tools. Tool names may be namespaced; match by suffixes such as `documents_pending_review`, `document_get`, `document_set_review_status`, `documents_search`, `documents_for_entity`, `document_backlinks`, `tasks_search`, `tasks_list`, `projects_list`, and `pipeline_list`.
2. If CelesteOps tools are not available, inspect `../../README.md` for the MCP connection shape and tell the user the skill cannot operate the review queue until the MCP is attached. Do not mutate SQLite directly as a substitute.
3. For document review, start with `documents_pending_review`.
4. For repo-scoped review, also call `projects_list` and then the relevant task or document search tools.
5. For content-pipeline review rather than document approval, start with `pipeline_list`.

## Review rules

- Read the full document with `document_get` before recommending approval or modification.
- Pull surrounding context with `documents_for_entity`, `document_backlinks`, `tasks_search`, or `tasks_list` when a doc references a task, repo, feature, or prior plan.
- Treat CelesteOps as the workflow system of record. If auxiliary MCP tools such as `celeste_index` or `celeste_code_review` are available, use them only to validate claims or inspect referenced code; do not let them replace the CelesteOps review state.
- Summarize review items in operator language: what this is, what decision is being requested, notable risks, and the recommended next action.
- Only call `document_set_review_status` when the user explicitly asks to approve, mark modified, clear review state, or submit something for review.
- Avoid destructive cleanup during review. Prefer updating status or leaving notes over deleting docs or tasks.

## Deep references

- Use `references/review-workflow.md` for the normal decision tree and response shape.
- Use `../../MCP.md` only when you need exact tool contracts or edge-case behavior. It is the authoritative reference but much larger than the workflow guide.

If you need a narrow section from `MCP.md`, search it first:

```bash
rg -n "documents_pending_review|documents_review_changes_since|document_set_review_status|document_get|documents_for_entity|document_backlinks|projects_list|pipeline_list|tasks_search" ../../MCP.md
```
