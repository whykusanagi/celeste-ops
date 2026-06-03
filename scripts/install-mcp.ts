#!/usr/bin/env bun
/**
 * install-mcp.ts — wire every MCP client on this machine to the CelesteOps
 * MCP bridge.
 *
 * All clients are pointed at the SAME stdio shim (extension/server/index.js),
 * a pure-Node MCP server that forwards all 56 tools to the running app's HTTP
 * API (default 127.0.0.1:43121). This keeps the desktop app as the single
 * source of truth — its UI live-updates as any client makes changes — and
 * uses stdio between client and shim so it works the same in every client,
 * including sandboxed ones (Codex) that block direct loopback network.
 *
 * Each client config is *merged*, never clobbered: only the `celeste-ops`
 * entry is added/updated, every other server you have is preserved, and the
 * prior file is copied to `<file>.bak` before any write.
 *
 *   bun run install:mcp            # detect clients and write configs
 *   bun run install:mcp --dry-run  # show what would change, write nothing
 *   bun run install:mcp --port 50000
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, lstatSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const SERVER_NAME = 'celeste-ops';
const REPO_ROOT = resolve(import.meta.dir, '..');
const SHIM = join(REPO_ROOT, 'server', 'index.js');
const HOME = homedir();

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: bun run install:mcp [--dry-run] [--port <n>] [--pair <code>]');
  console.log('  --pair <code>  enroll each client with a pairing code from the app');
  console.log('                 (Settings → Connections → Add Client) so they authenticate.');
  process.exit(0);
}
const portArg = argv.indexOf('--port');
const PORT = portArg !== -1 && argv[portArg + 1] ? argv[portArg + 1] : '43121';
if (!/^\d{1,5}$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535) {
  console.error(`✗ invalid --port ${JSON.stringify(PORT)} (must be 1-65535)`);
  process.exit(1);
}

// Absolute node path: GUI clients (Claude Desktop, Cursor) don't inherit the
// shell PATH, so a bare "node" command fails to launch. Resolve it once here.
const NODE_BIN = Bun.which('node');
if (!NODE_BIN) {
  console.error('✗ node not found on PATH. Install Node 18+ and re-run.');
  process.exit(1);
}
if (!existsSync(SHIM)) {
  console.error(`✗ shim not found at ${SHIM}. Run \`npm install\` in server/ first.`);
  process.exit(1);
}

const PAIR = (() => { const i = argv.indexOf('--pair'); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; })();
const API = `http://127.0.0.1:${PORT}`;

// Enroll a client with the pairing code shown in the app's Connections panel
// and return its token (or null if pairing wasn't requested / failed). Each
// client gets its own token (per-service) — see docs/SECURITY-SPEC.md §2.4.
async function enroll(label: string): Promise<string | null> {
  if (!PAIR || DRY) return null; // never create real clients on a dry run
  try {
    const res = await fetch(`${API}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, kind: 'mcp-client', pairing_code: PAIR }),
    });
    if (!res.ok) {
      const j: any = await res.json().catch(() => ({}));
      console.error(`  ! enroll ${label}: ${res.status} ${j.error ?? ''}`);
      return null;
    }
    return ((await res.json()) as any).token ?? null;
  } catch (e) {
    console.error(`  ! enroll ${label}: ${e instanceof Error ? e.message : String(e)} (is the app running?)`);
    return null;
  }
}

function makeEnv(token: string | null): Record<string, string> {
  return token
    ? { CELESTE_OPS_API_PORT: PORT, CELESTE_OPS_TOKEN: token }
    : { CELESTE_OPS_API_PORT: PORT };
}
function makeJsonEntry(token: string | null) {
  return { command: NODE_BIN, args: [SHIM], env: makeEnv(token) };
}

type Result = 'wrote' | 'unchanged' | 'skipped' | 'would-write';

function backupAndWrite(file: string, content: string): Result {
  const exists = existsSync(file);
  if (exists && readFileSync(file, 'utf8') === content) return 'unchanged';
  if (DRY) return 'would-write';
  // Refuse to follow a symlink at a config path (could redirect the write — and
  // the CELESTE_OPS_TOKEN it carries — to an attacker-chosen target).
  if (exists && lstatSync(file).isSymbolicLink()) {
    console.error(`  ! ${file} is a symlink — refusing to write`);
    return 'skipped';
  }
  mkdirSync(dirname(file), { recursive: true });
  // Don't overwrite a good backup with a possibly-bad new one.
  if (exists && !existsSync(`${file}.bak`)) copyFileSync(file, `${file}.bak`);
  writeFileSync(file, content, { mode: 0o600 }); // configs carry a token → 0600
  try { chmodSync(file, 0o600); } catch { /* best effort on existing files */ }
  return 'wrote';
}

/** Merge our server into a JSON config's `mcpServers` map, preserving the rest. */
function upsertJson(file: string, alwaysCreate = false, token: string | null = null): Result {
  if (!existsSync(file) && !alwaysCreate) return 'skipped';
  let cfg: Record<string, any> = {};
  if (existsSync(file)) {
    try {
      cfg = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`  ! ${file} is not valid JSON — leaving it untouched (${e})`);
      return 'skipped';
    }
  }
  cfg.mcpServers ??= {};
  cfg.mcpServers[SERVER_NAME] = makeJsonEntry(token);
  return backupAndWrite(file, JSON.stringify(cfg, null, 2) + '\n');
}

/** Merge a `[mcp_servers.celeste-ops]` block into Codex's TOML, touching only that block. */
function upsertToml(file: string, token: string | null = null): Result {
  if (!existsSync(file)) return 'skipped';
  const original = readFileSync(file, 'utf8');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const block =
    `[mcp_servers.${SERVER_NAME}]\n` +
    `command = "${esc(NODE_BIN)}"\n` +
    `args = ["${esc(SHIM)}"]\n` +
    `startup_timeout_sec = 120\n\n` +
    `[mcp_servers.${SERVER_NAME}.env]\n` +
    `CELESTE_OPS_API_PORT = "${esc(PORT)}"\n` +
    (token ? `CELESTE_OPS_TOKEN = "${esc(token)}"\n` : '');
  // Match our section (and its trailing .env sub-table) up to the next
  // top-level/other table header or EOF. The leading (^|\n) anchors the header
  // to a line start so a `[mcp_servers.celeste-ops]` inside a comment or string
  // value can't trigger a destructive mid-file replace (SECURITY-SPEC Phase 5).
  const re = new RegExp(
    `(^|\\n)\\[mcp_servers\\.${SERVER_NAME}\\][\\s\\S]*?(?=\\n\\[(?!mcp_servers\\.${SERVER_NAME}[.\\]])|$)`,
  );
  let next: string;
  if (re.test(original)) {
    next = original.replace(re, (_m, lead) => lead + block.trimEnd());
  } else {
    next = original.replace(/\s*$/, '') + '\n\n' + block;
  }
  // Normalize to exactly one trailing newline so repeated runs converge
  // (the replace and append paths otherwise leave different trailing bytes).
  next = next.replace(/\s*$/, '') + '\n';
  return backupAndWrite(file, next);
}

const CLAUDE_DESKTOP = join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
const CURSOR = join(HOME, '.cursor', 'mcp.json');
const CODEX = join(HOME, '.codex', 'config.toml');
const CELESTE = join(HOME, '.celeste', 'mcp.json');

// Each target enrolls its own token (when --pair is given) before writing, so
// every client authenticates independently and can be revoked on its own.
const targets: Array<{ name: string; file: string; run: () => Promise<Result>; note?: string }> = [
  {
    name: 'Claude Code',
    file: join(REPO_ROOT, '.mcp.json'),
    run: async () => upsertJson(join(REPO_ROOT, '.mcp.json'), true, await enroll('Claude Code')),
  },
  {
    name: 'Claude Desktop',
    file: CLAUDE_DESKTOP,
    run: async () => (existsSync(CLAUDE_DESKTOP) ? upsertJson(CLAUDE_DESKTOP, false, await enroll('Claude Desktop')) : 'skipped'),
    note: 'or install celeste-ops.mcpb directly (preferred for Desktop)',
  },
  {
    name: 'Cursor',
    file: CURSOR,
    run: async () => (existsSync(join(HOME, '.cursor')) ? upsertJson(CURSOR, true, await enroll('Cursor')) : 'skipped'),
  },
  {
    name: 'Codex',
    file: CODEX,
    run: async () => (existsSync(CODEX) ? upsertToml(CODEX, await enroll('Codex')) : 'skipped'),
  },
  {
    name: 'Celeste CLI',
    file: CELESTE,
    run: async () => (existsSync(join(HOME, '.celeste')) ? upsertJson(CELESTE, true, await enroll('Celeste CLI')) : 'skipped'),
  },
];

console.log(`CelesteOps MCP install${DRY ? ' (dry-run)' : ''}`);
console.log(`  shim : ${SHIM}`);
console.log(`  node : ${NODE_BIN}`);
console.log(`  port : ${PORT}\n`);

const icon: Record<Result, string> = {
  wrote: '✓ wrote     ',
  'would-write': '~ would write',
  unchanged: '· unchanged  ',
  skipped: '– skipped    ',
};
console.log(`  pair : ${PAIR ? 'yes (enrolling tokens)' : 'no — clients will NOT authenticate'}\n`);
let touched = 0;
for (const t of targets) {
  const r = await t.run();
  if (r === 'wrote' || r === 'would-write') touched++;
  const reason = r === 'skipped' ? ' (client not installed)' : t.note ? ` — ${t.note}` : '';
  console.log(`  ${icon[r]} ${t.name.padEnd(15)} ${t.file}${reason}`);
}

console.log('');
if (DRY) {
  console.log('Dry run — nothing written. Re-run without --dry-run to apply.');
} else if (touched) {
  console.log('Done. Restart each updated client to pick up the new MCP server.');
  console.log('The CelesteOps app must be running (the shim talks to its HTTP API).');
  if (!PAIR) {
    console.log('\n⚠  No --pair: clients have no token and the app will reject them (401).');
    console.log('   In the app: Settings → Connections → Add Client → copy the code, then re-run:');
    console.log('   bun run install:mcp --pair <code>');
  }
} else {
  console.log('Everything already up to date.');
}
