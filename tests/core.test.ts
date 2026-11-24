import { describe, expect, it } from 'vitest';
import { formatAiTokens, formatClock, formatTokens, mediaLine, statusLine } from '../src/core/format';
import { parseContext } from '../src/core/modes';
import { PcmBuffer, pcmLevel, pcmToWav } from '../src/core/pcm';
import { replyPages } from '../src/core/reply';
import { ellipsize, paginate, textWidth, wrapText } from '../src/core/textlayout';
import { addUsage, emptyUsage, parseUsage, totalTokens } from '../src/core/usage';

describe('text layout', () => {
  it('wraps words within the width', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(120);
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe('the quick brown fox jumps over the lazy dog');
  });

  it('splits Korean text without spaces', () => {
    const lines = wrapText('가'.repeat(40), 240);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('가'.repeat(10));
  });

  it('keeps blank lines between paragraphs and drops trailing ones', () => {
    expect(wrapText('a\n\nb\n\n', 200)).toEqual(['a', '', 'b']);
  });

  it('paginates into fixed-size pages', () => {
    const pages = paginate(Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n'), 300, 4);
    expect(pages).toHaveLength(3);
    expect(pages[2].split('\n')).toEqual(['줄8', '줄9']);
    expect(paginate('', 300, 4)).toEqual(['']);
  });

  it('ellipsizes long text', () => {
    const s = ellipsize('오늘 서울 날씨가 어떤지 자세히 알려줄래', 150);
    expect(s.endsWith('…')).toBe(true);
    expect(textWidth(s)).toBeLessThanOrEqual(150);
    expect(ellipsize('짧음', 150)).toBe('짧음');
  });
});

describe('reply pages', () => {
  it('echoes the question above a short answer on one page', () => {
    const pages = replyPages('날씨 어때?', '맑아요.', 396, 7);
    expect(pages).toEqual(['> 날씨 어때?\n\n맑아요.']);
  });

  it('adds a page footer when the answer is long', () => {
    const answer = Array.from({ length: 15 }, (_, i) => `문장 ${i}.`).join('\n');
    const pages = replyPages('질문', answer, 396, 7);
    expect(pages.length).toBe(3);
    for (const [i, p] of pages.entries()) {
      const lines = p.split('\n');
      expect(lines).toHaveLength(7);
      expect(lines[6].trim()).toBe(`${i + 1}/3`);
    }
  });

  it('never returns zero pages', () => {
    expect(replyPages('', '', 396, 7)).toEqual(['']);
  });
});

describe('format', () => {
  it('formats the clock and token counts', () => {
    expect(formatClock(new Date(2026, 10, 21, 9, 5))).toBe('09:05');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_345)).toBe('12.3K');
    expect(formatTokens(20_000)).toBe('20K');
    expect(formatTokens(250_400)).toBe('250K');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });

  it('shows the remaining budget share, or tokens used without a budget', () => {
    expect(formatAiTokens(250_000, 1_000_000)).toBe('AI 75%');
    expect(formatAiTokens(2_000_000, 1_000_000)).toBe('AI 0%');
    expect(formatAiTokens(12_000, 0)).toBe('AI 12K');
  });

  it('builds the status line', () => {
    const line = statusLine({
      mode: '운전',
      device: { connected: true, battery: 82, charging: false },
      temp: { min: 2.6, max: 11.2 },
      now: new Date(2026, 10, 21, 14, 7),
      used: 100_000,
      budget: 1_000_000,
    });
    expect(line).toBe('[운전]  안경 82%  3°/11°  14:07  AI 90%');
    expect(textWidth(line)).toBeLessThanOrEqual(560);
    const unknown = statusLine({ mode: '일상', device: { connected: false, battery: null, charging: false }, temp: null, now: new Date(2026, 0, 1, 0, 0), used: 0, budget: 0 });
    expect(unknown).toBe('[일상]  안경 --  --°/--°  00:00  AI 0');
  });
});

describe('modes', () => {
  it('accepts only known modes from the companion app', () => {
    expect(parseContext({ mode: 'driving', source: 'activity' })).toEqual({ mode: 'driving', source: 'activity' });
    expect(parseContext({ mode: 'flying' })).toBeNull();
    expect(parseContext(null)).toBeNull();
    expect(parseContext({ mode: 'toString' })).toBeNull();
  });

  it('keeps valid media and drops malformed fields', () => {
    const c = parseContext({ mode: 'assistant', media: { title: '밤양갱', artist: '비비', app: 'YouTube Music', pos: 83_000, dur: -1 } });
    expect(c?.media).toEqual({ title: '밤양갱', artist: '비비', app: 'YouTube Music', pos: 83_000, dur: undefined });
    expect(parseContext({ mode: 'assistant', media: { title: '' } })?.media).toBeUndefined();
    expect(parseContext({ mode: 'assistant', media: 'x' })?.media).toBeUndefined();
  });

  it('formats the now-playing line and cuts long titles', () => {
    expect(mediaLine({ title: '밤양갱', artist: '비비', app: 'YouTube Music', pos: 83_000, dur: 225_000 }, 560)).toBe('YouTube Music · 밤양갱 - 비비  1:23/3:45');
    const long = mediaLine({ title: '아주 '.repeat(40), pos: 0, dur: 60_000 }, 560);
    expect(long.endsWith('…  0:00/1:00')).toBe(true);
    expect(textWidth(long)).toBeLessThanOrEqual(560);
    expect(mediaLine(undefined, 560)).toBe('');
  });
});

describe('usage', () => {
  it('adds usage including cache tokens and rolls over each month', () => {
    const nov = new Date(2026, 10, 21);
    let u = addUsage(emptyUsage(nov), { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 }, nov);
    expect(totalTokens(u)).toBe(1150);
    expect(u.requests).toBe(1);
    u = addUsage(u, { input_tokens: 10, output_tokens: 5 }, new Date(2026, 11, 1));
    expect(u).toEqual({ month: '2026-12', input: 10, output: 5, requests: 1 });
  });

  it('parses stored usage defensively', () => {
    const now = new Date(2026, 10, 21);
    expect(parseUsage('garbage', now)).toEqual(emptyUsage(now));
    expect(parseUsage(JSON.stringify({ month: '2026-11', input: 5, output: 6, requests: 2 }), now).input).toBe(5);
    expect(parseUsage(JSON.stringify({ month: '2026-10', input: 5, output: 6 }), now)).toEqual(emptyUsage(now));
  });
});

describe('pcm', () => {
  it('wraps PCM in a valid 16 kHz mono WAV header', () => {
    const wav = pcmToWav(new Uint8Array(3200));
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(wav.length).toBe(3244);
  });

  it('buffers frames, caps the length and keeps whole samples', () => {
    const b = new PcmBuffer(1);
    b.push(new Uint8Array(3));
    expect(b.bytes().length).toBe(2);
    for (let i = 0; i < 20; i++) b.push(new Uint8Array(3200));
    expect(b.seconds).toBeLessThanOrEqual(1.1);
  });

  it('measures the level', () => {
    expect(pcmLevel(new Uint8Array(100))).toBe(0);
    const loud = new Uint8Array(200);
    const v = new DataView(loud.buffer);
    for (let i = 0; i < 100; i++) v.setInt16(i * 2, i % 2 ? 16000 : -16000, true);
    expect(pcmLevel(loud)).toBeGreaterThan(0.4);
  });
});
