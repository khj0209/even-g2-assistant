import type { Mood } from '../core/types';
import { PET } from './layout';
import { PALETTE, petLabel, spriteGrid } from './sprite';

/** Paints the bear and its label into a canvas the size of the pet container. */
export function paintPet(mood: Mood, frame: number, name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PET.w;
  c.height = PET.h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, PET.w, PET.h);
  spriteGrid(mood, frame).forEach((row, y) =>
    [...row].forEach((code, x) => {
      const g = PALETTE[code] ?? 0;
      if (!g) return;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(PET.spriteX + x * PET.scale, y * PET.scale, PET.scale, PET.scale);
    }),
  );
  ctx.fillStyle = '#ddd';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(petLabel(mood, frame, name), PET.w / 2, PET.labelY);
  return c;
}

/** PNG bytes for the glasses. Synchronous toDataURL: toBlob may never run in a backgrounded WebView. */
export function pngBytes(c: HTMLCanvasElement): number[] {
  const url = c.toDataURL('image/png');
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
