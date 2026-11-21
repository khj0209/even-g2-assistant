export const SCREEN = { w: 576, h: 288 };

export interface Box {
  id: number;
  name: 'status' | 'pet' | 'reply';
  kind: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Receives touchpad events. Exactly one per layout. */
  capture?: boolean;
}

/** The Maltese image: a 24×24 pixel sprite at 5× plus a one-line label below it. */
export const PET = { w: 136, h: 144, scale: 5, spriteX: 8, labelY: 122 };

/** Reply text area, and the estimated text width / line count that fits in it. */
export const REPLY = { x: 150, y: 44, w: 422, h: 240, textWidth: 396, lines: 7 };

// Ids are contiguous from 1: a non-contiguous id once failed to render on real hardware.
export const LAYOUT: Box[] = [
  { id: 1, name: 'status', kind: 'text', x: 0, y: 0, w: SCREEN.w, h: 40 },
  { id: 2, name: 'pet', kind: 'image', x: 6, y: 78, w: PET.w, h: PET.h },
  { id: 3, name: 'reply', kind: 'text', x: REPLY.x, y: REPLY.y, w: REPLY.w, h: REPLY.h, capture: true },
];

export const box = (name: Box['name']): Box => LAYOUT.find((b) => b.name === name)!;
