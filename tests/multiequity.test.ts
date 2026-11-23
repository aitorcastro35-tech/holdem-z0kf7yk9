import { describe, it, expect } from 'vitest';
import { multiEquityHands, multiEquityVsRanges } from '../src/engine/multiequity';
import { equityVsHand } from '../src/engine/equity';
import { parseCards } from '../src/engine/cards';
import { parseRange, expandRange } from '../src/engine/range';

const P = parseCards;

describe('multiway equity — known hands', () => {
  it('two hands equal the heads-up engine (exact)', () => {
    const r = multiEquityHands([P('As Ah'), P('Kd Kc')], P('7c 2d 9s'));
    const hu = equityVsHand(P('As Ah'), P('Kd Kc'), P('7c 2d 9s'));
    expect(r.exact).toBe(true);
    expect(r.equity[0]).toBeCloseTo(hu.equity, 12);
  });
  // Published 3-way all-in preflop win percentages (approximate, as printed): PokerNews, Ashley Adams,
  // "Examining Three-Way All-In Situations in Hold'em" (Oct 23, 2020). Exact cards as in the article.
  // Our values are exact (all C(46,5) = 1,370,754 boards); the article rounds ("about", "nearly"), so ±1 point.
  it.each([
    ['As Ks', 'Qc Jc', '2d 2s', 39, 32, 28.3],
    ['Ad Kd', 'Qc Qh', '2d 2s', 37.8, 44.5, 18],
    ['Ks Kd', 'Qc Qh', '2d 2s', 66, 19, 14.5],
  ])('%s vs %s vs %s ≈ %s / %s / %s', (a, b, c, ea, eb, ec) => {
    const r = multiEquityHands([P(a), P(b), P(c)]);
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(1370754);
    expect(r.equity[0] * 100).toBeGreaterThan(ea - 1.2);
    expect(r.equity[0] * 100).toBeLessThan(ea + 1.2);
    expect(Math.abs(r.equity[1] * 100 - eb)).toBeLessThan(1.2);
    expect(Math.abs(r.equity[2] * 100 - ec)).toBeLessThan(1.2);
    expect(r.equity.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  }, 60_000);
});

describe('multiway equity — vs ranges (Monte Carlo)', () => {
  it('one exact-hand range reproduces the known-hands result', () => {
    const exact = multiEquityHands([P('As Ah'), P('Kd Kc'), P('Qs Qh')], P('7c 2d 9s')).equity[0];
    const mc = multiEquityVsRanges(P('As Ah'), [[{ cards: P('Kd Kc') as [number, number], weight: 1 }], [{ cards: P('Qs Qh') as [number, number], weight: 1 }]], P('7c 2d 9s'), { iterations: 60_000, seed: 3 });
    expect(Math.abs(mc.equity - exact)).toBeLessThan(0.01);
  });
  it('equity falls as opponents are added', () => {
    const any = expandRange(parseRange('random')).map((c) => ({ cards: c.cards, weight: 1 }));
    const e1 = multiEquityVsRanges(P('As Ah'), [any], [], { iterations: 20_000, seed: 1 }).equity;
    const e3 = multiEquityVsRanges(P('As Ah'), [any, any, any], [], { iterations: 20_000, seed: 1 }).equity;
    expect(e1).toBeGreaterThan(0.83);
    expect(e3).toBeLessThan(e1 - 0.1);
  });
});
