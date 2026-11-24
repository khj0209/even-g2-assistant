import { BASE_LAYOUT, POPUP_LAYOUT, type Box } from './layout';
import { paintHero } from './paint';

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
  /** The mode dashboard's big number and caption, or null to leave that area dark. */
  hero: { big: string; caption: string } | null;
  detail: string;
  /** The conversation popup's current page, or null when it is closed. */
  popup: string | null;
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
    case 'popup':
      return [v.popup || ' '];
    case 'hero':
      return [v.hero ? `${v.hero.big}|${v.hero.caption}` : '', () => paintHero(v.hero)];
  }
}

/** Turns a ScreenView into per-container updates, sending only what changed. */
export class Renderer {
  private sinks: Sink[] = [];
  private sent = new Map<number, string>();
  private last: ScreenView | null = null;
  private layout: Box[] | null = null;

  addSink(sink: Sink): void {
    this.sinks.push(sink);
    if (this.layout) {
      sink.setLayout(this.layout);
      this.redraw();
    }
  }

  /** Rebuild the page and redraw everything, e.g. after another screen had the glasses. */
  relayout(): void {
    this.layout = null;
    this.redraw();
  }

  /** Forget what was sent and push everything again (e.g. after the glasses page was rebuilt). */
  redraw(): void {
    this.sent.clear();
    if (this.last) this.render(this.last);
  }

  render(v: ScreenView): void {
    this.last = v;
    const layout = v.popup != null ? POPUP_LAYOUT : BASE_LAYOUT;
    if (layout !== this.layout) {
      // Opening or closing the popup rebuilds the page, which clears every container.
      this.layout = layout;
      this.sent.clear();
      for (const s of this.sinks) s.setLayout(layout);
    }
    for (const b of layout) {
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
