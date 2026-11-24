import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { Box } from './layout';
import { pngBytes } from './paint';
import type { Sink } from './renderer';

/** Container fields for the SDK, exported so tests can run the SDK's own validator on them. */
export function pageFields(boxes: Box[]) {
  const base = (b: Box, z: number) => ({
    xPosition: b.x,
    yPosition: b.y,
    width: b.w,
    height: b.h,
    containerID: b.id,
    containerName: b.name,
    zOrderIndex: z,
  });
  return {
    containerTotalNum: boxes.length,
    textObject: boxes.flatMap((b, z) =>
      b.kind === 'text'
        ? [
            new TextContainerProperty({
              ...base(b, z),
              content: ' ',
              paddingLength: b.border ? 10 : 4,
              ...(b.border ? { borderWidth: 2, borderColor: 12, borderRadius: 8 } : {}),
              isEventCapture: b.capture ? 1 : 0,
            }),
          ]
        : [],
    ),
    imageObject: boxes.flatMap((b, z) => (b.kind === 'image' ? [new ImageContainerProperty(base(b, z))] : [])),
  };
}

/**
 * Drives the G2 display through the Even App bridge. The link is slow and must not be used
 * concurrently, so updates are queued latest-wins per container and sent one at a time,
 * text before images.
 */
export class GlassesSink implements Sink {
  private layout: Box[] | null = null;
  private texts = new Map<number, { box: Box; content: string; level: number }>();
  private images = new Map<number, { box: Box; image: HTMLCanvasElement }>();
  private created = false;
  private pumping = false;
  /** While another screen (the Drive HUD) owns the glasses, nothing is sent; updates wait for resume. */
  private paused = false;
  /** Resolves once the startup page exists (the glasses microphone needs it). */
  ready: Promise<boolean>;
  private resolveReady!: (ok: boolean) => void;

  constructor(private bridge: EvenAppBridge) {
    this.ready = new Promise((r) => (this.resolveReady = r));
  }

  setLayout(boxes: Box[]): void {
    this.layout = boxes;
    this.texts.clear();
    this.images.clear();
    void this.pump();
  }

  setText(box: Box, content: string, level: number): void {
    this.texts.set(box.id, { box, content, level });
    void this.pump();
  }

  setImage(box: Box, image: HTMLCanvasElement): void {
    this.images.set(box.id, { box, image });
    void this.pump();
  }

  pause(): void {
    this.paused = true;
  }

  /** Back in charge: the caller re-lays out the page (Renderer.relayout), which also drops stale queued updates. */
  resume(): void {
    this.paused = false;
  }

  exit(): void {
    void this.bridge.shutDownPageContainer(1);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.paused) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.paused) break;
        if (this.layout) {
          const boxes = this.layout;
          this.layout = null;
          await this.applyLayout(boxes);
        } else if (this.texts.size) {
          const [id, { box, content, level }] = this.texts.entries().next().value!;
          this.texts.delete(id);
          await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({ containerID: box.id, containerName: box.name, content, textColor: level }),
          );
        } else if (this.images.size) {
          const [id, { box, image }] = this.images.entries().next().value!;
          this.images.delete(id);
          const result = await this.bridge.updateImageRawData(
            new ImageRawDataUpdate({ containerID: box.id, containerName: box.name, imageData: pngBytes(image) }),
          );
          if (result !== ImageRawDataUpdateResult.success) console.warn('[glasses] image', box.name, result);
        } else break;
      }
    } catch (e) {
      console.error('[glasses]', e);
    } finally {
      this.pumping = false;
    }
  }

  private async applyLayout(boxes: Box[]): Promise<void> {
    const page = pageFields(boxes);
    if (this.created) {
      if (!(await this.bridge.rebuildPageContainer(new RebuildPageContainer(page)))) console.warn('[glasses] rebuild failed');
      return;
    }
    const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
    this.created = result === StartUpPageCreateResult.success;
    if (!this.created) console.warn('[glasses] create page', result);
    this.resolveReady(this.created);
  }
}
