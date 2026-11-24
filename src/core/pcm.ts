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
