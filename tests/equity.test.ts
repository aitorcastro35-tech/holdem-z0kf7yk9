import { describe, it, expect } from 'vitest';
import { parseCards } from '../src/engine/cards';
import { equityVsHand, equityVsRange } from '../src/engine/equity';
import { parseRange } from '../src/engine/range';

// Expected values: DeucesCracked, "Preflop Poker Equity Matchups: 25 Exact Calculations" (Oct 12, 2026),
// exhaustive enumeration of all 1,712,304 boards with the exact cards listed there.
// https://www.deucescracked.com/blog/preflop-poker-equity-matchups-exact-data — see SOURCES.md.
// Columns: [hero, villain, hero win %, villain win %, tie %] (published to 2 decimals).
const PUBLISHED: [string, string, number, number, number][] = [
  ['Ah As', 'Kd Kc', 81.06, 18.55, 0.38],
  ['Ah As', 'Kh Ks', 82.36, 17.09, 0.54],
  ['Qh Qs', 'Jd Jc', 81.1, 18.54, 0.36],
  ['Ah As', 'Ad Kd', 87.23, 11.51, 1.26],
  ['Ah As', 'Ad Kc', 91.95, 6.8, 1.25],
  ['Kh Ks', 'Ad Kc', 69.61, 29.6, 0.79],
  ['Ah Kc', 'Ad Qc', 72.35, 22.97, 4.68],
  ['Qh Qs', 'Ad Kd', 53.59, 46.02, 0.39],
  ['Qh Qs', 'Ad Kc', 56.99, 42.66, 0.34],
  ['2h 2s', 'Ad Kc', 52.75, 46.67, 0.58],
  ['2h 2s', 'Ad Kd', 49.6, 49.77, 0.63],
  ['Ah As', '7d 2c', 87.24, 12.4, 0.36],
  ['Jh Th', 'Ad Kc', 40.97, 58.61, 0.42],
  ['9h 9s', '8d 7d', 80.77, 18.64, 0.58],
];

describe('preflop hand vs hand (exhaustive) matches published exact values', () => {
  it.each(PUBLISHED)('%s vs %s', (h, v, win, lose, tie) => {
    const r = equityVsHand(parseCards(h), parseCards(v));
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(1712304);
    expect(r.win * 100).toBeCloseTo(win, 1);
    expect(r.lose * 100).toBeCloseTo(lose, 1);
    expect(r.tie * 100).toBeCloseTo(tie, 1);
  });
});

describe('postflop equity', () => {
  it('river: exact single outcome', () => {
    const r = equityVsHand(parseCards('Ah Kh'), parseCards('Qs Qd'), parseCards('As 7c 2d 9h 3s'));
    expect(r.equity).toBe(1);
  });
  it('turn: nut flush draw vs a set wins on exactly 7 of 44 rivers', () => {
    const r = equityVsHand(parseCards('Ah Kh'), parseCards('Qs Qd'), parseCards('Qh 7h 2c 9s'));
    // Hearts left: 13 - 4 seen (Ah Kh Qh 7h) = 9; any heart that pairs the board (9h, 2h) gives QQQ a full house.
    // Winning hearts: 3h 4h 5h 6h 8h Th Jh = 7 of 44.
    expect(r.exact).toBe(true);
    expect(r.equity).toBeCloseTo(7 / 44, 10);
  });
  it('equity vs range uses blockers and is exact on the flop for small ranges', () => {
    const r = equityVsRange(parseCards('As Ad'), parseRange('KK, QQ'), parseCards('Kh 7c 2d'));
    // KK: only 3 combos remain (Kh on board). QQ: 6 combos. Weighted.
    expect(r.combos).toBe(9);
    expect(r.exact).toBe(true);
  });
  it('Monte Carlo AA vs random is within 0.5% of exhaustive-per-class reference', () => {
    // AA vs a random hand: exact value 85.204% from a one-off full enumeration with this engine
    // (1,225 villain combos × 1,712,304 boards = 2,097,572,400 matchups, ~4 min). Poker Skill states "about 85%".
    const r = equityVsRange(parseCards('As Ah'), parseRange('random'), [], { seed: 7, iterations: 100_000 });
    expect(r.exact).toBe(false);
    expect(Math.abs(r.equity - 0.85204)).toBeLessThan(0.005);
  });
});
