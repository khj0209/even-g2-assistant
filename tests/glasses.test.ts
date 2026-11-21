import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { describe, expect, it } from 'vitest';
import type { Mood } from '../src/core/types';
import { pageFields } from '../src/glasses/glassesSink';
import { LAYOUT, PET, REPLY, SCREEN } from '../src/glasses/layout';
import { petKey } from '../src/glasses/renderer';
import { PALETTE, petLabel, SPRITE_SIZE, spriteGrid } from '../src/glasses/sprite';

const MOODS: Mood[] = ['idle', 'listening', 'thinking', 'talking', 'happy', 'error'];

describe('layout', () => {
  it('passes the SDK page validator', () => {
    expect(validateEvenHubPageContainer(pageFields(LAYOUT))).toEqual({ valid: true });
  });

  it('fits the screen, uses contiguous ids and exactly one event-capturing box', () => {
    expect(LAYOUT.map((b) => b.id)).toEqual([1, 2, 3]);
    expect(LAYOUT.filter((b) => b.capture)).toHaveLength(1);
    for (const b of LAYOUT) {
      expect(b.x + b.w).toBeLessThanOrEqual(SCREEN.w);
      expect(b.y + b.h).toBeLessThanOrEqual(SCREEN.h);
      if (b.kind === 'image') {
        expect(b.w).toBeLessThanOrEqual(288);
        expect(b.h).toBeLessThanOrEqual(144);
      }
    }
  });

  it('keeps the sprite and its label inside the pet image', () => {
    expect(PET.spriteX + SPRITE_SIZE * PET.scale).toBeLessThanOrEqual(PET.w);
    expect(SPRITE_SIZE * PET.scale).toBeLessThanOrEqual(PET.labelY);
    expect(REPLY.textWidth).toBeLessThan(REPLY.w);
  });
});

describe('bear sprite', () => {
  it('is 24×24 with known pixel codes for every mood and frame', () => {
    for (const mood of MOODS) {
      for (let f = 0; f < 4; f++) {
        const g = spriteGrid(mood, f);
        expect(g).toHaveLength(SPRITE_SIZE);
        for (const row of g) {
          expect(row).toHaveLength(SPRITE_SIZE);
          for (const c of row) expect(PALETTE).toHaveProperty(c);
        }
      }
    }
  });

  it('animates: blinking, talking and listening frames differ', () => {
    expect(spriteGrid('idle', 0)).not.toEqual(spriteGrid('idle', 1));
    expect(spriteGrid('talking', 0)).not.toEqual(spriteGrid('talking', 1));
    expect(spriteGrid('listening', 0)).not.toEqual(spriteGrid('listening', 1));
    expect(new Set(MOODS.map((m) => spriteGrid(m, 0).join('\n'))).size).toBe(MOODS.length);
  });

  it('collapses identical frames so unchanged sprites are not resent', () => {
    expect(petKey('happy', 0)).toBe(petKey('happy', 7));
    expect(petKey('talking', 0)).toBe(petKey('talking', 2));
    expect(petKey('thinking', 0)).not.toBe(petKey('thinking', 1));
  });

  it('labels the mood', () => {
    expect(petLabel('listening', 0, '몽이')).toBe('듣는 중');
    expect(petLabel('thinking', 2, '몽이')).toBe('생각 중...');
    expect(petLabel('idle', 0, '몽이')).toBe('몽이');
  });
});
