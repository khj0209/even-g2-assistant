import { AudioInputSource, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { PcmBuffer, pcmLevel } from '../core/pcm';

export class SttUnavailableError extends Error {}

/** Below this the recording is treated as silence and not sent for transcription. */
const MIN_SECONDS = 0.4;
const MIN_LEVEL = 0.004;

/** Push-to-talk on the glasses microphone: start on long-press, stop on release, then transcribe. */
export class GlassesMicRecognizer {
  private pcm = new PcmBuffer(60);
  private listening = false;
  private tick: ReturnType<typeof setInterval> | null = null;

  constructor(
    private bridge: EvenAppBridge,
    private transcribe: (pcm: Uint8Array) => Promise<string>,
  ) {}

  /** Fed by the app's single Even Hub event subscription. */
  feed(chunk: Uint8Array): void {
    if (this.listening) this.pcm.push(chunk);
  }

  async start(onPartial: (text: string) => void): Promise<void> {
    this.pcm.clear();
    this.listening = true;
    const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses);
    if (!ok) {
      this.listening = false;
      throw new SttUnavailableError('안경 마이크를 켤 수 없어요');
    }
    this.tick = setInterval(() => onPartial(`(${this.pcm.seconds.toFixed(0)}초)`), 1000);
  }

  /** Stops listening and resolves with what was said ('' for silence). */
  async stop(): Promise<string> {
    this.end();
    const pcm = this.pcm.bytes();
    this.pcm.clear();
    if (pcm.length / 32000 < MIN_SECONDS || pcmLevel(pcm) < MIN_LEVEL) return '';
    return this.transcribe(pcm);
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
