export const SCREEN = { w: 576, h: 288 };

export interface Box {
  id: number;
  name: 'status' | 'media' | 'hero' | 'detail' | 'popup';
  kind: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Receives touchpad events. Exactly one per layout. */
  capture?: boolean;
  /** Draw a frame around the text (the conversation popup). */
  border?: boolean;
}

/** Mode dashboard's big number, drawn as an image because the glasses' text font has one size. */
export const HERO = { x: 144, y: 100, w: 288, h: 112 };

/** The conversation popup, and the estimated text width / line count that fits inside its frame. */
export const POPUP = { x: 20, y: 68, w: 536, h: 216, textWidth: 486, lines: 6 };

const status: Box = { id: 1, name: 'status', kind: 'text', x: 0, y: 0, w: SCREEN.w, h: 36 };
// Two lines: what's playing, and the lyric being sung.
const media: Box = { id: 2, name: 'media', kind: 'text', x: 0, y: 32, w: SCREEN.w, h: 66 };
const hero: Box = { id: 3, name: 'hero', kind: 'image', ...HERO };
const detail: Box = { id: 4, name: 'detail', kind: 'text', x: 20, y: HERO.y + HERO.h + 4, w: 536, h: 70 };

// Ids are contiguous from 1: a non-contiguous id once failed to render on real hardware.
/** Status, now playing and the mode's dashboard. */
export const BASE_LAYOUT: Box[] = [status, media, hero, { ...detail, capture: true }];

/**
 * The same with the conversation popup on top (last = front). A text box's frame can't be changed
 * after the page is built, so opening and closing the popup switches between the two layouts.
 */
export const POPUP_LAYOUT: Box[] = [status, media, hero, detail, { id: 5, name: 'popup', kind: 'text', x: POPUP.x, y: POPUP.y, w: POPUP.w, h: POPUP.h, capture: true, border: true }];
