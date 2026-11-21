import type { Mood } from '../core/types';

// A 24×24 pixel Maltese: white fur, floppy grey ears, a bow on the topknot.
// Pixels: '.' off, 'o' outline, 'w' fur, 'e' ears, 'p' bow, 'k' eyes/nose/mouth (off),
// 't' tongue, 's' effects (sound waves, "?", "!", heart).
// Eyes, mouth and effects are stamped on by `spriteGrid`, so the base has none.
const BASE = [
  '........................',
  '........pp....pp........',
  '........pppppppp........',
  '........pp.ww.pp........',
  '..........wwww..........',
  '.......owwwwwwwwo.......',
  '......owwwwwwwwwwo......',
  '....eeowwwwwwwwwwoee....',
  '...eeeowwwwwwwwwwoeee...',
  '...eeeowwwwwwwwwwoeee...',
  '..eeeeowwwwwwwwwwoeeee..',
  '..eeeeowwwwkkwwwwoeeee..',
  '..eeee.owwwwwwwwo.eeee..',
  '..eeee..owwwwwwo..eeee..',
  '..eee.oowwwwwwwwoo.eee..',
  '..ee.owwwwwwwwwwwwo.ee..',
  '...e.owwwwwwwwwwwwo.e...',
  '.....owwwwwwwwwwwwo.....',
  '....owwwwwwwwwwwwwwo....',
  '....owwwwwwwwwwwwwwo....',
  '....owwwwwowwowwwwwo....',
  '....owwwwwowwowwwwwo....',
  '.....oooooo..oooooo.....',
  '........................',
];

export const SPRITE_SIZE = 24;

/** Grey level (0..255) per pixel code. The glasses show 16 levels of green. */
export const PALETTE: Record<string, number> = {
  '.': 0,
  o: 110,
  w: 245,
  e: 185,
  p: 150,
  k: 0,
  t: 120,
  s: 255,
};

const EYES_L = 9;
const EYES_R = 13;

type Grid = string[][];

function set(g: Grid, x: number, y: number, c: string): void {
  if (y >= 0 && y < SPRITE_SIZE && x >= 0 && x < SPRITE_SIZE) g[y][x] = c;
}

function stamp(g: Grid, x0: number, y0: number, rows: string[]): void {
  rows.forEach((row, dy) => [...row].forEach((c, dx) => c !== ' ' && set(g, x0 + dx, y0 + dy, c)));
}

function eyes(g: Grid, kind: 'open' | 'closed' | 'up'): void {
  for (const x of [EYES_L, EYES_R]) {
    if (kind === 'open') stamp(g, x, 8, ['kk', 'kk']);
    else if (kind === 'up') stamp(g, x, 7, ['kk', 'kk']);
    else stamp(g, x, 9, ['kk']);
  }
}

function mouth(g: Grid, open: boolean): void {
  // Closed: a small "ω" under the nose. Open: a dark mouth with a tongue.
  if (open) stamp(g, 10, 12, ['kkkk', ' tt ']);
  else stamp(g, 10, 12, ['k  k']);
}

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
      // Sound waves next to the right ear, growing with the frame.
      stamp(g, 19, 1, ['s ', ' s', ' s', 's ']);
      if (frame % 2 === 1) stamp(g, 21, 0, ['s ', ' s', ' s', ' s', ' s', 's ']);
      break;
    case 'thinking':
      eyes(g, 'up');
      mouth(g, false);
      stamp(g, 19, 0, QUESTION);
      break;
    case 'talking':
      eyes(g, 'open');
      mouth(g, frame % 2 === 0);
      break;
    case 'happy':
      eyes(g, 'closed');
      mouth(g, true);
      stamp(g, 19, 1, HEART);
      break;
    case 'error':
      eyes(g, 'closed');
      mouth(g, false);
      stamp(g, 20, 0, BANG);
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
