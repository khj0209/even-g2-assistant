export interface DeviceState {
  connected: boolean;
  /** 0..100, or null when unknown. */
  battery: number | null;
  charging: boolean;
}

export interface TempRange {
  min: number;
  max: number;
}


export interface Settings {
  model: string;
  /** Pairing code shown in G2 Context; lets the glasses get the Claude key and what's playing from it. */
  companionKey: string;
  /** Monthly token budget for the "AI 잔여" readout; 0 = just show tokens used. */
  monthlyBudget: number;
}

export const MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 빠름·저렴)' },
];

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-opus-5-5',
  monthlyBudget: 1_000_000,
  companionKey: '',
};
