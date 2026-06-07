# CelesteOps review workflow

Use this reference for the common review loop so you do not need to load the full MCP manual.

## Document approval queue

1. Call `documents_pending_review` **and** `documents_pending_decisions`. The first is the review-status queue; the second (`{count, pending:[{document, decisions}]}`) is docs where an authoring agent attached a structured question the user must resolve — a doc can be in one queue, the other, or both. Use `documents_decision_changes_since({since, ids?})` to poll for resolutions on docs you already surfaced.
2. If the user names a repo, call `projects_list` first and keep the repo slug handy for later searches.
3. For each candidate document:
   - Call `document_get` for the full body. It returns `{document, comments, decisions}` — the embedded reasoning chain. Read the comments (agent annotations, prior approve-with-note reasons) and any pending decision (its `prompt` + `options`) so you present the doc and the open choice together.
   - Call `documents_for_entity` if the doc is attached to a task or content item.
   - Call `document_backlinks` if the doc looks like part of a larger spec chain.
   - Call `tasks_search` or `tasks_list` when the doc mentions a repo, branch, feature, or implementation task.
4. Summarize each item:
   - What it is
   - What decision is being requested — for an open decision, lay out the labelled options so the user can pick
   - Risks, missing information, or inconsistencies
   - Recommended disposition: approve, modify, resolve a decision, or ask follow-up
5. Change review state or resolve a decision only on explicit instruction from the user. These are user-driven; perform them only when asked:
   - `document_set_review_status({ review_status: "approved" })` (optionally with a note that is filed as a comment on the status change)
   - `document_set_review_status({ review_status: "modified" })`
   - `document_set_review_status({ review_status: null })`
   - `document_decision_resolve({ id, chosen_option_id?, resolution_note? })` — pass the option the user chose and/or their note (at least one). Decisions are append-only and stay on record after resolving.

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
