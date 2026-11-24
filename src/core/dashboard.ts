import { formatClock } from './format';
import type { ContextMode } from './modes';

/** Distance travelled since the mode started, from GPS fixes. */
export interface Track {
  /** Metres. */
  distance: number;
  last: { lat: number; lon: number } | null;
  /** m/s from the last fix that had one. */
  speed: number | null;
}

export interface Fix {
  lat: number;
  lon: number;
  accuracy?: number;
  speed?: number;
}

export const emptyTrack = (): Track => ({ distance: 0, last: null, speed: null });

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function addFix(t: Track, f: Fix): Track {
  // Poor fixes and tiny moves are GPS jitter; counting them adds phantom distance while standing still.
  if (f.accuracy != null && f.accuracy > 30) return t;
  const speed = f.speed != null && f.speed >= 0 ? f.speed : t.speed;
  if (!t.last) return { distance: t.distance, last: { lat: f.lat, lon: f.lon }, speed };
  const d = haversine(t.last, f);
  // Keep the old anchor for small moves so slow walking still adds up.
  if (d < 5) return { ...t, speed };
  return { distance: t.distance + d, last: { lat: f.lat, lon: f.lon }, speed };
}

/** 75_000 → "1:15", 3_725_000 → "1:02:05". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Seconds per km → 5'12". */
export function formatPace(secPerKm: number | null): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm > 3600) return `--'--"`;
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
}

export const REST_MS = 90_000;
const FOCUS_MS = 25 * 60_000;
const BREAK_MS = 5 * 60_000;

export interface DashState {
  mode: ContextMode;
  /** When the current mode started (ms). */
  since: number;
  track: Track;
  /** Workout: sets done, and when the current rest ends. */
  sets: number;
  restUntil: number;
  /** Meeting: when the calendar event ends (ms), if the companion sent it. */
  meetingEnd?: number;
}

/** A mode's glasses panel: one big number (drawn as an image) with its caption, and detail lines. */
export interface Dash {
  big: string;
  caption: string;
  detail: string;
}

const WEEKDAYS = '일월화수목금토';

/** The glasses' main panel for a mode. */
export function dashboard(s: DashState, now: number): Dash {
  const elapsed = now - s.since;
  const km = s.track.distance / 1000;
  const speed = s.track.speed;
  switch (s.mode) {
    case 'running': {
      const avg = km >= 0.05 ? elapsed / 1000 / km : null;
      const cur = speed != null && speed > 0.5 ? 1000 / speed : null;
      return {
        big: formatPace(cur),
        caption: '현재 페이스 /km',
        detail: `시간 ${formatDuration(elapsed)}   거리 ${km.toFixed(2)}km   평균 ${formatPace(avg)}`,
      };
    }
    case 'driving':
      return {
        big: speed != null ? String(Math.round(speed * 3.6)) : '--',
        caption: 'km/h',
        detail: `주행 ${formatDuration(elapsed)} · ${km.toFixed(1)}km   지금 ${formatClock(new Date(now))}`,
      };
    case 'workout': {
      const rest = s.restUntil - now;
      return rest > 0
        ? { big: formatDuration(rest), caption: `휴식 · ${s.sets}세트 완료`, detail: `운동 ${formatDuration(elapsed)}` }
        : { big: `${s.sets}세트`, caption: '탭하면 세트 완료 + 휴식 90초', detail: `운동 ${formatDuration(elapsed)}` };
    }
    case 'dev': {
      const cycle = FOCUS_MS + BREAK_MS;
      const pos = elapsed % cycle;
      const round = Math.floor(elapsed / cycle) + 1;
      const focus = pos < FOCUS_MS;
      return {
        big: formatDuration(focus ? FOCUS_MS - pos : cycle - pos),
        caption: focus ? `집중 ${round}회차` : '쉬는 시간',
        detail: `개발 ${formatDuration(elapsed)}`,
      };
    }
    case 'meeting': {
      const left = s.meetingEnd && s.meetingEnd > now ? s.meetingEnd - now : null;
      return left != null
        ? { big: `${Math.ceil(left / 60_000)}분`, caption: `${formatClock(new Date(s.meetingEnd!))}까지`, detail: `회의 경과 ${formatDuration(elapsed)}` }
        : { big: formatDuration(elapsed), caption: '회의 경과', detail: '' };
    }
    case 'assistant': {
      const d = new Date(now);
      return { big: formatClock(d), caption: `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`, detail: '' };
    }
  }
}
