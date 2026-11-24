import type { Media } from '../core/modes';

/** One time-stamped lyric line. */
export interface LyricLine {
  /** Start, ms from the beginning of the track. */
  t: number;
  text: string;
}

/** Parses LRC ("[01:23.45] line", several stamps per line allowed) into lines sorted by time. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The line being sung at `posMs` ('' before the first line or in an instrumental gap). */
export function lineAt(lines: LyricLine[], posMs: number): string {
  let text = '';
  for (const l of lines) {
    if (l.t > posMs) break;
    text = l.text;
  }
  return text;
}

/** Title/artist as streaming apps send them, cleaned for a lyrics search ("(Official MV)", "Artist - Topic"). */
export function searchTerms(m: Media): { track: string; artist: string } {
  const track = m.title.replace(/\s*[([【].*?[)\]】]\s*/g, ' ').replace(/\s+/g, ' ').trim() || m.title;
  const artist = (m.artist ?? '').replace(/\s*-\s*Topic$/i, '').trim();
  return { track, artist };
}

interface LrclibHit {
  syncedLyrics?: string | null;
  duration?: number;
}

/**
 * Time-synced lyrics from LRCLIB (lrclib.net, free, no key), or null when there are none (videos,
 * unknown songs, instrumental). Only the title, artist and length are sent.
 */
export async function fetchLyrics(m: Media): Promise<LyricLine[] | null> {
  const { track, artist } = searchTerms(m);
  const q = new URLSearchParams({ track_name: track, ...(artist ? { artist_name: artist } : {}) });
  const res = await fetch(`https://lrclib.net/api/search?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const hits = ((await res.json()) as LrclibHit[]).filter((h) => h.syncedLyrics);
  if (!hits.length) return null;
  // Several versions of a song share a name: prefer the one whose length matches what's playing.
  const dur = m.dur ? m.dur / 1000 : null;
  const best = dur ? hits.reduce((a, b) => (Math.abs((b.duration ?? 0) - dur) < Math.abs((a.duration ?? 0) - dur) ? b : a)) : hits[0];
  const lines = parseLrc(best.syncedLyrics!);
  return lines.length ? lines : null;
}
