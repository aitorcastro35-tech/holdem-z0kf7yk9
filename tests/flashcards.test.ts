import { describe, it, expect } from 'vitest';
import { buildDeck, percentChoices, checkTyped } from '../src/features/flashcards/deck';
import { nextCardState, streak, dayKey } from '../src/store/progress';

const deck = buildDeck();
const byId = (id: string) => deck.find((c) => c.id === id)!;
const val = (id: string) => {
  const a = byId(id).answer;
  if (a.type === 'choice') throw new Error('choice');
  return a.value;
};

// §4.5 examples from the spec; published cross-checks in tests/odds.test.ts (Wizard of Odds, Wikipedia).
describe('flashcard values (all computed by the engine)', () => {
  it('flush draw ≈ 35% by river, ≈ 19% on the turn', () => {
    expect(val('outs-fr-9')).toBeCloseTo(34.97, 2);
    expect(val('outs-ft-9')).toBeCloseTo(19.15, 2);
  });
  it('OESD ≈ 31.5%, gutshot ≈ 16.5%', () => {
    expect(val('outs-fr-8')).toBeCloseTo(31.45, 2);
    expect(val('outs-fr-4')).toBeCloseTo(16.47, 2);
  });
  it('set ≈ 11.8%, pair a hole card ≈ 32.4%', () => {
    expect(val('pf-set')).toBeCloseTo(11.76, 2);
    expect(val('pf-pair-flop')).toBeCloseTo(32.43, 2);
  });
  it('pocket pair ≈ 5.9%, AA ≈ 0.45%', () => {
    expect(val('pf-pair')).toBeCloseTo(5.88, 2);
    expect(val('pf-aa')).toBeCloseTo(100 / 221, 6);
  });
  it('flush draw on flop ≈ 10.9%, made flush ≈ 0.84%', () => {
    expect(val('pf-fd')).toBeCloseTo(10.94, 2);
    expect(val('pf-flush')).toBeCloseTo(0.84, 2);
  });
  it('half-pot → 25%, pot → 33.3%', () => {
    expect(val('price-req-0.500')).toBeCloseTo(25, 6);
    expect(val('price-req-1.000')).toBeCloseTo(100 / 3, 6);
  });
  it('combos: 6 / 4 / 12 / 1326 / 169', () => {
    expect(val('combo-pair')).toBe(6);
    expect(val('combo-suited')).toBe(4);
    expect(val('combo-offsuit')).toBe(12);
    expect(val('combo-total')).toBe(1326);
    expect(val('combo-classes')).toBe(169);
    expect(val('combo-aa-1a')).toBe(3);
    expect(val('combo-ak-1a')).toBe(12);
    expect(val('combo-aks-ah')).toBe(3);
    expect(val('combo-kq-blk')).toBe(9);
    expect(val('combo-jj-board')).toBe(1);
  });
  it('chart quiz answers match the charts', async () => {
    const { CHARTS, chartAction } = await import('../src/data/charts');
    const quiz = deck.filter((c) => c.topic === 'charts');
    expect(quiz.length).toBeGreaterThan(80);
    for (const c of quiz) {
      const [, , ...rest] = c.id.split('-');
      const cls = rest[rest.length - 1];
      const chart = CHARTS.find((ch) => c.id === `chart-${ch.id}-${cls}`)!;
      expect(chart, c.id).toBeDefined();
      const a = chartAction(chart, cls);
      if (c.answer.type !== 'choice') throw new Error('choice expected');
      const ans = c.answer.options[c.answer.correct];
      expect(c.answer.correct).toBeGreaterThanOrEqual(0);
      if (a === 'fold') expect(ans).toBe('Fold');
      else expect(ans).not.toBe('Fold');
    }
  });
  it('outs cards cover 13 out counts', () => {
    expect(deck.filter((c) => c.id.startsWith('outs-fr-')).length).toBe(13);
  });
  it('ids are unique', () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
  });
});

describe('answer checking', () => {
  it('typed answers use tolerance', () => {
    expect(checkTyped(byId('outs-fr-9'), '35')).toBe(true);
    expect(checkTyped(byId('outs-fr-9'), '35%')).toBe(true);
    expect(checkTyped(byId('outs-fr-9'), '30')).toBe(false);
    expect(checkTyped(byId('combo-ak'), '16')).toBe(true);
  });
  it('multiple choice includes the correct value once and 4 options', () => {
    for (const c of deck.filter((c) => c.answer.type === 'percent')) {
      const { options, correct } = percentChoices(c);
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(correct).toBeGreaterThanOrEqual(0);
      expect(new Set(options).size).toBe(options.length);
    }
  });
});

describe('Leitner + streak', () => {
  it('correct answers promote, wrong answers demote to box 1', () => {
    const now = 1_000_000;
    let s = nextCardState(undefined, true, now);
    expect(s.box).toBe(2);
    s = nextCardState(s, true, now);
    expect(s.box).toBe(3);
    expect(s.due).toBe(now + 3 * 86_400_000);
    s = nextCardState(s, false, now);
    expect(s.box).toBe(1);
  });
  it('streak counts consecutive days, tolerating not-yet-played today', () => {
    const now = new Date(2026, 10, 19, 12).getTime();
    const d = (k: number) => dayKey(now - k * 86_400_000);
    expect(streak([d(0), d(1), d(2)], now)).toBe(3);
    expect(streak([d(1), d(2)], now)).toBe(2);
    expect(streak([d(0), d(2)], now)).toBe(1);
    expect(streak([], now)).toBe(0);
  });
});
