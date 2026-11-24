import type { Mood } from '../core/types';
import { LAYOUT, type Box } from './layout';
import { paintHero, paintPet } from './paint';

/** Somewhere the screen can be shown: the glasses, or the mirror on the phone. */
export interface Sink {
  setLayout(boxes: Box[]): void;
  /** `level`: text brightness 0..4 (4 = full). */
  setText(box: Box, content: string, level: number): void;
  setImage(box: Box, image: HTMLCanvasElement): void;
}

export interface ScreenView {
  status: string;
  /** Now playing, or '' when nothing plays. */
  media: string;
  mood: Mood;
  frame: number;
  petName: string;
  /** The mode dashboard's big number and caption, or null while an answer (or the plain assistant) shows. */
  hero: { big: string; caption: string } | null;
  detail: string;
  reply: string;
}

/** What a container should show, and for images how to paint it. Text boxes get ' ' when empty. */
function content(b: Box, v: ScreenView): [string, (() => HTMLCanvasElement)?] {
  switch (b.name) {
    case 'status':
      return [v.status];
    case 'media':
      return [v.media || ' '];
    case 'detail':
      return [v.detail || ' '];
    case 'reply':
      return [v.reply || ' '];
    case 'pet':
      return [`${petKey(v.mood, v.frame)}|${v.petName}`, () => paintPet(v.mood, v.frame, v.petName)];
    case 'hero':
      return [v.hero ? `${v.hero.big}|${v.hero.caption}` : '', () => paintHero(v.hero)];
  }
}

/** Collapses frames that look the same, so an unchanged sprite is never resent. */
export function petKey(mood: Mood, frame: number): string {
  const cycle = mood === 'thinking' ? 3 : mood === 'happy' || mood === 'error' ? 1 : 2;
  return `${mood}|${frame % cycle}`;
}

/** Turns a ScreenView into per-container updates, sending only what changed. */
export class Renderer {
  private sinks: Sink[] = [];
  private sent = new Map<number, string>();
  private last: ScreenView | null = null;
  private started = false;

  addSink(sink: Sink): void {
    this.sinks.push(sink);
    if (this.started) {
      sink.setLayout(LAYOUT);
      this.redraw();
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const s of this.sinks) s.setLayout(LAYOUT);
    this.redraw();
  }

  /** Forget what was sent and push everything again (e.g. after the glasses page was rebuilt). */
  redraw(): void {
    this.sent.clear();
    if (this.last) this.render(this.last);
  }

  render(v: ScreenView): void {
    this.last = v;
    if (!this.started) return;
    for (const b of LAYOUT) {
      const [key, paint] = content(b, v);
      if (this.sent.get(b.id) === key) continue;
      this.sent.set(b.id, key);
      if (paint) {
        const img = paint();
        for (const s of this.sinks) s.setImage(b, img);
      } else {
        const level = b.name === 'status' || b.name === 'media' ? 3 : 4;
        for (const s of this.sinks) s.setText(b, key, level);
      }
    }
  }
}
