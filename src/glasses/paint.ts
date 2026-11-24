import type { Mood } from '../core/types';
import { HERO, PET } from './layout';
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

/** The dashboard's big number with its caption underneath; black (nothing lit) when there is none. */
export function paintHero(hero: { big: string; caption: string } | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = HERO.w;
  c.height = HERO.h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, HERO.w, HERO.h);
  if (!hero) return c;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Largest size that fits the width, so "1:02:05" and "12" both fill the panel.
  let size = 84;
  do ctx.font = `bold ${size}px system-ui, sans-serif`;
  while (ctx.measureText(hero.big).width > HERO.w - 8 && (size -= 4) > 24);
  ctx.fillText(hero.big, HERO.w / 2, 80);
  ctx.fillStyle = '#bbb';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText(hero.caption, HERO.w / 2, 106, HERO.w - 8);
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
