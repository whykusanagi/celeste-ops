# CelesteOps review workflow

Use this reference for the common review loop so you do not need to load the full MCP manual.

## Document approval queue

1. Call `documents_pending_review`.
2. If the user names a repo, call `projects_list` first and keep the repo slug handy for later searches.
3. For each candidate document:
   - Call `document_get` for the full body.
   - Call `documents_for_entity` if the doc is attached to a task or content item.
   - Call `document_backlinks` if the doc looks like part of a larger spec chain.
   - Call `tasks_search` or `tasks_list` when the doc mentions a repo, branch, feature, or implementation task.
4. Summarize each item:
   - What it is
   - What decision is being requested
   - Risks, missing information, or inconsistencies
   - Recommended disposition: approve, modify, or ask follow-up
5. Change review state only on explicit instruction from the user:
   - `document_set_review_status({ review_status: "approved" })`
   - `document_set_review_status({ review_status: "modified" })`
   - `document_set_review_status({ review_status: null })`

## Content pipeline review

Use this when the user asks about creator content rather than review-status documents.

1. Call `pipeline_list`.
2. Group items by stage: `idea`, `outline`, `record`, `edit`, `post`, `repurpose`.
3. Read each item's `notes` field carefully; that is usually where review context lives.
4. When the user asks for a recommendation, summarize:
   - Which items are blocked
   - Which items are closest to shipping
   - Which items are missing notes, owners, or target platforms
5. Only call `pipeline_update` or `pipeline_move` when the user asks you to change the item.

## Good defaults

- Prefer CelesteOps search tools over guessing IDs from titles.
- Prefer `documents_search` or `tasks_search` once the corpus is large.
- If a review item references code changes, use any available code-review MCP to validate the technical claims before recommending approval.
- Keep recommendations specific. "Approve" is weaker than "Approve because the implementation plan names affected files, sequencing, rollback path, and dependency blockers."

## Repo-grounded references

- Full MCP contract: `../../MCP.md`
- Connection and architecture overview: `../../README.md`
