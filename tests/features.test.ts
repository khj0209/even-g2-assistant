import { describe, expect, it } from 'vitest';
import { dashboard, emptyTrack, paceVersusTarget, splitNotice, type DashState } from '../src/core/dashboard';
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
