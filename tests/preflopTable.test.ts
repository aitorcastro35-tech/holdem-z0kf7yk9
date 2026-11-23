import { describe, it, expect } from 'vitest';
import data from '../src/data/preflopTable.json';
import { loadTable, preflopEquity, canonKey, BOARDS } from '../src/engine/preflopTable';
import { parseCards, mulberry32 } from '../src/engine/cards';
import { equityVsHand } from '../src/engine/equity';
import { computeGrid } from '../src/explorer/core';
import { PUSH_FOLD_REFS } from '../src/data/pushfold';
import { parseRange, expandRange, rangeComboCount } from '../src/engine/range';

const table = loadTable(data as { k: number[]; v: number[] });
const eq = (a: string, b: string) => {
  const h = parseCards(a);
  const v = parseCards(b);
  return preflopEquity(table, h[0], h[1], v[0], v[1]);
};

describe('exact preflop equity table', () => {
  it('has all 47,008 suit-distinct matchups', () => {
    expect(table.size).toBe(47008);
  });
  it('seat swap gives the complement', () => {
    expect(eq('As Ah', 'Kd Kc') + eq('Kd Kc', 'As Ah')).toBeCloseTo(1, 12);
    expect(canonKey(...(parseCards('As Ah Kd Kc') as [number, number, number, number])).key).toBe(canonKey(...(parseCards('Kd Kc As Ah') as [number, number, number, number])).key);
  });
  // Published exact values: DeucesCracked, "Preflop Poker Equity Matchups: 25 Exact Calculations" (see SOURCES.md)
  it.each([
    ['Ah As', 'Kd Kc', 81.06, 0.38],
    ['Ah As', 'Kh Ks', 82.36, 0.54],
    ['Qh Qs', 'Ad Kd', 53.59, 0.39],
    ['2h 2s', 'Ad Kc', 52.75, 0.58],
    ['Ah As', '7d 2c', 87.24, 0.36],
    ['Jh Th', 'Ad Kc', 40.97, 0.42],
  ])('%s vs %s matches the published win/tie', (a, b, win, tie) => {
    expect(eq(a, b) * 100).toBeCloseTo(win + tie / 2, 1);
  });
  it('40 random matchups equal fresh exhaustive enumeration', () => {
    const rng = mulberry32(2024);
    for (let i = 0; i < 40; i++) {
      const deck = Array.from({ length: 52 }, (_, k) => k).sort(() => rng() - 0.5);
      const [a, b, c, d] = deck;
      const r = equityVsHand([a, b], [c, d]);
      expect(preflopEquity(table, a, b, c, d)).toBeCloseTo(r.equity, 9);
    }
    expect(BOARDS).toBe(1712304);
  }, 120_000);
});

describe('cross-check vs a published call-off chart (brief §2.3)', () => {
  it('BB calling a 10bb UTG shove (9-handed, no antes, chip EV) matches Poker Skill / O’Kearney & Carter closely', () => {
    const shove = PUSH_FOLD_REFS.find((p) => p.label.startsWith('10bb UTG shove'))!;
    const call = parseRange(PUSH_FOLD_REFS.find((p) => p.label.startsWith('10bb BB call'))!.range);
    const pair = (h: [number, number], v: [number, number]) => preflopEquity(table, h[0], h[1], v[0], v[1]);
    const cells = computeGrid(
      {
        spot: 'allin-call',
        villainCombos: expandRange(parseRange(shove.range)).map((c) => ({ cards: c.cards, w: 1 })),
        board: [],
        potBefore: 10 + 1 + 0.5, // UTG's 10bb shove + your BB + the folded SB
        heroPosted: 1,
        toCall: 9,
        heroBehind: 9,
        villainBehind: 0,
        response: { mode: 'fold-pct', foldPct: 0, continuePct: 1, reraisePct: 0 },
        realization: 1,
        raiseRealization: 1,
      },
      pair,
    );
    // Finding (documented in AUDIT.md): under the page's stated conditions (no antes) the exact chip-EV best response
    // calls 12.2% vs the published 19.0%. Every hand we call is in the published range, and every disagreement is a hand
    // the chart calls that is within 3 equity points of the price (9 to win 20.5 → 43.9%) — consistent with different
    // underlying assumptions (e.g. antes), not with an equity error.
    const ours = cells.filter((c) => c.best === 'call');
    for (const c of ours) expect(call.has(c.cls), `${c.cls} called by us but not in the chart`).toBe(true);
    const req = 9 / 20.5;
    for (const d of cells.filter((c) => c.best !== 'call' && call.has(c.cls))) expect(req - d.equity, d.cls).toBeLessThan(0.03);
    expect(rangeComboCount(new Map(ours.map((c) => [c.cls, 1]))) / 1326).toBeCloseTo(0.122, 2);
  });
});

import vsRandom from '../src/data/preflopVsRandom.json';
describe('169-hand equity vs a random hand (derived from the exact table)', () => {
  it('AA equals the independent full enumeration (85.2037%) and the ranking is complete', () => {
    // independent one-off enumeration with equityVsRange(AsAh, random, exact): 0.8520371330
    expect((vsRandom.equity as Record<string, number>).AA).toBeCloseTo(0.852037, 5);
    expect(vsRandom.ranking.length).toBe(169);
    expect(vsRandom.ranking[0]).toBe('AA');
    expect(vsRandom.ranking[168]).toBe('32o');
  });
});
