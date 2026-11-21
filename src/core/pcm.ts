// The glasses microphone delivers raw PCM. The Even SDK doesn't document the format; the G2
// sends 16 kHz, 16-bit little-endian mono, which is what speech-to-text services expect.
export const PCM_RATE = 16_000;
export const PCM_BYTES_PER_SAMPLE = 2;

/** Collects PCM frames while the wearer holds the touchpad. */
export class PcmBuffer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  constructor(private maxSeconds = 60) {}

  push(chunk: Uint8Array): void {
    if (this.size >= this.maxSeconds * PCM_RATE * PCM_BYTES_PER_SAMPLE) return;
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  get seconds(): number {
    return this.size / (PCM_RATE * PCM_BYTES_PER_SAMPLE);
  }

  clear(): void {
    this.chunks = [];
    this.size = 0;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.size - (this.size % PCM_BYTES_PER_SAMPLE));
    let off = 0;
    for (const c of this.chunks) {
      const n = Math.min(c.length, out.length - off);
      out.set(c.subarray(0, n), off);
      off += n;
    }
    return out;
  }
}

/** Wraps 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = PCM_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * PCM_BYTES_PER_SAMPLE, true);
  v.setUint16(32, PCM_BYTES_PER_SAMPLE, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Root-mean-square level of 16-bit PCM, 0..1. Used to skip transcribing silence. */
export function pcmLevel(pcm: Uint8Array): number {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = v.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}
