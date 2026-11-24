import { parseContext, type ContextMode } from '../core/modes';

/** Where the G2 Context Android app serves the current situation (loopback only). */
export const CONTEXT_URL = 'http://127.0.0.1:8765/mode';

/** The mode the companion app detected, or null when it isn't running/reachable. */
export async function fetchContext(): Promise<{ mode: ContextMode; source: string } | null> {
  try {
    const res = await fetch(CONTEXT_URL, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    return res.ok ? parseContext(await res.json()) : null;
  } catch {
    return null;
  }
}
