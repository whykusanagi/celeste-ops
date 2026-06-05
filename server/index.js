#!/usr/bin/env node
// CelesteOps Claude Desktop extension — stdio MCP server.
//
// This is a THIN SHIM. It holds no business logic and never touches the
// SQLite database directly. Every tool forwards to the *running* CelesteOps
// app over its local HTTP API (default http://127.0.0.1:43121), so the app
// stays the single writer and its UI live-updates the moment Claude makes a
// change. If the app isn't running, fetch() fails and we surface a clear
// "open the app" error rather than a raw ECONNREFUSED.
//
// Pure Node (global fetch, Node 18+) + @modelcontextprotocol/sdk + zod, so it
// runs on Claude Desktop's bundled Node runtime with no Bun/native deps.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Validate the port (defends against the "1@evil.com" host-pivot — SECURITY-SPEC §5).
const PORT_RAW = process.env.CELESTE_OPS_API_PORT || '43121';
const PORT_NUM = Number(PORT_RAW);
if (!Number.isInteger(PORT_NUM) || PORT_NUM < 1 || PORT_NUM > 65535) {
  throw new Error(`Invalid CELESTE_OPS_API_PORT: ${JSON.stringify(PORT_RAW)} (must be 1-65535)`);
}
const BASE_URL = `http://127.0.0.1:${PORT_NUM}`;
// Trust boundary: the shim trusts whatever process holds the loopback port. On
// a multi-user host another local user could squat it; the token limits what a
// squatter learns (it only sees this client's traffic, not credentials, which
// the API redacts to non-first-party callers). A full fix (server identity
// handshake) is tracked in SECURITY-SPEC.
// Token-trust auth (SECURITY-SPEC §2): the installer enrolls this client and
// writes its token here. Sent as a Bearer header on every request.
const API_TOKEN = process.env.CELESTE_OPS_TOKEN || '';

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function api(method, path, body) {
  let res;
  try {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (API_TOKEN) headers['authorization'] = `Bearer ${API_TOKEN}`;
    res = await fetch(BASE_URL + path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `CelesteOps isn't reachable at ${BASE_URL} — is the app running? (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    throw new Error(`API ${method} ${path} failed: ${msg}`);
  }
  return data;
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

function textResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const THUMBNAIL_BASE_URL = 'https://whykusanagi.xyz/tools/thumbnail-generator/';
function buildThumbnailUrl(p) {
  const s = new URLSearchParams();
  if (p.title) s.set('title', p.title);
  if (p.subtitle) s.set('subtitle', p.subtitle);
  if (p.characterImage) s.set('characterImage', p.characterImage);
  if (p.glowColor) s.set('glowColor', p.glowColor);
  const str = s.toString();
  return str ? `${THUMBNAIL_BASE_URL}?${str}` : THUMBNAIL_BASE_URL;
}

function ymd() {
  return new Date().toISOString().slice(0, 10);
}

// ── Shared schemas ───────────────────────────────────────────────────────────

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TaskAreaSchema = z.enum(['content', 'stream', 'interview', 'ops', 'health']);
const TaskPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
const TaskStatusSchema = z.enum(['todo', 'doing', 'done', 'blocked']);
const ContentStageSchema = z.enum(['idea', 'outline', 'record', 'edit', 'post', 'repurpose']);
const StreamTypeSchema = z.enum(['subathon', 'stream', 'special', 'rest']);
const MilestoneTypeSchema = z.enum(['subs', 'donations', 'hours', 'raids', 'custom']);
const AssetTypeSchema = z.enum(['thumbnail', 'overlay', 'image', 'other']);
const PostPlatformSchema = z.enum(['twitter', 'bluesky', 'instagram', 'tiktok', 'other']);
const PostStatusSchema = z.enum(['draft', 'ready', 'posted']);
const AttachmentEntitySchema = z.enum(['task', 'content_item']);
const ReviewStatusSchema = z.enum(['in-review', 'approved', 'modified']);
const ThumbnailParamsSchema = z.object({
  title: z.string().default(''),
  subtitle: z.string().default(''),
  characterImage: z.string().default(''),
  glowColor: z.string().default('magenta'),
});

const TaskFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  area: TaskAreaSchema,
  priority: TaskPrioritySchema.default('P1'),
  status: TaskStatusSchema.default('todo'),
  due_date: DATE.nullable().optional(),
  estimate_min: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string()).optional(),
  task_kind: z.enum(['human', 'ai']).optional(),
  repo: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  commit_sha: z.string().nullable().optional(),
  blocked_by: z.array(z.string()).optional(),
};

const StreamEventFields = {
  date: DATE,
  title: z.string().min(1),
  stream_type: StreamTypeSchema.default('stream'),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  notes: z.string().optional(),
  thumbnail_url: z.string().nullable().optional(),
  thumbnail_params: ThumbnailParamsSchema.optional(),
  tags: z.array(z.string()).optional(),
};

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'celeste-ops-mcp', version: '1.0.0' });

// ---- Tasks -------------------------------------------------------------------

server.registerTool('today_dashboard_get', {
  title: 'Get Today Dashboard',
  description:
    'Returns the daily planning dashboard for a given date. Call this first at the start of every session to understand current workload. Returns top3, overdue, dueToday, and p1ActiveCount. IMPORTANT: p1ActiveCount gates new P1 creation — max 3 active P1s at any time.',
  inputSchema: { day: DATE.optional().describe('YYYY-MM-DD; defaults to today') },
}, async ({ day }) => {
  const r = await api('GET', `/api/today${qs({ day })}`);
  return textResult({ day: r.day, ...r.dashboard });
});

server.registerTool('tasks_list', {
  title: 'List Tasks',
  description:
    'List tasks with optional filters. Returns {count, tasks[]}. Filter by area, status, priority, dueDate, taskKind ("human"|"ai"), repo (exact match), or tag (membership). To find all work for a project: tasks_list({ repo: "<repo>" }). To find cross-cutting work: tasks_list({ tag: "security" }). Combine filters to narrow.',
  inputSchema: {
    area: TaskAreaSchema.optional(),
    status: TaskStatusSchema.optional(),
    dueDate: DATE.optional(),
    priority: TaskPrioritySchema.optional(),
    taskKind: z.enum(['human', 'ai']).optional(),
    repo: z.string().optional(),
    tag: z.string().optional(),
  },
}, async (filters) => {
  const r = await api('GET', `/api/tasks${qs(filters)}`);
  return textResult({ count: r.tasks.length, tasks: r.tasks });
});

server.registerTool('tasks_search', {
  title: 'Search Tasks (Full-Text)',
  description:
    'Full-text search across task titles, descriptions, tags, repo, and branch (SQLite FTS5 + bm25). Returns {count, hits[]} where each hit has a `snippet` excerpt with **bold** match markers.',
  inputSchema: {
    q: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
  },
}, async ({ q, limit }) => {
  const r = await api('GET', `/api/tasks/search${qs({ q, limit })}`);
  return textResult({ count: r.hits.length, hits: r.hits });
});

server.registerTool('tasks_unblocked', {
  title: 'List Tasks Ready to Start (Blockers Done)',
  description:
    'Returns todo tasks whose every blocked_by id resolves to a done task. Tasks with no blockers are excluded by default; pass includeNoBlockers=true to include them.',
  inputSchema: { includeNoBlockers: z.boolean().optional() },
}, async ({ includeNoBlockers }) => {
  const r = await api('GET', `/api/tasks/unblocked${qs({ includeNoBlockers })}`);
  return textResult({ count: r.tasks.length, tasks: r.tasks });
});

server.registerTool('task_create', {
  title: 'Create Task',
  description:
    "Create a single task. BUSINESS RULE: max 3 P1 tasks in todo|doing per due_date — check p1ActiveCount from today_dashboard_get first. area: content|stream|interview|ops|health. priority: P0=blocker, P1=today, P2=this week, P3=backlog. Put context (file paths, commit SHA, links, reasoning) in description. Set task_kind='ai' for agent-to-agent tasks; populate repo/branch/commit_sha for code-linked work.",
  inputSchema: TaskFields,
}, async (input) => {
  const r = await api('POST', '/api/tasks', input);
  return textResult({ created: r.task });
});

server.registerTool('task_update', {
  title: 'Update Task',
  description:
    "Patch any field on a task. At least one field required. Complete with {status:'done'}, block with {status:'blocked'}, reschedule with {due_date:'YYYY-MM-DD'}, stamp work with {commit_sha:'<sha>'}. Cannot patch id/created_at. Returns the updated task.",
  inputSchema: {
    id: z.string().min(1),
    patch: z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      area: TaskAreaSchema.optional(),
      priority: TaskPrioritySchema.optional(),
      status: TaskStatusSchema.optional(),
      due_date: DATE.nullable().optional(),
      estimate_min: z.number().int().positive().nullable().optional(),
      tags: z.array(z.string()).optional(),
      task_kind: z.enum(['human', 'ai']).optional(),
      repo: z.string().nullable().optional(),
      branch: z.string().nullable().optional(),
      commit_sha: z.string().nullable().optional(),
      blocked_by: z.array(z.string()).optional(),
    }).refine((o) => Object.keys(o).length > 0, 'patch cannot be empty'),
  },
}, async ({ id, patch }) => {
  const r = await api('PATCH', `/api/tasks/${encodeURIComponent(id)}`, patch);
  return textResult({ updated: r.task });
});

server.registerTool('task_delete', {
  title: 'Delete Task',
  description:
    "Permanently delete a task by id. Irreversible — no soft delete. Prefer {status:'done'} via task_update to preserve history. Returns {deleted: id}.",
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/tasks/${encodeURIComponent(id)}`)));

server.registerTool('tasks_create_batch', {
  title: 'Create Tasks Batch',
  description:
    'Create 1–100 tasks. Each item uses the same fields as task_create. Returns {createdCount, created[]}. Note: the P1 cap (max 3 active per due_date) is enforced per task — later P1s in a batch may fail if the cap is hit mid-batch.',
  inputSchema: {
    tasks: z.array(z.object({ ...TaskFields, priority: TaskPrioritySchema.default('P2') })).min(1).max(100),
  },
}, async ({ tasks }) => {
  // No batch route for tasks on the API — loop POSTs sequentially so the
  // server-side P1 cap is evaluated in order, matching the in-app behavior.
  const created = [];
  for (const t of tasks) {
    const r = await api('POST', '/api/tasks', t);
    created.push(r.task);
  }
  return textResult({ createdCount: created.length, created });
});

// ---- Pipeline ----------------------------------------------------------------

server.registerTool('pipeline_list', {
  title: 'List Pipeline Items',
  description:
    'List all content pipeline items. Stage order: idea → outline → record → edit → post → repurpose. Returns {count, items[]}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/pipeline');
  return textResult({ count: r.items.length, items: r.items });
});

server.registerTool('pipeline_create', {
  title: 'Create Pipeline Item',
  description:
    "Create a content piece (default stage: idea). platforms is a free-form string array; notes holds briefs/outlines. Returns {created: item}.",
  inputSchema: {
    title: z.string().min(1),
    stage: ContentStageSchema.default('idea'),
    platforms: z.array(z.string()).optional(),
    notes: z.string().optional(),
  },
}, async (input) => {
  const r = await api('POST', '/api/pipeline', input);
  return textResult({ created: r.item });
});

server.registerTool('pipeline_update', {
  title: 'Update Pipeline Item',
  description: "Patch a pipeline item's title, platforms, or notes. Use pipeline_move to change stage. Returns {updated: item}.",
  inputSchema: {
    id: z.string().min(1),
    patch: z.object({
      title: z.string().min(1).optional(),
      stage: ContentStageSchema.optional(),
      platforms: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }).refine((o) => Object.keys(o).length > 0, 'patch cannot be empty'),
  },
}, async ({ id, patch }) => {
  const r = await api('PATCH', `/api/pipeline/${encodeURIComponent(id)}`, patch);
  return textResult({ updated: r.item });
});

server.registerTool('pipeline_move', {
  title: 'Move Pipeline Item',
  description: 'Move a content item to a specific stage (idea → outline → record → edit → post → repurpose). Returns {updated: item}.',
  inputSchema: { id: z.string().min(1), stage: ContentStageSchema },
}, async ({ id, stage }) => {
  const r = await api('PATCH', `/api/pipeline/${encodeURIComponent(id)}`, { stage });
  return textResult({ updated: r.item });
});

server.registerTool('pipeline_delete', {
  title: 'Delete Pipeline Item',
  description: 'Permanently delete a pipeline item by id. Irreversible. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/pipeline/${encodeURIComponent(id)}`)));

// ---- Daily export / brief / notes -------------------------------------------

server.registerTool('daily_export_generate', {
  title: 'Generate Daily Export Pack',
  description:
    'Generate DAILY_BRIEF.md, STREAM_PLAN.md, and POSTS_TODO.md for a day into data/exports/YYYY-MM-DD/. Returns {result:{folder}}. Call every morning. day defaults to today.',
  inputSchema: { day: DATE.optional() },
}, async ({ day }) => textResult(await api('POST', '/api/daily-export', { day: day ?? ymd() })));

server.registerTool('daily_brief_get', {
  title: 'Get Daily Brief Record',
  description:
    'Read a previously generated daily brief record for a specific day. Returns {brief} or null if daily_export_generate has not been called for that day yet.',
  inputSchema: { day: DATE },
}, async ({ day }) => textResult(await api('GET', `/api/daily-brief${qs({ day })}`)));

server.registerTool('daily_note_get_or_create', {
  title: "Get or Create Today's Daily Note",
  description:
    'Returns the daily note document for the given day, creating it (auto-populated once from that day\'s dashboard with [[task:<id>]] wikilinks) on first access. Returns {document, created}. Day defaults to today.',
  inputSchema: { day: DATE.optional() },
}, async ({ day }) => textResult(await api('POST', '/api/daily-notes', { day: day ?? ymd() })));

server.registerTool('daily_notes_list', {
  title: 'List Daily Notes',
  description: 'Returns every existing daily note document, most recent first. Returns {count, daily_notes[]}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/daily-notes');
  return textResult({ count: r.daily_notes.length, daily_notes: r.daily_notes });
});

// ---- Settings ----------------------------------------------------------------

server.registerTool('settings_get', {
  title: 'Get Settings',
  description:
    'Read current app settings (autoBackup, autoBackupHour, defaultCadence, R2 fields, appInstanceId). R2 fields are required for backup_run_manual.',
  inputSchema: {},
}, async () => textResult(await api('GET', '/api/settings')));

server.registerTool('settings_update', {
  title: 'Update Settings',
  description:
    'Patch settings fields. autoBackupHour is 24h (0–23). defaultCadence keys are lowercase weekday names. Do NOT set R2 credentials here — use the UI Settings panel to avoid exposing secrets.',
  inputSchema: {
    patch: z.object({
      autoBackup: z.boolean().optional(),
      autoBackupHour: z.number().int().min(0).max(23).optional(),
      defaultCadence: z.record(z.string(), z.string()).optional(),
    }).refine((o) => Object.keys(o).length > 0, 'patch cannot be empty'),
  },
}, async ({ patch }) => textResult(await api('PATCH', '/api/settings', { patch })));

// ---- Backups -----------------------------------------------------------------

server.registerTool('backup_run_manual', {
  title: 'Run Manual Backup',
  description:
    'Zip the DB + exports + settings and upload to Cloudflare R2. PREREQUISITE: R2 credentials configured in Settings. Returns {backup:{r2_key, r2_url, size_bytes, created_at}}.',
  inputSchema: {},
}, async () => textResult(await api('POST', '/api/backups/run')));

server.registerTool('backups_list', {
  title: 'List Backups',
  description: 'List backup metadata records, most recent first. limit default 20, max 200.',
  inputSchema: { limit: z.number().int().min(1).max(200).optional() },
}, async ({ limit }) => textResult(await api('GET', `/api/backups${qs({ limit })}`)));

// ---- Stream events -----------------------------------------------------------

server.registerTool('stream_event_create', {
  title: 'Create Stream Event',
  description:
    "Create a stream day entry. stream_type: subathon|stream|special|rest. start_time/end_time are HH:MM 24h. thumbnail_params stores generator config {title, subtitle, characterImage, glowColor}. Returns {created: event}.",
  inputSchema: StreamEventFields,
}, async (input) => {
  const r = await api('POST', '/api/stream-events', input);
  return textResult({ created: r.event });
});

server.registerTool('stream_event_get', {
  title: 'Get Stream Event',
  description:
    'Look up a single stream event by its UUID id OR its calendar date (YYYY-MM-DD). Returns {event} or null. Exactly one of id or date must be provided.',
  inputSchema: { date: DATE.optional(), id: z.string().optional() },
}, async ({ date, id }) => {
  if (!id && !date) throw new Error('Provide id or date');
  if (date) {
    const r = await api('GET', `/api/stream-events${qs({ from: date, to: date })}`);
    return textResult({ event: r.events[0] ?? null });
  }
  const r = await api('GET', '/api/stream-events');
  return textResult({ event: r.events.find((e) => e.id === id) ?? null });
});

server.registerTool('stream_event_update', {
  title: 'Update Stream Event',
  description: 'Patch any field on a stream event including its date (for rescheduling). At least one field required. Returns {updated: event}.',
  inputSchema: {
    id: z.string().min(1),
    patch: z.object({
      date: DATE.optional(),
      title: z.string().min(1).optional(),
      stream_type: StreamTypeSchema.optional(),
      start_time: z.string().nullable().optional(),
      end_time: z.string().nullable().optional(),
      notes: z.string().optional(),
      thumbnail_url: z.string().nullable().optional(),
      thumbnail_params: ThumbnailParamsSchema.optional(),
      tags: z.array(z.string()).optional(),
    }).refine((o) => Object.keys(o).length > 0, 'patch cannot be empty'),
  },
}, async ({ id, patch }) => {
  const r = await api('PATCH', `/api/stream-events/${encodeURIComponent(id)}`, patch);
  return textResult({ updated: r.event });
});

server.registerTool('stream_event_delete', {
  title: 'Delete Stream Event',
  description: 'Delete a stream event by id. Does NOT cascade-delete scheduled_posts. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/stream-events/${encodeURIComponent(id)}`)));

server.registerTool('stream_events_list', {
  title: 'List Stream Events',
  description: 'List stream events with optional inclusive from/to date range. Omit both for all. Returns {count, events[]}.',
  inputSchema: { from: DATE.optional(), to: DATE.optional() },
}, async ({ from, to }) => {
  const r = await api('GET', `/api/stream-events${qs({ from, to })}`);
  return textResult({ count: r.events.length, events: r.events });
});

server.registerTool('stream_events_batch_create', {
  title: 'Batch Create Stream Events',
  description: 'Create up to 31 stream events in one call to scaffold a month. Each uses the stream_event_create schema. Returns {createdCount, created[]}.',
  inputSchema: { events: z.array(z.object(StreamEventFields)).min(1).max(31) },
}, async ({ events }) => {
  const r = await api('POST', '/api/stream-events/batch', { events });
  return textResult({ createdCount: r.created.length, created: r.created });
});

server.registerTool('thumbnail_url_build', {
  title: 'Build Thumbnail Generator URL',
  description:
    "Build a URL to the thumbnail generator from stored or explicit params. Provide stream_event_id to use a stream event's stored thumbnail_params, OR explicit params {title, subtitle, characterImage, glowColor}. Returns {url}.",
  inputSchema: { stream_event_id: z.string().optional(), params: ThumbnailParamsSchema.optional() },
}, async ({ stream_event_id, params }) => {
  let p = params;
  if (stream_event_id) {
    const r = await api('GET', '/api/stream-events');
    p = r.events.find((e) => e.id === stream_event_id)?.thumbnail_params ?? params;
  }
  if (!p) throw new Error('Provide stream_event_id or params');
  return textResult({ url: buildThumbnailUrl(p) });
});

// ---- Milestones --------------------------------------------------------------

server.registerTool('milestone_create', {
  title: 'Create Milestone',
  description:
    "Create a subathon goal. milestone_type: subs|donations|hours|raids|custom. target_value is the numeric goal; current_value starts at 0. color is CSS hex (default #ff5fb0). Returns {created: milestone}.",
  inputSchema: {
    label: z.string().min(1),
    milestone_type: MilestoneTypeSchema.default('custom'),
    target_value: z.number().int().positive(),
    current_value: z.number().int().min(0).optional(),
    color: z.string().optional(),
    display_order: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  },
}, async (input) => {
  const r = await api('POST', '/api/milestones', {
    ...input,
    current_value: input.current_value ?? 0,
    color: input.color ?? '#ff5fb0',
    reached_at: null,
    display_order: input.display_order ?? 0,
    notes: input.notes ?? '',
  });
  return textResult({ created: r.milestone });
});

server.registerTool('milestone_list', {
  title: 'List Milestones',
  description: 'List all milestones ordered by display_order asc. Returns {count, milestones[]}. Use current_value/target_value for progress %.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/milestones');
  return textResult({ count: r.milestones.length, milestones: r.milestones });
});

server.registerTool('milestone_update', {
  title: 'Update Milestone',
  description: "Update milestone progress/metadata. Record progress with {current_value:<n>}; mark reached with {reached_at:'<ISO8601>', current_value:<target>}. Returns {updated: milestone}.",
  inputSchema: {
    id: z.string().min(1),
    patch: z.object({
      label: z.string().optional(),
      target_value: z.number().int().positive().optional(),
      current_value: z.number().int().min(0).optional(),
      color: z.string().optional(),
      reached_at: z.string().nullable().optional(),
      display_order: z.number().int().min(0).optional(),
      notes: z.string().optional(),
    }).refine((o) => Object.keys(o).length > 0, 'patch cannot be empty'),
  },
}, async ({ id, patch }) => {
  const r = await api('PATCH', `/api/milestones/${encodeURIComponent(id)}`, patch);
  return textResult({ updated: r.milestone });
});

server.registerTool('milestone_delete', {
  title: 'Delete Milestone',
  description: 'Delete a milestone by id. Irreversible. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/milestones/${encodeURIComponent(id)}`)));

// ---- Assets ------------------------------------------------------------------

server.registerTool('asset_add', {
  title: 'Add Asset',
  description:
    "Register a media asset. asset_type: thumbnail|overlay|image|other. source_url is where it came from; local_path if stored locally. r2_key/r2_url are set via the UI upload — do not set manually. Returns {created: asset}.",
  inputSchema: {
    name: z.string().min(1),
    asset_type: AssetTypeSchema.default('image'),
    source_url: z.string().nullable().optional(),
    local_path: z.string().nullable().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
}, async (input) => {
  const r = await api('POST', '/api/assets', {
    name: input.name,
    asset_type: input.asset_type ?? 'image',
    source_url: input.source_url ?? null,
    local_path: input.local_path ?? null,
    r2_key: null,
    r2_url: null,
    file_size_bytes: null,
    tags: input.tags ?? [],
    notes: input.notes ?? '',
  });
  return textResult({ created: r.asset });
});

server.registerTool('asset_list', {
  title: 'List Assets',
  description: "List assets, optionally filtered by type (thumbnail|overlay|image|other). Returns {count, assets[]}.",
  inputSchema: { type: AssetTypeSchema.optional() },
}, async ({ type }) => {
  const r = await api('GET', `/api/assets${qs({ type })}`);
  return textResult({ count: r.assets.length, assets: r.assets });
});

server.registerTool('asset_delete', {
  title: 'Delete Asset',
  description: 'Delete an asset record by id. Does NOT delete the underlying file from disk or R2. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/assets/${encodeURIComponent(id)}`)));

// ---- Prototypes --------------------------------------------------------------

server.registerTool('prototype_create', {
  title: 'Create Prototype',
  description: 'Create an HTML prototype artifact (embed it in a doc via a ```prototype block with the returned id). User must approve before first render. Returns {prototype}.',
  inputSchema: { title: z.string().min(1), html: z.string().min(1), tags: z.array(z.string()).optional() },
}, async ({ title, html, tags }) =>
  textResult(await api('POST', '/api/prototypes', { title, html, tags: tags ?? [] })));

server.registerTool('prototype_update', {
  title: 'Update Prototype',
  description: 'Patch a prototype (title/html/tags). Editing html re-arms approval. Returns {prototype}.',
  inputSchema: { id: z.string().min(1), title: z.string().min(1).optional(), html: z.string().min(1).optional(), tags: z.array(z.string()).optional() },
}, async ({ id, title, html, tags }) => {
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (html !== undefined) patch.html = html;
  if (tags !== undefined) patch.tags = tags;
  return textResult(await api('PATCH', `/api/prototypes/${encodeURIComponent(id)}`, patch));
});

server.registerTool('prototype_get', {
  title: 'Get Prototype',
  description: 'Fetch a prototype by id (incl html + approval state + csp). Returns {prototype, approved, csp}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('GET', `/api/prototypes/${encodeURIComponent(id)}`)));

server.registerTool('prototype_list', {
  title: 'List Prototypes',
  description: 'List all prototypes (newest first). Returns {count, prototypes}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/prototypes');
  return textResult({ count: r.prototypes.length, prototypes: r.prototypes });
});

server.registerTool('prototype_delete', {
  title: 'Delete Prototype',
  description: 'Delete a prototype by id. Irreversible. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/prototypes/${encodeURIComponent(id)}`)));

// ---- Scheduled posts ---------------------------------------------------------

server.registerTool('scheduled_post_create', {
  title: 'Create Scheduled Post',
  description:
    "Create a social post, optionally linked to a stream event and/or asset. platform: twitter|bluesky|instagram|tiktok|other. status: draft → ready → posted. scheduled_for is ISO 8601 (informational only — no auto-posting). Returns {created: post}.",
  inputSchema: {
    content: z.string().min(1),
    platform: PostPlatformSchema.default('twitter'),
    stream_event_id: z.string().nullable().optional(),
    asset_id: z.string().nullable().optional(),
    scheduled_for: z.string().nullable().optional(),
    status: PostStatusSchema.default('draft'),
  },
}, async (input) => {
  const r = await api('POST', '/api/scheduled-posts', {
    content: input.content,
    platform: input.platform ?? 'twitter',
    stream_event_id: input.stream_event_id ?? null,
    asset_id: input.asset_id ?? null,
    scheduled_for: input.scheduled_for ?? null,
    status: input.status ?? 'draft',
  });
  return textResult({ created: r.post });
});

server.registerTool('scheduled_post_list', {
  title: 'List Scheduled Posts',
  description: "List scheduled posts with optional streamEventId, platform, and status filters. Returns {count, posts[]}.",
  inputSchema: {
    streamEventId: z.string().optional(),
    platform: PostPlatformSchema.optional(),
    status: PostStatusSchema.optional(),
  },
}, async (filters) => {
  const r = await api('GET', `/api/scheduled-posts${qs(filters)}`);
  return textResult({ count: r.posts.length, posts: r.posts });
});

server.registerTool('scheduled_post_update', {
  title: 'Update Scheduled Post',
  description: "Edit copy or advance status. Approve with {status:'ready'}, publish with {status:'posted'}. Returns {updated: post}.",
  inputSchema: {
    id: z.string().min(1),
    patch: z.object({
      content: z.string().min(1).optional(),
      platform: PostPlatformSchema.optional(),
      asset_id: z.string().nullable().optional(),
      scheduled_for: z.string().nullable().optional(),
      status: PostStatusSchema.optional(),
    }).refine((o) => Object.keys(o).length > 0, 'patch cannot be empty'),
  },
}, async ({ id, patch }) => {
  const r = await api('PATCH', `/api/scheduled-posts/${encodeURIComponent(id)}`, patch);
  return textResult({ updated: r.post });
});

server.registerTool('scheduled_post_delete', {
  title: 'Delete Scheduled Post',
  description: 'Delete a scheduled post by id. Irreversible. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/scheduled-posts/${encodeURIComponent(id)}`)));

// ---- Calendar ----------------------------------------------------------------

server.registerTool('calendar_get_month', {
  title: 'Get Calendar Month',
  description:
    'Get a full month view combining stream events, per-day task counts, and milestones in one call. ALWAYS call this first when planning/reviewing a month. Defaults to the current month.',
  inputSchema: {
    year: z.number().int().min(2024).max(2030).optional(),
    month: z.number().int().min(1).max(12).optional(),
  },
}, async ({ year, month }) => textResult(await api('GET', `/api/calendar${qs({ year, month })}`)));

// ---- Documents ---------------------------------------------------------------

server.registerTool('documents_list', {
  title: 'List Documents',
  description: 'List documents, most-recent-first, each with attachments[]. Returns {count, documents[]}. Pass folder to scope to a project: documents_list({ folder: "<repo>" }) returns that repo plus its sub-folders (e.g. <repo>/specs, <repo>/plans). Pass review_status to filter by approval state (e.g. "in-review").',
  inputSchema: {
    folder: z.string().optional(),
    review_status: ReviewStatusSchema.optional(),
  },
}, async (filter) => {
  const r = await api('GET', `/api/documents${qs(filter)}`);
  return textResult({ count: r.documents.length, documents: r.documents });
});

server.registerTool('document_get', {
  title: 'Get Document',
  description: 'Fetch a single document by id. Returns {document, comments, decisions}. Errors 404 if not found.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('GET', `/api/documents/${encodeURIComponent(id)}`)));

server.registerTool('document_create', {
  title: 'Create Document',
  description:
    'Create a document. Body is GFM markdown with [[wikilink]] / [[task:<id>]] / [[doc:<id>]] / [[item:<id>]] refs. Use `folder` (slash path like "celeste-cli/specs") for sidebar grouping; null = Unfiled. For specs/plans set review_status:"in-review" to surface Approve/Mark Modified. Returns {document}.',
  inputSchema: {
    title: z.string().min(1),
    body: z.string(),
    tags: z.array(z.string()).optional(),
    folder: z.string().nullable().optional(),
    review_status: ReviewStatusSchema.nullable().optional(),
  },
}, async (input) => textResult(await api('POST', '/api/documents', {
  title: input.title,
  body: input.body,
  tags: input.tags ?? [],
  folder: input.folder ?? null,
  review_status: input.review_status ?? null,
})));

server.registerTool('document_update', {
  title: 'Update Document',
  description: 'Patch a document. At least one of title/body/tags/folder/review_status required. Returns {document}. NOTE: if the doc is in a review workflow (review_status "in-review" or "approved") and you change its content WITHOUT also passing review_status, it auto-flips to "modified" and bumps review_status_updated_at — signaling a watcher to re-read it from CelesteOps rather than trust a cached copy. Pass review_status explicitly to edit without signaling. Docs with review_status=null never auto-flip.',
  inputSchema: {
    id: z.string().min(1),
    patch: z.object({
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      folder: z.string().nullable().optional(),
      review_status: ReviewStatusSchema.nullable().optional(),
    }),
  },
}, async ({ id, patch }) => textResult(await api('PATCH', `/api/documents/${encodeURIComponent(id)}`, patch)));

server.registerTool('document_set_review_status', {
  title: 'Set Document Review Status',
  description:
    'Set/clear review_status: "in-review" (awaiting user), "approved", "modified", or null. Atomic single-purpose version of document_update for the approval workflow. Returns {document}.',
  inputSchema: { id: z.string().min(1), review_status: ReviewStatusSchema.nullable() },
}, async ({ id, review_status }) => textResult(await api('PATCH', `/api/documents/${encodeURIComponent(id)}`, { review_status })));

server.registerTool('document_folders_list', {
  title: 'List Document Folders',
  description: 'Returns every unique folder path with its doc count ("" = Unfiled). Reuse existing paths instead of inventing new ones. Returns {count, folders[]}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/folders');
  return textResult({ count: r.folders.length, folders: r.folders });
});

server.registerTool('document_delete', {
  title: 'Delete Document',
  description: 'Delete a document (cascades its attachments). Irreversible. Returns {deleted: id}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('DELETE', `/api/documents/${encodeURIComponent(id)}`)));

server.registerTool('document_attach', {
  title: 'Attach Document to Entity',
  description: 'Link a document to a task or content_item (multi-attach, idempotent). Returns {ok: true}.',
  inputSchema: {
    document_id: z.string().min(1),
    entity_type: AttachmentEntitySchema,
    entity_id: z.string().min(1),
  },
}, async ({ document_id, entity_type, entity_id }) =>
  textResult(await api('POST', `/api/documents/${encodeURIComponent(document_id)}/attach`, { entity_type, entity_id })));

server.registerTool('document_detach', {
  title: 'Detach Document from Entity',
  description: 'Remove a single attachment between a document and a task or content_item. The document is preserved. Returns {ok: true}.',
  inputSchema: {
    document_id: z.string().min(1),
    entity_type: AttachmentEntitySchema,
    entity_id: z.string().min(1),
  },
}, async ({ document_id, entity_type, entity_id }) =>
  textResult(await api('DELETE', `/api/documents/${encodeURIComponent(document_id)}/attach/${entity_type}/${encodeURIComponent(entity_id)}`)));

server.registerTool('documents_for_entity', {
  title: 'List Documents Attached to an Entity',
  description: 'List all documents attached to a specific task or content_item. Returns {count, documents[]}.',
  inputSchema: { entity_type: AttachmentEntitySchema, entity_id: z.string().min(1) },
}, async ({ entity_type, entity_id }) => {
  const seg = entity_type === 'task' ? 'tasks' : 'content-items';
  const r = await api('GET', `/api/${seg}/${encodeURIComponent(entity_id)}/documents`);
  return textResult({ count: r.documents.length, documents: r.documents });
});

server.registerTool('document_backlinks', {
  title: 'Find Documents/Tasks/Items Linking to a Document',
  description: 'Return every doc, task, and content_item whose body/description/notes wikilinks to the given document. Returns {backlinks:{docs[], tasks[], items[]}}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => textResult(await api('GET', `/api/documents/${encodeURIComponent(id)}/backlinks`)));

server.registerTool('documents_search', {
  title: 'Search Documents (Full-Text)',
  description: 'Full-text search across document titles, bodies, and tags (FTS5 + bm25). Returns {count, hits[]} with **bold**-marked snippets.',
  inputSchema: { q: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
}, async ({ q, limit }) => {
  const r = await api('GET', `/api/documents/search${qs({ q, limit })}`);
  return textResult({ count: r.hits.length, hits: r.hits });
});

server.registerTool('documents_pending_review', {
  title: 'List Documents Awaiting Review',
  description: 'Returns every document in review_status "in-review", oldest pending first. Returns {count, documents[]}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/documents/pending-review');
  return textResult({ count: r.documents.length, documents: r.documents });
});

server.registerTool('documents_review_changes_since', {
  title: 'Poll for Review State Changes',
  description:
    'Returns every document whose review_status was set/changed at/after the given ISO timestamp. Pass `ids` to scope to specific docs (typical agent flow). Returns {count, documents[]}.',
  inputSchema: {
    since: z.string().describe('ISO timestamp, e.g. "2026-05-28T07:30:00.000Z"'),
    ids: z.array(z.string()).optional(),
  },
}, async ({ since, ids }) => {
  const r = await api('GET', `/api/documents/review-changes${qs({ since, ids: ids ? ids.join(',') : undefined })}`);
  return textResult({ count: r.documents.length, documents: r.documents });
});

server.registerTool('document_comment_add', {
  title: 'Add Document Comment',
  description: 'Append a free-form comment to a document (author recorded as "agent"). Returns {comment}.',
  inputSchema: { document_id: z.string().min(1), body: z.string().min(1) },
}, async ({ document_id, body }) =>
  textResult(await api('POST', `/api/documents/${encodeURIComponent(document_id)}/comments`, { body, author: 'agent' })));

server.registerTool('document_comments_list', {
  title: 'List Document Comments',
  description: 'List a document\'s comments in chronological order. Returns {comments}.',
  inputSchema: { document_id: z.string().min(1) },
}, async ({ document_id }) =>
  textResult(await api('GET', `/api/documents/${encodeURIComponent(document_id)}/comments`)));

server.registerTool('document_decision_create', {
  title: 'Create Document Decision',
  description: 'Attach a decision (prompt + 2+ options) to a document. Returns {decision} with generated option ids.',
  inputSchema: {
    document_id: z.string().min(1),
    prompt: z.string().min(1),
    options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).min(2),
  },
}, async ({ document_id, prompt, options }) =>
  textResult(await api('POST', `/api/documents/${encodeURIComponent(document_id)}/decisions`, { prompt, options })));

server.registerTool('document_decision_resolve', {
  title: 'Resolve Document Decision',
  description: 'Resolve an open decision with a chosen option and/or note (at least one). Returns {decision}.',
  inputSchema: { id: z.string().min(1), chosen_option_id: z.string().optional(), resolution_note: z.string().optional() },
}, async ({ id, chosen_option_id, resolution_note }) =>
  textResult(await api('POST', `/api/decisions/${encodeURIComponent(id)}/resolve`, { chosen_option_id, resolution_note })));

server.registerTool('document_decision_cancel', {
  title: 'Cancel Document Decision',
  description: 'Cancel an open decision. Returns {decision}.',
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) =>
  textResult(await api('POST', `/api/decisions/${encodeURIComponent(id)}/cancel`, {})));

server.registerTool('documents_pending_decisions', {
  title: 'Documents Pending Decisions',
  description: 'Every document with at least one open decision. Returns {count, pending}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/documents/pending-decisions');
  return textResult({ count: r.pending.length, pending: r.pending });
});

server.registerTool('documents_decision_changes_since', {
  title: 'Documents Decision Changes Since',
  description: 'Documents whose decisions changed at/after an ISO timestamp. Returns {count, documents}.',
  inputSchema: { since: z.string().min(1), ids: z.array(z.string()).optional() },
}, async ({ since, ids }) => {
  const r = await api('GET', `/api/documents/decision-changes${qs({ since, ids: ids ? ids.join(',') : undefined })}`);
  return textResult({ count: r.documents.length, documents: r.documents });
});

// ---- Cross-cutting -----------------------------------------------------------

server.registerTool('tags_list', {
  title: 'List All Tags (Aggregated Across Docs + Tasks)',
  description: 'Returns every unique tag across documents and tasks with usage counts, sorted by total desc. Returns {count, tags:[{tag, doc_count, task_count, total}]}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/tags');
  return textResult({ count: r.tags.length, tags: r.tags });
});

server.registerTool('projects_list', {
  title: 'List Projects (Cross-Repo Rollup)',
  description:
    'Returns every repository with a rollup of tasks, docs, and pending reviews, sorted by open_task_count desc. Use at session start to scope into a project. Returns {count, projects[]}.',
  inputSchema: {},
}, async () => {
  const r = await api('GET', '/api/projects');
  return textResult({ count: r.projects.length, projects: r.projects });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[celeste-ops-mcp] extension running on stdio → ${BASE_URL}`);
}

main().catch((error) => {
  console.error('[celeste-ops-mcp] fatal', error);
  process.exit(1);
});
