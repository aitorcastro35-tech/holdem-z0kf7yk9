import { describe, it, expect } from 'vitest';
import { comboEV, computeGrid, splitResponse, summarize, type ExplorerInput } from '../src/explorer/core';
import { parseCards } from '../src/engine/cards';
import { classCombos, parseRange, expandRange } from '../src/engine/range';

const C = (s: string) => parseCards(s) as [number, number];
const stub = (eq: number) => () => eq;
const base: Omit<ExplorerInput, 'spot'> = {
  villainCombos: [],
  board: [],
  potBefore: 0,
  heroPosted: 0,
  toCall: 0,
  heroBehind: 100,
  villainBehind: 100,
  response: { mode: 'fold-pct', foldPct: 0, continuePct: 1, reraisePct: 0 },
  realization: 1,
  raiseRealization: 1,
};

describe('Range Explorer EV formulas (hand-calculated)', () => {
  it('calling an all-in: EV = equity × final pot − call', () => {
    // Villain shoves 10bb total; you are BB (1 posted); SB folded (0.5 dead). Pot before = 10 + 1 + 0.5 = 11.5.
    // You call 9: final pot 20.5. With 60% equity: 0.6 × 20.5 − 9 = 3.3.
    const inp: ExplorerInput = { ...base, spot: 'allin-call', villainCombos: [{ cards: C('Kd Kc'), w: 1 }], potBefore: 11.5, heroPosted: 1, toCall: 9, heroBehind: 99, villainBehind: 0 };
    expect(comboEV(C('As Ah'), inp, stub(0.6)).ev.call).toBeCloseTo(3.3, 10);
  });
  it('calling an all-in for less than the shove returns the excess before computing the pot', () => {
    // Villain shoves 50 total; you have 20 behind (BB posted 1, 21 total). Pot before 50 + 1 + 0.5 = 51.5.
    // You call 20 (all-in); villain's uncalled 29 returns: final pot 51.5 − 29 + 20 = 42.5. EV = 0.5 × 42.5 − 20 = 1.25.
    const inp: ExplorerInput = { ...base, spot: 'allin-call', villainCombos: [{ cards: C('Kd Kc'), w: 1 }], potBefore: 51.5, heroPosted: 1, toCall: 49, heroBehind: 20, villainBehind: 0 };
    expect(comboEV(C('As Ah'), inp, stub(0.5)).ev.call).toBeCloseTo(1.25, 10);
  });
  it('push-fold: EV = P(fold)·pot + P(call)·(equity × final pot − invested)', () => {
    // SB shoves 10bb (posted 0.5, 9.5 behind) vs BB (posted 1, 9 behind). Pot now 1.5.
    // Villain range: 10 combos, 3 call → P(call) 0.3. Equity when called 0.4.
    // Final pot = 1.5 − 0.5 − 1 + 2 × 10 = 20; invested 9.5. EV = 0.7 × 1.5 + 0.3 × (0.4 × 20 − 9.5) = 1.05 − 0.45 = 0.6.
    const all = expandRange(parseRange('KK, QQ')).slice(0, 10).map((c) => ({ cards: c.cards, w: 1 }));
    const callers = all.slice(0, 3);
    const hero = C('7s 2d');
    const inp: ExplorerInput = { ...base, spot: 'push-fold', villainCombos: all, callCombos: callers, potBefore: 1.5, heroPosted: 0.5, heroBehind: 9.5, villainBehind: 9, villainPosted: 1 };
    const r = comboEV(hero, inp, stub(0.4));
    expect(r.foldPct).toBeCloseTo(0.7, 10);
    expect(r.ev.shove).toBeCloseTo(0.6, 10);
    expect(r.breakEvenFold).toBeCloseTo(9.5 / (9.5 + 1.5), 10);
  });
  it('3-bet: EV = F·pot + C·(R·eq·final pot − add) − 4bet share × add', () => {
    // CO opens to 2.5; you're BTN; pot before = 2.5 + 1.5 dead = 4. You 3-bet to 7.5 (add 7.5).
    // Villain folds 50%, calls 37.5%, 4-bets 12.5% (fold-pct 0.5, re-raise 25% of continuing).
    // If called: final pot = 4 + 7.5 + 5 = 16.5; equity 0.45, realization 1.
    // EV = 0.5×4 + 0.375×(0.45×16.5 − 7.5) + 0.125×(−7.5) = 2 + 0.375×(−0.075) − 0.9375 = 1.034375
    const inp: ExplorerInput = {
      ...base,
      spot: 'vs-raise',
      villainCombos: [{ cards: C('Kd Qc'), w: 1 }],
      potBefore: 4,
      toCall: 2.5,
      heroBehind: 100,
      villainBehind: 97.5,
      raiseTo: 7.5,
      heroCommitted: 0,
      villainCommitted: 2.5,
      response: { mode: 'fold-pct', foldPct: 0.5, continuePct: 0, reraisePct: 0.25 },
    };
    const r = comboEV(C('As Jh'), inp, stub(0.45));
    expect(r.ev.raise).toBeCloseTo(1.034375, 10);
    expect(r.breakEvenFold).toBeCloseTo(7.5 / 11.5, 10);
    expect(r.ev.call).toBeCloseTo(0.45 * (4 + 2.5) - 2.5, 10);
  });
  it('realization multiplies equity only for calls that see more streets', () => {
    const inp: ExplorerInput = { ...base, spot: 'vs-raise', villainCombos: [{ cards: C('Kd Qc'), w: 1 }], potBefore: 4, toCall: 2.5, realization: 0.8 };
    expect(comboEV(C('As Jh'), inp, stub(0.5)).ev.call).toBeCloseTo(0.8 * 0.5 * 6.5 - 2.5, 10);
  });
});

describe('card removal and combo counting', () => {
  it('your hand blocks villain combos (AA vs a range of AK + KK)', () => {
    const vill = expandRange(parseRange('AKo, KK')).map((c) => ({ cards: c.cards, w: 1 }));
    // holding As Ah: AKo combos with an ace left = 2 aces × 4 kings − suited = 6; KK = 6 → 12 combos remain
    let seen = 0;
    comboEV(C('As Ah'), { ...base, spot: 'allin-call', villainCombos: vill, potBefore: 10, toCall: 5 }, (_h, v) => {
      seen++;
      expect(v.includes(parseCards('As')[0]) || v.includes(parseCards('Ah')[0])).toBe(false);
      return 0.5;
    });
    expect(seen).toBe(6 + 6);
  });
  it('a grid cell averages its available combos (6 / 4 / 12, fewer with a board or exact villain hand)', () => {
    const vill = [{ cards: C('Kd Kc'), w: 1 }];
    const cells = computeGrid({ ...base, spot: 'allin-call', villainCombos: vill, potBefore: 10, toCall: 5 }, stub(0.5));
    const get = (c: string) => cells.find((x) => x.cls === c)!;
    expect(get('AA').combos).toBe(6);
    expect(get('AKs').combos).toBe(2); // Kd, Kc used by villain → AKs with Ks or Kh only
    expect(get('AKo').combos).toBe(6);
    expect(get('KK').combos).toBe(1);
    expect(classCombos('AKo').length).toBe(12);
  });
  it('summary percentages are by combos and sum to 100%', () => {
    const cells = computeGrid({ ...base, spot: 'allin-call', villainCombos: [{ cards: C('Kd Kc'), w: 1 }], potBefore: 10, toCall: 5 }, (h) => (h[0] >> 2 === 12 ? 0.8 : 0.2));
    const s = summarize(cells);
    const total = Object.values(s.pct).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBeCloseTo(1, 10);
    expect(s.totalCombos).toBe(1225); // 1,326 minus combos using Kd or Kc (101)
  });
});

describe('response model', () => {
  it('top-N continues with the strongest part of the range by weight', () => {
    const vill = expandRange(parseRange('AA, 72o')).map((c) => ({ cards: c.cards, w: 1 })); // 6 + 12 combos
    const r = splitResponse(vill, [], { mode: 'top-n', foldPct: 0, continuePct: 6 / 18, reraisePct: 0 });
    expect(r.foldP).toBeCloseTo(12 / 18, 10);
    expect(r.callers.every((c) => c.cards[0] >> 2 === 12)).toBe(true);
  });
});
