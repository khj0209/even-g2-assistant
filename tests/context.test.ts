import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchContext, transcribe } from '../src/services/context';

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

describe('transcribe', () => {
  it('sends the PCM with the pairing code to the address that answered, and returns the text', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('127.0.0.1')) throw new TypeError('Failed to fetch');
      if (url.includes('/mode')) return new Response(JSON.stringify({ mode: 'assistant' }));
      return new Response(JSON.stringify({ text: ' 오늘 날씨 어때 ' }));
    });
    await fetchContext('ABCD2345'); // localhost answers, so speech goes there too
    expect(await transcribe(new Uint8Array([1, 2]), 'ABCD2345')).toBe('오늘 날씨 어때');
    const stt = calls.at(-1)!;
    expect(stt.url).toBe('http://localhost:8765/stt?key=ABCD2345');
    expect(stt.init?.method).toBe('POST');
  });

  it("passes on G2 Context's error message", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: '한국어 음성 인식 모델을 내려받는 중이에요' }), { status: 503 }));
    await expect(transcribe(new Uint8Array(2), 'K')).rejects.toThrow('한국어 음성 인식 모델을 내려받는 중이에요');
  });
});
