import type { Mood } from '../core/types';

// A chibi baby bear: big round head with triangle ears, sparkly eyes, a small muzzle and a tiny body.
// Drawn as the left half of a 16×16 bear and mirrored, then padded to 18×18 so the top-right corner
// is free for effects. Pixels: '.' off, 'o' outline, 'f' fur, 'm' muzzle/belly, 'i' inner ear,
// 'b' cheek, 'k' eyes/nose/mouth (off), 't' tongue, 's' sparkle and effects ("?", "!", heart, waves).
// Eyes, mouth and effects are stamped on by `spriteGrid`.
const LEFT_HALF = [
  '........',
  '..o.....',
  '.oio.ooo',
  '.oiiofff',
  '.offffff',
  'offfffff',
  'offfffff',
  'offfffff',
  'ofbffffk',
  'offfffmm',
  '.offffmm',
  '..ooofff',
  '...offmm',
  '..ofoffm',
  '...offff',
  '....oo..',
];

export const SPRITE_SIZE = 18;
const PAD_X = 1;
const PAD_Y = 2;

const BASE = [
  ...Array.from({ length: PAD_Y }, () => '.'.repeat(SPRITE_SIZE)),
  ...LEFT_HALF.map((half) => '.'.repeat(PAD_X) + half + [...half].reverse().join('') + '.'.repeat(SPRITE_SIZE - 16 - PAD_X)),
];

/** Grey level (0..255) per pixel code. The glasses show 16 levels of green. */
export const PALETTE: Record<string, number> = {
  '.': 0,
  o: 110,
  f: 185,
  m: 250,
  i: 135,
  b: 150,
  k: 0,
  t: 120,
  s: 255,
};

const EYES_L = 4;
const EYES_R = 12;
const EYES_Y = 8;

type Grid = string[][];

function set(g: Grid, x: number, y: number, c: string): void {
  if (y >= 0 && y < SPRITE_SIZE && x >= 0 && x < SPRITE_SIZE) g[y][x] = c;
}

function stamp(g: Grid, x0: number, y0: number, rows: string[]): void {
  rows.forEach((row, dy) => [...row].forEach((c, dx) => c !== ' ' && set(g, x0 + dx, y0 + dy, c)));
}

function eyes(g: Grid, kind: 'open' | 'closed' | 'up'): void {
  // A white sparkle in the top-left of each eye makes them read as shiny at this size.
  for (const x of [EYES_L, EYES_R]) {
    if (kind === 'open') stamp(g, x, EYES_Y, ['sk', 'kk']);
    else if (kind === 'up') stamp(g, x, EYES_Y - 1, ['sk', 'kk']);
    else stamp(g, x, EYES_Y + 1, ['kk']);
  }
}

function mouth(g: Grid, open: boolean): void {
  // Closed: a small "ω" under the nose. Open: a dark mouth with a tongue.
  if (open) stamp(g, 7, 12, ['kkkk', ' tt ']);
  else stamp(g, 7, 12, ['k  k']);
}

// Effects live in the free top-right corner (columns 14-17, rows 0-2, and the right edge below).
const QUESTION = ['sss', '  s', ' s ', '   ', ' s '];
const BANG = ['s', 's', 's', ' ', 's'];
const HEART = ['s s', 'sss', ' s '];

/**
 * The sprite for a mood and animation frame.
 * idle: frame 1 blinks · listening: sound waves pulse · thinking: eyes up, "?" ·
 * talking: mouth opens on even frames · happy: closed eyes, open mouth, heart · error: "!".
 */
export function spriteGrid(mood: Mood, frame = 0): string[] {
  const g: Grid = BASE.map((r) => [...r]);
  switch (mood) {
    case 'idle':
      eyes(g, frame % 2 === 1 ? 'closed' : 'open');
      mouth(g, false);
      break;
    case 'listening':
      eyes(g, 'open');
      mouth(g, false);
      // Sound waves beside the right ear, growing with the frame.
      stamp(g, 16, 0, ['s ', ' s', ' s', 's ']);
      if (frame % 2 === 1) stamp(g, 14, 1, ['s', 's']);
      break;
    case 'thinking':
      eyes(g, 'up');
      mouth(g, false);
      stamp(g, 15, 0, QUESTION);
      break;
    case 'talking':
      eyes(g, 'open');
      mouth(g, frame % 2 === 0);
      break;
    case 'happy':
      eyes(g, 'closed');
      mouth(g, true);
      stamp(g, 15, 0, HEART);
      break;
    case 'error':
      eyes(g, 'closed');
      mouth(g, false);
      stamp(g, 17, 0, BANG);
      break;
  }
  return g.map((r) => r.join(''));
}

export function petLabel(mood: Mood, frame: number, name: string): string {
  switch (mood) {
    case 'listening':
      return '듣는 중';
    case 'thinking':
      return `생각 중${'.'.repeat((frame % 3) + 1)}`;
    case 'error':
      return '앗!';
    default:
      return name;
  }
}
