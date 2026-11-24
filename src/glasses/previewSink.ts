import { SCREEN, type Box } from './layout';
import type { Sink } from './renderer';

const GREEN = '#35f06a';

/** Mirrors the glasses screen onto a canvas in the phone page, in the glasses' green. */
export class PreviewSink implements Sink {
  private boxes: Box[] = [];
  private texts = new Map<number, { content: string; level: number }>();
  private images = new Map<number, HTMLCanvasElement>();
  private ctx: CanvasRenderingContext2D;
  private queued = false;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = SCREEN.w;
    canvas.height = SCREEN.h;
    this.ctx = canvas.getContext('2d')!;
  }

  setLayout(boxes: Box[]): void {
    this.boxes = boxes;
    this.texts.clear();
    this.images.clear();
    this.schedule();
  }

  setText(box: Box, content: string, level: number): void {
    this.texts.set(box.id, { content, level });
    this.schedule();
  }

  setImage(box: Box, image: HTMLCanvasElement): void {
    this.images.set(box.id, image);
    this.schedule();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.paint();
    });
  }

  private paint(): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN.w, SCREEN.h);
    for (const b of this.boxes) {
      const img = this.images.get(b.id);
      if (img) ctx.drawImage(img, b.x, b.y);
      if (b.border) {
        // The popup covers whatever is behind it, like on the glasses where nothing under it is lit.
        ctx.fillStyle = '#000';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 8);
        ctx.stroke();
      }
      const t = this.texts.get(b.id);
      if (!t) continue;
      const g = Math.round(80 + (175 * t.level) / 4);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.font = '21px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      const pad = b.border ? 12 : 6;
      t.content.split('\n').forEach((line, i) => ctx.fillText(line, b.x + pad, b.y + pad + 2 + i * 30, b.w - pad * 2));
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, 0, SCREEN.w, SCREEN.h);
  }
}
