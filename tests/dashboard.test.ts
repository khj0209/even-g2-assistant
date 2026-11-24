import { describe, expect, it } from 'vitest';
import { addFix, dashboard, emptyTrack, formatDuration, formatPace, haversine, REST_MS, type DashState } from '../src/core/dashboard';

const base: DashState = { mode: 'running', since: 0, track: emptyTrack(), sets: 0, restUntil: 0 };

describe('track', () => {
  it('measures distance and ignores jitter and poor fixes', () => {
    // 0.001° of latitude ≈ 111 m.
    expect(haversine({ lat: 37, lon: 127 }, { lat: 37.001, lon: 127 })).toBeCloseTo(111.2, 0);
    let t = addFix(emptyTrack(), { lat: 37, lon: 127, accuracy: 5, speed: 3 });
    t = addFix(t, { lat: 37.00002, lon: 127, accuracy: 5 }); // ~2 m: jitter
    t = addFix(t, { lat: 37.01, lon: 127, accuracy: 80 }); // poor fix
    expect(t.distance).toBe(0);
    t = addFix(t, { lat: 37.001, lon: 127, accuracy: 5, speed: 3.5 });
    expect(t.distance).toBeCloseTo(111.2, 0);
    expect(t.speed).toBe(3.5);
  });
});

describe('formatting', () => {
  it('formats durations and paces', () => {
    expect(formatDuration(75_000)).toBe('1:15');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatPace(312)).toBe(`5'12"`);
    expect(formatPace(null)).toBe(`--'--"`);
  });
});

describe('dashboard', () => {
  it('shows current pace big, with time, distance and average below', () => {
    const d = dashboard({ ...base, track: { distance: 2000, last: null, speed: 1000 / 300 } }, 600_000)!;
    expect(d.big).toBe(`5'00"`);
    expect(d.detail).toContain('시간 10:00');
    expect(d.detail).toContain('거리 2.00km');
    expect(d.detail).toContain(`평균 5'00"`);
  });

  it('shows only the driving time once the wearer left the Drive HUD', () => {
    expect(dashboard({ ...base, mode: 'driving' }, 90_000)).toMatchObject({ big: '1:30', caption: '운전 중 · HUD 꺼짐' });
  });

  it('counts workout sets and rest', () => {
    expect(dashboard({ ...base, mode: 'workout', sets: 3, restUntil: REST_MS }, 30_000)).toMatchObject({ big: '1:00', caption: '휴식 · 3세트 완료' });
    expect(dashboard({ ...base, mode: 'workout', sets: 3, restUntil: 0 }, 30_000)!.big).toBe('3세트');
  });

  it('cycles focus and break in dev mode', () => {
    expect(dashboard({ ...base, mode: 'dev' }, 60_000)).toMatchObject({ big: '24:00', caption: '집중 1회차' });
    expect(dashboard({ ...base, mode: 'dev' }, 26 * 60_000)).toMatchObject({ big: '4:00', caption: '쉬는 시간' });
    expect(dashboard({ ...base, mode: 'dev' }, 31 * 60_000)!.caption).toBe('집중 2회차');
  });

  it('shows minutes left in a meeting, and nothing for the plain assistant', () => {
    const end = new Date(2026, 10, 24, 14, 30).getTime();
    expect(dashboard({ ...base, mode: 'meeting', since: end - 30 * 60_000, meetingEnd: end }, end - 12 * 60_000)).toMatchObject({ big: '12분', caption: '14:30까지' });
    expect(dashboard({ ...base, mode: 'meeting', since: 0 }, 90_000)).toMatchObject({ big: '1:30', caption: '회의 경과' });
    expect(dashboard({ ...base, mode: 'assistant' }, 0)).toBeNull();
  });
});
