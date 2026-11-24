import { parseContext, type Context } from '../core/modes';

/** Where the G2 Context Android app serves the current situation (loopback only). Both spellings are tried. */
export const CONTEXT_URLS = ['http://127.0.0.1:8765/mode', 'http://localhost:8765/mode'];

export type ContextResult = Context | { error: string };

async function fetchOne(url: string): Promise<ContextResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return parseContext(await res.json()) ?? { error: '응답 형식 오류' };
  } catch (e) {
    const name = (e as Error)?.name;
    // Timeout = nothing answered; TypeError = refused or blocked before reaching the app.
    return { error: name === 'TimeoutError' ? '응답 없음(2초 초과)' : `차단/연결 거부 (${(e as Error)?.message ?? e})` };
  }
}

/**
 * The mode the companion app detected, or why it couldn't be read (per URL tried).
 * `key`: the pairing code shown in G2 Context; without it the app leaves out what's playing.
 */
export async function fetchContext(key = ''): Promise<ContextResult> {
  const errors: string[] = [];
  for (const url of CONTEXT_URLS) {
    const r = await fetchOne(key ? `${url}?key=${encodeURIComponent(key)}` : url);
    if (!('error' in r)) return r;
    errors.push(`${new URL(url).hostname}: ${r.error}`);
  }
  return { error: errors.join(' / ') };
}
