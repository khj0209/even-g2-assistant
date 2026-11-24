import { parseContext, type Context } from '../core/modes';

/** Where the G2 Context Android app listens (loopback only). Both spellings are tried. */
export const COMPANION_BASES = ['http://127.0.0.1:8765', 'http://localhost:8765'];

/** The address that answered last, for speech recognition. */
let base = COMPANION_BASES[0];

export type ContextResult = Context | { error: string };

const withKey = (path: string, key: string) => (key ? `${path}?key=${encodeURIComponent(key)}` : path);

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
 * The mode the companion app detected, or why it couldn't be read (per address tried).
 * `key`: the pairing code shown in G2 Context; without it the app leaves out the Claude key and what's playing.
 */
export async function fetchContext(key = ''): Promise<ContextResult> {
  const errors: string[] = [];
  for (const b of COMPANION_BASES) {
    const r = await fetchOne(withKey(`${b}/mode`, key));
    if (!('error' in r)) {
      base = b;
      return r;
    }
    errors.push(`${new URL(b).hostname}: ${r.error}`);
  }
  return { error: errors.join(' / ') };
}

/** Speech to text by the phone's own recognizer, via G2 Context. `pcm`: 16 kHz 16-bit mono from the glasses. */
export async function transcribe(pcm: Uint8Array, key: string): Promise<string> {
  const res = await fetch(withKey(`${base}/stt`, key), {
    method: 'POST',
    body: pcm as BodyInit,
    headers: { 'Content-Type': 'application/octet-stream' },
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(j.error ?? `음성 인식 실패 (HTTP ${res.status})`);
  return (j.text ?? '').trim();
}
