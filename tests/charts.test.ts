import { describe, it, expect } from 'vitest';
import { CHARTS, chartAction } from '../src/data/charts';
import { parseRange, rangeComboCount } from '../src/engine/range';

describe('preflop charts: transcription check', () => {
  // Poker Skill's text ranges reproduce its printed percentages exactly (to rounding).
  // PokerCoaching's text lists summarise its chart images and differ from the printed % by up to ~0.9 points
  // (documented in SOURCES.md); the app displays the % computed from the text it actually uses.
  it.each(CHARTS.flatMap((c) => c.parts.map((p) => [c.id, p.action, p.range, p.publishedPercent, c.source] as const)))(
    '%s %s reproduces the published %%',
    (_id, _a, range, pct, source) => {
      const ours = (rangeComboCount(parseRange(range)) / 1326) * 100;
      const tol = source === 'pokercoaching' ? 1.0 : 0.06;
      expect(Math.abs(ours - pct)).toBeLessThanOrEqual(tol);
    },
  );
  it('ranges within one chart do not overlap', () => {
    for (const c of CHARTS) {
      const seen = new Set<string>();
      for (const p of c.parts) for (const k of parseRange(p.range).keys()) {
        expect(seen.has(k), `${c.id} ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });
  it('lookups', () => {
    const utg = CHARTS.find((c) => c.id === '6-rfi-UTG')!;
    expect(chartAction(utg, 'AA')).toBe('raise');
    expect(chartAction(utg, '72o')).toBe('fold');
    const btn = CHARTS.find((c) => c.id === '6-vs-BTN-CO')!;
    expect(chartAction(btn, 'A5s')).toBe('threebet');
    expect(chartAction(btn, 'TT')).toBe('call');
    expect(chartAction(btn, 'K2o')).toBe('fold');
  });
});
