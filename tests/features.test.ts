import { describe, expect, it } from 'vitest';
import { dashboard, emptyTrack, healthLine, heartLine, paceVersusTarget, splitNotice, type DashState } from '../src/core/dashboard';
import { parseContext } from '../src/core/modes';
import { isParkingQuestion, parkingAnswer } from '../src/core/parking';
import { finishedSessions } from '../src/services/sessions';

const base: DashState = { mode: 'assistant', since: 0, track: emptyTrack(), sets: 0, restUntil: 0 };

describe('next event', () => {
  it('is parsed only when complete', () => {
    expect(parseContext({ mode: 'assistant', next: { title: '주간회의', start: 1000 } })?.next).toEqual({ title: '주간회의', start: 1000 });
    expect(parseContext({ mode: 'assistant', next: { title: '', start: 1000 } })?.next).toBeUndefined();
    expect(parseContext({ mode: 'assistant', next: { title: 'x' } })?.next).toBeUndefined();
  });

  it('shows on the plain screen with the time left', () => {
    const start = new Date(2026, 10, 24, 14, 0).getTime();
    expect(dashboard({ ...base, next: { title: '주간회의', start } }, start - 35 * 60_000)).toEqual({ big: '', caption: '', detail: '다음 일정  14:00 주간회의 · 35분 후' });
    expect(dashboard({ ...base, next: { title: '저녁', start } }, start - 125 * 60_000)!.detail).toContain('2시간 5분 후');
    expect(dashboard({ ...base, next: { title: '지난', start } }, start + 1)).toBeNull();
  });
});

describe('running', () => {
  it('announces each kilometre', () => {
    expect(splitNotice(2, 312_000, 640_000, 2000)).toBe(`2 km · 구간 5'12" · 평균 5'20"`);
  });

  it('compares the pace with the target', () => {
    expect(paceVersusTarget(338, 330)).toBe(`목표 5'30" · 8초 느림`);
    expect(paceVersusTarget(325, 330)).toBe(`목표 5'30" · 5초 빠름`);
    expect(paceVersusTarget(null, 330)).toBe(`목표 5'30"`);
    const d = dashboard({ ...base, mode: 'running', targetPace: 330, track: { distance: 0, last: null, speed: 1000 / 340 } }, 60_000)!;
    expect(d.caption).toBe(`목표 5'30" · 10초 느림`);
  });
});

describe('parking', () => {
  it('recognises the question', () => {
    for (const q of ['차 어디 있어?', '내 차 위치 알려줘', '주차 어디에 했지', '어디에 차 세웠지']) expect(isParkingQuestion(q)).toBe(true);
    for (const q of ['오늘 날씨 어때', '차 한 잔 할까']) expect(isParkingQuestion(q)).toBe(false);
  });

  it('gives direction, distance and age', () => {
    const car = { lat: 37.5010, lon: 127.0, at: 0 };
    expect(parkingAnswer(car, { lat: 37.5, lon: 127.0 }, 2 * 3_600_000)).toBe('차는 북쪽 110m에 있어요 (2시간 전 주차).');
    expect(parkingAnswer(car, { lat: 37.50099, lon: 127.0 }, 60_000)).toBe('차는 바로 근처에 있어요 (1분 전 주차).');
    expect(parkingAnswer(null, null, 0)).toContain('저장된 주차 위치가 없어요');
  });
});

describe('agent sessions', () => {
  it('reports sessions that went from running to idle, not on the first look', () => {
    const now = [{ id: 'a', status: 'idle' }, { id: 'b', status: 'running' }, { id: 'c', status: 'idle' }];
    expect(finishedSessions(null, now)).toEqual([]);
    expect(finishedSessions(new Map([['a', 'running'], ['b', 'running'], ['c', 'idle']]), now)).toEqual(['a']);
  });
});

describe('Samsung Health', () => {
  it('parses only numbers', () => {
    expect(parseContext({ mode: 'assistant', health: { steps: 6240, sleepMin: 432, hr: 'x', hrAt: -1 } })?.health).toEqual({ steps: 6240, sleepMin: 432, hr: undefined, hrAt: undefined });
  });

  it('formats steps and sleep, and only recent heart rate', () => {
    expect(healthLine({ steps: 6240, sleepMin: 432 })).toBe('걸음 6,240 · 수면 7시간 12분');
    expect(healthLine(undefined)).toBe('');
    expect(heartLine({ hr: 142, hrAt: 0 }, 3 * 60_000)).toBe('심박 142 (3분 전)');
    expect(heartLine({ hr: 142, hrAt: 0 }, 20_000)).toBe('심박 142');
    expect(heartLine({ hr: 142, hrAt: 0 }, 31 * 60_000)).toBe('');
  });

  it('shows on the plain screen even without a next event, and with heart rate while running', () => {
    expect(dashboard({ ...base, health: { steps: 100 } }, 0)).toEqual({ big: '', caption: '', detail: '걸음 100' });
    const d = dashboard({ ...base, mode: 'running', health: { hr: 150, hrAt: 0 } }, 60_000)!;
    expect(d.detail.split('\n')[1]).toBe('심박 150 (1분 전)');
  });
});
