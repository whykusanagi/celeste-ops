// Token resolution for the CelesteOps MCP shim. All I/O is node builtins or an
// injected fetchFn, so this module is unit-testable with no app and no SDK.
// Priority: CELESTE_OPS_TOKEN (Track A) → cached token → exchange a one-time
// CELESTE_OPS_PAIRING_CODE via /api/auth/enroll and cache it (Track B).
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join, dirname } from 'node:path';

// App data dir, keyed by port, 0600. Lives OUTSIDE the extension dir so a
// Desktop extension update can't wipe it and force re-pairing. (Measured
// writable from Desktop's .mcpb runtime — see the spec's spike results.)
export function cachePathFor(port, home = osHomedir()) {
  return join(home, 'Library', 'Application Support', 'CelesteOps', 'clients', `claude-desktop.${port}.json`);
}

export function loadCachedToken(port, home = osHomedir()) {
  try {
    const f = cachePathFor(port, home);
    if (!existsSync(f)) return null;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return typeof j.token === 'string' && j.token ? j.token : null;
  } catch {
    return null;
  }
}

// Persist the token 0600. Tries the app data dir, then the extension dir as a
// fallback. Returns the path written, or null if every candidate is unwritable
// (caller degrades to "re-enter the code next launch").
export function saveCachedToken(port, token, home = osHomedir(), extDir = null) {
  const candidates = [cachePathFor(port, home)];
  if (extDir) candidates.push(join(extDir, `claude-desktop.${port}.json`));
  for (const f of candidates) {
    try {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, JSON.stringify({ token, port }), { mode: 0o600 });
      try { chmodSync(f, 0o600); } catch { /* best effort */ }
      return f;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

// Exchange a single-use pairing code for a token via the app's enroll endpoint.
export async function enrollWithCode({ baseUrl, code, fetchFn = fetch, label = 'Claude Desktop' }) {
  const res = await fetchFn(`${baseUrl}/api/auth/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, kind: 'mcp-client', pairing_code: code }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = ((await res.json()) || {}).error || ''; } catch { /* ignore */ }
    const err = new Error(`enroll failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const token = ((await res.json()) || {}).token;
  if (!token) throw new Error('enroll succeeded but returned no token');
  return token;
}

// Resolve the bearer token the shim should send. Returns { token, source }.
// source: 'env-token' | 'cache' | 'enrolled' | 'none'. Throws (with .status on
// enroll failures) so the caller can print an actionable re-pair message.
export async function resolveAuth({ env, baseUrl, port, fetchFn = fetch, home = osHomedir(), extDir = null, log = () => {} }) {
  if (env.CELESTE_OPS_TOKEN) return { token: env.CELESTE_OPS_TOKEN, source: 'env-token' };

  const cached = loadCachedToken(port, home);
  if (cached) return { token: cached, source: 'cache' };

  const code = env.CELESTE_OPS_PAIRING_CODE?.trim();
  if (code) {
    const token = await enrollWithCode({ baseUrl, code, fetchFn });
    const saved = saveCachedToken(port, token, home, extDir);
    if (!saved) log('[celeste-ops-mcp] WARNING: could not persist token cache; you may need to re-enter a pairing code next launch.');
    return { token, source: 'enrolled' };
  }

  return { token: '', source: 'none' };
}
