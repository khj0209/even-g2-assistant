import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLyrics, lineAt, parseLrc, searchTerms } from '../src/services/lyrics';

afterEach(() => vi.unstubAllGlobals());

describe('lyrics', () => {
  it('parses LRC, including several stamps on one line', () => {
    const lines = parseLrc('[ar:비비]\n[00:12.50] 첫 줄\n[00:20.00][01:05.00] 후렴\n[00:15.3]둘째 줄\nno stamp');
    expect(lines).toEqual([
      { t: 12_500, text: '첫 줄' },
      { t: 15_300, text: '둘째 줄' },
      { t: 20_000, text: '후렴' },
      { t: 65_000, text: '후렴' },
    ]);
  });

  it('finds the line at a position', () => {
    const lines = parseLrc('[00:10.00]a\n[00:20.00]b\n[00:30.00]');
    expect(lineAt(lines, 5_000)).toBe('');
    expect(lineAt(lines, 10_000)).toBe('a');
    expect(lineAt(lines, 25_000)).toBe('b');
    expect(lineAt(lines, 31_000)).toBe(''); // empty stamp = instrumental gap
  });

  it('cleans streaming titles for the search', () => {
    expect(searchTerms({ title: '밤양갱 (Official MV)', artist: '비비 - Topic' })).toEqual({ track: '밤양갱', artist: '비비' });
    expect(searchTerms({ title: '[MV] 노래' })).toEqual({ track: '노래', artist: '' });
  });

  it('picks the synced version whose length matches', async () => {
    let url = '';
    vi.stubGlobal('fetch', async (u: string) => {
      url = u;
      return new Response(JSON.stringify([
        { duration: 300, syncedLyrics: '[00:01.00]long version' },
        { duration: 180, plainLyrics: 'no timing' },
        { duration: 226, syncedLyrics: '[00:01.00]radio edit' },
      ]));
    });
    const lines = await fetchLyrics({ title: '밤양갱', artist: '비비', dur: 225_000 });
    expect(lines).toEqual([{ t: 1000, text: 'radio edit' }]);
    expect(url).toContain('track_name=%EB%B0%A4%EC%96%91%EA%B0%B1');
    expect(url).toContain('artist_name=');
  });

  it('returns null when nothing is synced', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([{ plainLyrics: 'x' }])));
    expect(await fetchLyrics({ title: 'video' })).toBeNull();
  });
});
