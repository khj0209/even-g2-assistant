import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchContext } from '../src/services/context';

afterEach(() => vi.unstubAllGlobals());

describe('fetchContext', () => {
  it('falls back to localhost when 127.0.0.1 is blocked', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('127.0.0.1')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ mode: 'driving', source: 'activity' }));
    });
    expect(await fetchContext()).toEqual({ mode: 'driving', source: 'activity' });
  });

  it('reports why each address failed', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('127.0.0.1')) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return new Response('nope', { status: 404 });
    });
    const r = await fetchContext();
    expect(r).toEqual({ error: '127.0.0.1: 응답 없음(2초 초과) / localhost: HTTP 404' });
  });
});
