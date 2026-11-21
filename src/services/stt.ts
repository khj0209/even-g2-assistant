import { AudioInputSource, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { PcmBuffer, pcmLevel, pcmToWav } from '../core/pcm';
import type { SttMode } from '../core/types';

/** Push-to-talk speech recognition: start on long-press, stop on release. */
export interface Recognizer {
  readonly label: string;
  start(onPartial: (text: string) => void): Promise<void>;
  /** Stops listening and resolves with what was said ('' for nothing). */
  stop(): Promise<string>;
  cancel(): void;
}

export class SttUnavailableError extends Error {}

/** Below this the recording is treated as silence and not sent for transcription. */
const MIN_SECONDS = 0.4;
const MIN_LEVEL = 0.004;

/** Glasses microphone → OpenAI transcription. */
export class GlassesMicRecognizer implements Recognizer {
  readonly label = '안경 마이크 + OpenAI';
  private pcm = new PcmBuffer(60);
  private listening = false;
  private tick: ReturnType<typeof setInterval> | null = null;

  constructor(
    private bridge: EvenAppBridge,
    private getKey: () => Promise<string | null>,
    private model: string,
  ) {}

  /** Fed by the app's single Even Hub event subscription. */
  feed(chunk: Uint8Array): void {
    if (this.listening) this.pcm.push(chunk);
  }

  async start(onPartial: (text: string) => void): Promise<void> {
    if (!(await this.getKey())) throw new SttUnavailableError('OpenAI 키가 없어요');
    this.pcm.clear();
    this.listening = true;
    const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses);
    if (!ok) {
      this.listening = false;
      throw new SttUnavailableError('안경 마이크를 켤 수 없어요');
    }
    this.tick = setInterval(() => onPartial(`(${this.pcm.seconds.toFixed(0)}초)`), 1000);
  }

  async stop(): Promise<string> {
    this.end();
    const pcm = this.pcm.bytes();
    this.pcm.clear();
    if (pcm.length / 32000 < MIN_SECONDS || pcmLevel(pcm) < MIN_LEVEL) return '';
    const key = await this.getKey();
    if (!key) throw new SttUnavailableError('OpenAI 키가 없어요');
    return transcribeOpenAI(pcmToWav(pcm), key, this.model);
  }

  cancel(): void {
    this.end();
    this.pcm.clear();
  }

  private end(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    if (this.listening) void this.bridge.audioControl(false).catch(() => false);
    this.listening = false;
  }
}

export async function transcribeOpenAI(wav: Uint8Array, key: string, model: string, language = 'ko'): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', model);
  form.append('language', language);
  form.append('response_format', 'json');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (res.status === 401) throw new SttUnavailableError('OpenAI 키가 올바르지 않아요');
  if (!res.ok) throw new Error(`음성 인식 실패 (${res.status})`);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? '').trim();
}

// --- Phone speech recognition (Web Speech API), where the WebView offers it -----------------

interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function phoneSpeechSupported(): boolean {
  return !!speechCtor();
}

export class PhoneSpeechRecognizer implements Recognizer {
  readonly label = '휴대폰 음성인식';
  private rec: SpeechRecognitionLike | null = null;
  private finalText = '';
  private interim = '';
  private ended: Promise<void> = Promise.resolve();
  private error: string | null = null;

  async start(onPartial: (text: string) => void): Promise<void> {
    const Ctor = speechCtor();
    if (!Ctor) throw new SttUnavailableError('이 휴대폰 화면에서는 음성인식을 쓸 수 없어요');
    const rec = new Ctor();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    this.finalText = '';
    this.interim = '';
    this.error = null;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.interim = interim;
      onPartial((this.finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.error = e.error;
    };
    this.ended = new Promise((resolve) => (rec.onend = () => resolve()));
    this.rec = rec;
    rec.start();
  }

  async stop(): Promise<string> {
    const rec = this.rec;
    if (!rec) return '';
    rec.stop();
    // Some engines never fire `end`; don't hang the assistant on them.
    await Promise.race([this.ended, new Promise((r) => setTimeout(r, 2500))]);
    this.rec = null;
    if (this.error === 'not-allowed') throw new SttUnavailableError('마이크 권한이 필요해요');
    return (this.finalText + this.interim).trim();
  }

  cancel(): void {
    this.rec?.abort();
    this.rec = null;
  }
}

/** Which recognizer to use for the chosen mode, or why there is none. */
export function chooseStt(mode: SttMode, opts: { hasGlassesMic: boolean; hasOpenAIKey: boolean; phoneSpeech: boolean }):
  | { kind: 'glasses' | 'phone' }
  | { kind: 'none'; reason: string } {
  const glasses = opts.hasGlassesMic && opts.hasOpenAIKey;
  if (mode === 'openai') {
    if (!opts.hasOpenAIKey) return { kind: 'none', reason: '휴대폰에서 OpenAI 키를 등록해 주세요' };
    if (!opts.hasGlassesMic) return { kind: 'none', reason: '안경이 연결되어 있지 않아요' };
    return { kind: 'glasses' };
  }
  if (mode === 'phone') {
    return opts.phoneSpeech ? { kind: 'phone' } : { kind: 'none', reason: '이 휴대폰에서는 음성인식을 지원하지 않아요' };
  }
  if (glasses) return { kind: 'glasses' };
  if (opts.phoneSpeech) return { kind: 'phone' };
  return { kind: 'none', reason: '휴대폰에서 음성 인식(OpenAI 키)을 설정해 주세요' };
}
