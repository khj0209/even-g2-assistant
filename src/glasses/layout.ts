export const SCREEN = { w: 576, h: 288 };

export interface Box {
  id: number;
  name: 'status' | 'media' | 'pet' | 'hero' | 'detail' | 'reply';
  kind: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Receives touchpad events. Exactly one per layout. */
  capture?: boolean;
}

/** The bear image, bottom-left: an 18×18 pixel sprite at 4× plus a one-line label below it. */
export const PET = { x: 2, y: 196, w: 72, h: 90, scale: 4, spriteX: 0, labelY: 72 };

/** Mode dashboard's big number, drawn as an image because the glasses' text font has one size. */
export const HERO = { x: 186, y: 70, w: 288, h: 112 };

/** Reply text area right of the bear, and the estimated text width / line count that fits in it. */
export const REPLY = { x: 82, y: 66, w: 490, h: 218, textWidth: 462, lines: 7 };

// Layers, back to front: the hero image and the dashboard's detail lines sit under the reply text
// (which is blank while the dashboard shows), so either view fills the same space without a page rebuild.
// Ids are contiguous from 1: a non-contiguous id once failed to render on real hardware.
export const LAYOUT: Box[] = [
  { id: 1, name: 'status', kind: 'text', x: 0, y: 0, w: SCREEN.w, h: 36 },
  { id: 2, name: 'media', kind: 'text', x: 0, y: 32, w: SCREEN.w, h: 34 },
  { id: 3, name: 'pet', kind: 'image', x: PET.x, y: PET.y, w: PET.w, h: PET.h },
  { id: 4, name: 'hero', kind: 'image', x: HERO.x, y: HERO.y, w: HERO.w, h: HERO.h },
  { id: 5, name: 'detail', kind: 'text', x: REPLY.x, y: HERO.y + HERO.h + 4, w: REPLY.w, h: 98 },
  { id: 6, name: 'reply', kind: 'text', x: REPLY.x, y: REPLY.y, w: REPLY.w, h: REPLY.h, capture: true },
];
