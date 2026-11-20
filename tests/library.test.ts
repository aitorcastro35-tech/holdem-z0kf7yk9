import { describe, it, expect } from 'vitest';
import { LIBRARY_RAW, toSpot } from '../src/scenarios/library';
import { spotEquity, staticNumbers, gradeByEquity, isStrongDraw, villainCombos } from '../src/scenarios/compute';
import { features } from '../src/engine/handclass';
import { CHARTS, chartAction } from '../src/data/charts';
import { classOfCards } from '../src/engine/range';
import { generateRfiSpot, generateVsOpenSpot, generateMathSpot, newRng } from '../src/scenarios/generators';
import { equityVsCombos } from '../src/engine/equity';
import { DEFAULT_SETTINGS } from '../src/store/settings';
import { requiredEquity } from '../src/engine/odds';

const PLACEHOLDERS = /\{(equity|required|outs|clean|next|byRiver|combos|ev|spr|mdf|alpha:\d+)\}/g;

describe('scenario library', () => {
  it('has at least 40 hand-authored spots with unique ids', () => {
    expect(LIBRARY_RAW.length).toBeGreaterThanOrEqual(40);
    expect(new Set(LIBRARY_RAW.map((s) => s.id)).size).toBe(LIBRARY_RAW.length);
  });

  describe.each(LIBRARY_RAW.map((s) => [s.id, s] as const))('%s', (_id, ls) => {
    const spot = toSpot(ls);
    const n = staticNumbers(spot);
    const eq = spotEquity(spot);

    it('inputs are valid', () => {
      const cards = [...spot.hero, ...spot.board];
      expect(new Set(cards).size).toBe(cards.length);
      expect(spot.hero.length).toBe(2);
      expect([0, 3, 4, 5]).toContain(spot.board.length);
      const keys = spot.options.map((o) => o.key);
      if (ls.best) expect(keys).toContain(ls.best);
      for (const k of ls.ok ?? []) expect(keys).toContain(k);
      if (spot.villain) expect(villainCombos(spot.villain, spot.hero, spot.board).length).toBeGreaterThan(0);
      expect(ls.why.length).toBeGreaterThanOrEqual(2);
      expect(ls.concepts.length).toBeGreaterThan(0);
      expect(ls.sources.length).toBeGreaterThan(0);
    });

    it('stored claims match the engine', () => {
      const c = ls.claims ?? {};
      if (eq) expect(Math.abs((c.equity ?? -1) - eq.equity)).toBeLessThan(eq.exact ? 1e-4 : 2e-3);
      else expect(c.equity).toBeUndefined();
      if (n.requiredEquity !== undefined) expect(c.required).toBeCloseTo(n.requiredEquity, 4);
      if (n.outs) expect(c.outs).toBe(n.outs.all.length);
      else expect(c.outs).toBeUndefined();
      if (n.villainCombos !== undefined) expect(c.villainCombos).toBeCloseTo(n.villainCombos, 2);
    });

    it('explanation placeholders can be filled', () => {
      for (const line of ls.why) {
        for (const m of line.matchAll(PLACEHOLDERS)) {
          const k = m[1];
          if (k === 'equity') expect(eq, `${k} needs a villain range`).not.toBeNull();
          if (k === 'required' || k === 'ev') expect(spot.toCall).toBeGreaterThan(0);
          if (['outs', 'clean', 'next'].includes(k)) expect(n.outs, `${k} needs draw outs`).toBeDefined();
          if (k === 'byRiver') expect(n.outs?.byRiver).toBeDefined();
        }
        expect(line.replace(PLACEHOLDERS, '')).not.toMatch(/\{[a-z]/);
      }
    });

    it('grade is consistent with the numbers', () => {
      if (ls.basis === 'equity') {
        expect(eq).not.toBeNull();
        expect(ls.best).toBeUndefined(); // graded by the engine at runtime
        const f = features(spot.hero, spot.board);
        const g = gradeByEquity(eq!.equity, n.requiredEquity!, { options: spot.options, strongDraw: isStrongDraw(f, spot.board), street: spot.street });
        expect(g.best).toBeTruthy();
      } else if (ls.basis === 'chart') {
        const chart = CHARTS.find((c) => c.id === ls.chart)!;
        expect(chart).toBeDefined();
        const a = chartAction(chart, classOfCards(spot.hero[0], spot.hero[1]));
        const bestKind = spot.options.find((o) => o.key === ls.best)!.kind;
        const expected = a === 'fold' ? 'fold' : a === 'call' || a === 'limp' ? 'call' : 'raise';
        if (chart.mixedActions && a !== 'fold') expect(['raise', 'call']).toContain(bestKind);
        else expect(bestKind).toBe(expected);
      } else if (spot.mode === 'B' && eq && n.requiredEquity !== undefined) {
        const bestKind = spot.options.find((o) => o.key === ls.best)!.kind;
        if (bestKind === 'fold') expect(eq.equity).toBeLessThan(n.requiredEquity + 0.03);
        if (bestKind === 'call' && !ls.impliedOdds) expect(eq.equity).toBeGreaterThan(n.requiredEquity - 0.03);
      }
    });
  });
});

describe('procedural generators', () => {
  it('RFI spots are graded against the chart (both table sizes)', () => {
    for (const tableSize of [6, 9] as const) {
      const rng = newRng(42 + tableSize);
      for (let i = 0; i < 200; i++) {
        const s = generateRfiSpot(rng, { ...DEFAULT_SETTINGS, tableSize, difficulty: 'hard' });
        const chart = CHARTS.find((c) => c.id === s.chartId)!;
        const a = chartAction(chart, classOfCards(s.hero[0], s.hero[1]));
        if (a === 'fold') expect(s.grades.fold).toBe('best');
        else {
          expect(s.grades.fold ?? 'mistake').toBe('mistake');
          expect(s.options.filter((o) => o.kind === 'raise').every((o) => s.grades[o.key] === 'best' || s.grades[o.key] === 'ok')).toBe(true);
        }
      }
    }
  });
  it('vs-open spots: price and grades follow the chart', () => {
    const rng = newRng(7);
    for (let i = 0; i < 100; i++) {
      const s = generateVsOpenSpot(rng, DEFAULT_SETTINGS);
      const chart = CHARTS.find((c) => c.id === s.chartId)!;
      const a = chartAction(chart, classOfCards(s.hero[0], s.hero[1]));
      expect(s.grades[s.best]).toMatch(/best|ok/);
      if (a === 'fold') expect(s.best).toBe('fold');
      expect(requiredEquity(s.toCall, s.pot + s.toCall)).toBeGreaterThan(0.2);
    }
  });
  it('math spots: grade matches equity vs required equity', async () => {
    const rng = newRng(99);
    for (let i = 0; i < 12; i++) {
      const s = await generateMathSpot(rng, { ...DEFAULT_SETTINGS, difficulty: 'hard' }, async (h, combos, b) => equityVsCombos(h, combos, b, { seed: 1 }));
      const eq = equityVsCombos(s.hero, villainCombos(s.villain!, s.hero, s.board), s.board, { seed: 1 }).equity;
      const req = requiredEquity(s.toCall, s.pot + s.toCall);
      if (eq - req >= 0.03) expect(s.grades.fold).toBe('mistake');
      if (eq - req <= -0.03) expect(s.grades.call).toBe('mistake');
      if (Math.abs(eq - req) < 0.03) expect(s.grades.call).toBe('ok');
      expect(s.why.join(' ')).toContain((req * 100).toFixed(1));
    }
  }, 120_000);
});
