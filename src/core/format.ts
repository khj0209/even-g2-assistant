import type { DeviceState, TempRange } from './types';

export function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 950 → "950", 12_345 → "12K", 1_250_000 → "1.3M". */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 100_000) return `${Math.round(v / 100) / 10}K`.replace('.0K', 'K');
  if (v < 1_000_000) return `${Math.round(v / 1000)}K`;
  return `${Math.round(v / 100_000) / 10}M`.replace('.0M', 'M');
}

export function formatBattery(d: DeviceState): string {
  if (!d.connected || d.battery == null) return '안경 --';
  return `안경 ${Math.round(d.battery)}%${d.charging ? '+' : ''}`;
}

export function formatTemp(t: TempRange | null): string {
  if (!t) return '--°/--°';
  return `${Math.round(t.min)}°/${Math.round(t.max)}°`;
}

/** The AI token readout: remaining share of the monthly budget, or tokens used when no budget is set. */
export function formatAiTokens(used: number, budget: number): string {
  if (budget > 0) {
    const left = Math.max(0, budget - used);
    return `AI ${Math.floor((left / budget) * 100)}%`;
  }
  return `AI ${formatTokens(used)}`;
}

export interface StatusParts {
  device: DeviceState;
  temp: TempRange | null;
  now: Date;
  used: number;
  budget: number;
}

/** The single top line on the glasses: battery · today's low/high · time · AI tokens left. */
export function statusLine(p: StatusParts): string {
  return [formatBattery(p.device), formatTemp(p.temp), formatClock(p.now), formatAiTokens(p.used, p.budget)].join('   ');
}
