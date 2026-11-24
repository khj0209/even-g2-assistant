import { HERO } from './layout';

/**
 * The dashboard's big number with a small caption underneath and, for timers, a thin progress bar.
 * Black (nothing lit) when there is none. Greys come out as dimmer green on the glasses.
 */
export function paintHero(hero: { big: string; caption: string; progress?: number } | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = HERO.w;
  c.height = HERO.h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, HERO.w, HERO.h);
  if (!hero) return c;
  const cx = HERO.w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  // Largest size that fits the width, so "1:02:05" and "12" both fill the panel.
  let size = 80;
  do ctx.font = `600 ${size}px system-ui, sans-serif`;
  while (ctx.measureText(hero.big).width > HERO.w - 16 && (size -= 4) > 24);
  ctx.fillText(hero.big, cx, 70);
  ctx.fillStyle = '#9a9a9a';
  ctx.font = '500 17px system-ui, sans-serif';
  ctx.fillText(hero.caption, cx, 93, HERO.w - 16);
  if (hero.progress != null) {
    // A hairline track with the elapsed part bright, like a watch's sub-dial.
    const w = 180;
    const x = cx - w / 2;
    const p = Math.min(1, Math.max(0, hero.progress));
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3c3c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 104);
    ctx.lineTo(x + w, 104);
    ctx.stroke();
    if (p > 0) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, 104);
      ctx.lineTo(x + w * p, 104);
      ctx.stroke();
    }
  }
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
