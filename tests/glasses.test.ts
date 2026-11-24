import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { describe, expect, it } from 'vitest';
import { pageFields } from '../src/glasses/glassesSink';
import { BASE_LAYOUT, HERO, POPUP, POPUP_LAYOUT, SCREEN } from '../src/glasses/layout';

describe.each([
  ['base', BASE_LAYOUT],
  ['popup', POPUP_LAYOUT],
])('%s layout', (_, layout) => {
  it('passes the SDK page validator', () => {
    expect(validateEvenHubPageContainer(pageFields(layout))).toEqual({ valid: true });
  });

  it('fits the screen, uses contiguous ids and exactly one event-capturing box', () => {
    expect(layout.map((b) => b.id)).toEqual(layout.map((_, i) => i + 1));
    expect(layout.filter((b) => b.capture)).toHaveLength(1);
    for (const b of layout) {
      expect(b.x + b.w).toBeLessThanOrEqual(SCREEN.w);
      expect(b.y + b.h).toBeLessThanOrEqual(SCREEN.h);
      if (b.kind === 'image') {
        expect(b.w).toBeLessThanOrEqual(288);
        expect(b.h).toBeLessThanOrEqual(144);
      }
    }
  });
});

describe('popup', () => {
  it('sits in front of the dashboard and covers the big number', () => {
    expect(POPUP_LAYOUT.at(-1)).toMatchObject({ name: 'popup', border: true, capture: true });
    expect(POPUP.x).toBeLessThanOrEqual(HERO.x);
    expect(POPUP.x + POPUP.w).toBeGreaterThanOrEqual(HERO.x + HERO.w);
    expect(POPUP.textWidth).toBeLessThan(POPUP.w - 20);
  });

  it('keeps the shared boxes identical in both layouts', () => {
    expect(POPUP_LAYOUT.slice(0, BASE_LAYOUT.length).map(({ capture: _c, ...b }) => b)).toEqual(BASE_LAYOUT.map(({ capture: _c, ...b }) => b));
  });
});
