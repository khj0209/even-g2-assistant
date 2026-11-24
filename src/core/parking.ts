import type { LatLon } from '../drive/core/types';
import { bearing, distance } from '../drive/core/geo';

export interface Parking extends LatLon {
  /** When the car was parked (ms). */
  at: number;
}

/** "차 어디 있어?", "주차 어디에 했지", "내 차 위치" — answered here, without asking Claude. */
export function isParkingQuestion(q: string): boolean {
  const s = q.replace(/\s+/g, '');
  return /(차|주차).*(어디|위치)|어디.*(주차|차세웠|차댔)/.test(s);
}

const DIRECTIONS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function ago(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}분 전` : m < 24 * 60 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
}

/** "차는 북동쪽 350m에 있어요 (2시간 전 주차)". */
export function parkingAnswer(car: Parking | null, here: LatLon | null, now: number): string {
  if (!car) return '저장된 주차 위치가 없어요. 운전 모드가 끝날 때 자동으로 저장돼요.';
  if (!here) return `주차 위치는 저장돼 있지만 지금 위치를 알 수 없어요 (${ago(now - car.at)} 주차).`;
  const d = distance(here, car);
  if (d < 25) return `차는 바로 근처에 있어요 (${ago(now - car.at)} 주차).`;
  const dir = DIRECTIONS[Math.round((((bearing(here, car) % 360) + 360) % 360) / 45) % 8];
  const dist = d < 1000 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`;
  return `차는 ${dir}쪽 ${dist}에 있어요 (${ago(now - car.at)} 주차).`;
}
