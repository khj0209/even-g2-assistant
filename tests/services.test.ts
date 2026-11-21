import { describe, expect, it } from 'vitest';
import { looksLikeAnthropicKey, looksLikeOpenAIKey, maskKey, SecretStore } from '../src/platform/secrets';
import { memoryKV } from '../src/platform/storage';
import { appendTurn, MAX_TURNS, newSession, SessionStore, titleFrom } from '../src/services/sessions';
import { chooseStt } from '../src/services/stt';
import { forecastUrl, parseForecast } from '../src/services/weather';

describe('secrets', () => {
  it('masks keys and never shows the middle', () => {
    const key = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-wxyz';
    expect(maskKey(key)).toBe('sk-ant-…wxyz');
    expect(maskKey('short')).toBe('•••••');
  });

  it('recognizes key shapes', () => {
    expect(looksLikeAnthropicKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(looksLikeAnthropicKey('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(looksLikeAnthropicKey('sk-ant-has spaces in it abcdefghijkl')).toBe(false);
    expect(looksLikeOpenAIKey('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });

  it('keeps secrets in memory only when encrypted storage is unavailable', async () => {
    const kv = memoryKV();
    const store = new SecretStore(kv); // no IndexedDB in Node
    expect(store.persistent).toBe(false);
    await store.set('anthropic', '  sk-ant-test-value  ');
    expect(await store.get('anthropic')).toBe('sk-ant-test-value');
    expect(await kv.get('secret:anthropic')).toBeNull();
    await store.remove('anthropic');
    expect(await store.get('anthropic')).toBeNull();
  });
});

describe('sessions', () => {
  it('titles a session after its first question', () => {
    let s = newSession(0);
    s = appendTurn(s, { role: 'user', text: '오늘 저녁 메뉴 추천해 줘' });
    s = appendTurn(s, { role: 'assistant', text: '김치찌개 어때요?' });
    s = appendTurn(s, { role: 'user', text: '다른 거' });
    expect(s.title).toBe('오늘 저녁 메뉴 추천해 줘');
    expect(titleFrom('a'.repeat(40))).toHaveLength(25);
  });

  it('trims old turns and always starts with a user turn', () => {
    let s = newSession(0);
    for (let i = 0; i < MAX_TURNS + 5; i++) s = appendTurn(s, { role: i % 2 ? 'assistant' : 'user', text: String(i) });
    expect(s.turns.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(s.turns[0].role).toBe('user');
  });

  it('persists sessions and the active selection', async () => {
    const kv = memoryKV();
    const a = new SessionStore(kv);
    await a.load();
    expect(a.sessions).toHaveLength(1);
    const s = await a.create();
    await a.update(appendTurn(s, { role: 'user', text: '안녕' }));
    await a.select({ kind: 'agent', id: 'sesn_1', title: '에이전트' });
    const b = new SessionStore(kv);
    await b.load();
    expect(b.sessions).toHaveLength(2);
    expect(b.active).toEqual({ kind: 'agent', id: 'sesn_1', title: '에이전트' });
    expect(b.current()).toBeNull();
    await b.select({ kind: 'local', id: s.id });
    await b.remove(s.id);
    expect(b.active.kind).toBe('local');
    expect(b.current()).not.toBeNull();
  });
});

describe('speech recognition choice', () => {
  const base = { hasGlassesMic: true, hasOpenAIKey: true, phoneSpeech: true };
  it('prefers the glasses microphone when an OpenAI key is set', () => {
    expect(chooseStt('auto', base)).toEqual({ kind: 'glasses' });
    expect(chooseStt('auto', { ...base, hasOpenAIKey: false })).toEqual({ kind: 'phone' });
    expect(chooseStt('auto', { hasGlassesMic: false, hasOpenAIKey: false, phoneSpeech: false }).kind).toBe('none');
  });
  it('honours an explicit choice', () => {
    expect(chooseStt('phone', base)).toEqual({ kind: 'phone' });
    expect(chooseStt('openai', { ...base, hasOpenAIKey: false }).kind).toBe('none');
    expect(chooseStt('phone', { ...base, phoneSpeech: false }).kind).toBe('none');
  });
});

describe('weather', () => {
  it('rounds the location in the request', () => {
    const url = forecastUrl({ lat: 37.123456, lon: 127.987654 });
    expect(url).toContain('latitude=37.12&longitude=127.99');
    expect(url).not.toContain('37.1234');
  });
  it('parses today\'s range', () => {
    expect(parseForecast({ daily: { temperature_2m_min: [1.5], temperature_2m_max: [9] } })).toEqual({ min: 1.5, max: 9 });
    expect(parseForecast({})).toBeNull();
  });
});
