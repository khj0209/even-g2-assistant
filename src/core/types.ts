import type { ContextMode } from './modes';

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

/** What the bear is doing; drives its sprite and label. */
export type Mood = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy' | 'error';

export type SttMode = 'auto' | 'openai' | 'phone';

export interface Settings {
  model: string;
  /** 'auto' follows the Android companion app; otherwise this mode is fixed. */
  mode: ContextMode | 'auto';
  /** Monthly token budget for the "AI 잔여" readout; 0 = just show tokens used. */
  monthlyBudget: number;
  stt: SttMode;
  /** OpenAI transcription model used with the glasses microphone. */
  sttModel: string;
}

export const MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 빠름·저렴)' },
];

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-opus-5-5',
  monthlyBudget: 1_000_000,
  mode: 'auto',
  stt: 'auto',
  sttModel: 'gpt-4o-mini-transcribe',
};
