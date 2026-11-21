import type { TempRange } from '../core/types';

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Seoul City Hall, used until a location is known. */
export const DEFAULT_LOCATION: GeoPoint = { lat: 37.566, lon: 126.978 };

export function forecastUrl(p: GeoPoint): string {
  // Two decimals (~1 km) is plenty for a daily forecast and keeps the exact position private.
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}` +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
  );
}

export function parseForecast(json: unknown): TempRange | null {
  const d = (json as { daily?: { temperature_2m_min?: number[]; temperature_2m_max?: number[] } })?.daily;
  const min = d?.temperature_2m_min?.[0];
  const max = d?.temperature_2m_max?.[0];
  return Number.isFinite(min) && Number.isFinite(max) ? { min: min!, max: max! } : null;
}

export async function fetchTodayRange(p: GeoPoint, signal?: AbortSignal): Promise<TempRange | null> {
  const res = await fetch(forecastUrl(p), { signal });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  return parseForecast(await res.json());
}
