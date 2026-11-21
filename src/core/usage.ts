/** Token usage counted on this phone, per calendar month. */
export interface UsageState {
  /** "YYYY-MM" the counts belong to. */
  month: string;
  input: number;
  output: number;
  requests: number;
}

export interface UsageDelta {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function emptyUsage(now: Date): UsageState {
  return { month: monthKey(now), input: 0, output: 0, requests: 0 };
}

/** Starts a fresh count when the month has changed. */
export function rollUsage(u: UsageState, now: Date): UsageState {
  return u.month === monthKey(now) ? u : emptyUsage(now);
}

export function addUsage(u: UsageState, d: UsageDelta, now: Date): UsageState {
  const cur = rollUsage(u, now);
  const input = (d.input_tokens ?? 0) + (d.cache_creation_input_tokens ?? 0) + (d.cache_read_input_tokens ?? 0);
  return { ...cur, input: cur.input + input, output: cur.output + (d.output_tokens ?? 0), requests: cur.requests + 1 };
}

export function totalTokens(u: UsageState): number {
  return u.input + u.output;
}

export function parseUsage(raw: string | null, now: Date): UsageState {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.month === 'string' && Number.isFinite(v.input) && Number.isFinite(v.output)) {
      return rollUsage({ month: v.month, input: v.input, output: v.output, requests: v.requests ?? 0 }, now);
    }
  } catch {
    /* fall through */
  }
  return emptyUsage(now);
}
