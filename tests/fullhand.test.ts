import { describe, it, expect } from 'vitest';
import { startHand, advance, prepareDecision, heroAct, strength, gradeCheckedTo, boardNow, P_BET, P_CALL, P_VS_RAISE, type Template } from '../src/scenarios/fullhand';
import { newRng } from '../src/scenarios/generators';
import { equityVsCombos } from '../src/engine/equity';
import { parseCards } from '../src/engine/cards';
import { DEFAULT_SETTINGS } from '../src/store/settings';

const syncEq = async (h: number[], c: { cards: [number, number]; weight: number }[], b: number[]) => equityVsCombos(h, c.map((x) => ({ ...x, cls: '' })), b, { seed: 3, iterations: 20_000 });

describe('full hand: strength classes', () => {
  it('classifies', () => {
    expect(strength(parseCards('Ah Kd'), parseCards('Ks 7c 2d'))).toBe('top');
    expect(strength(parseCards('7h 7d'), parseCards('Ks 7c 2d'))).toBe('strong');
    expect(strength(parseCards('Ah 5h'), parseCards('Kh 9h 2c'))).toBe('draw');
    expect(strength(parseCards('8h 7d'), parseCards('Ks 7c 2d'))).toBe('weak');
    expect(strength(parseCards('Ah Qd'), parseCards('9s 7c 2d'))).toBe('air');
    // paired board: A2 on 7-7-2 is a weak one-pair hand, not "two pair"
    expect(strength(parseCards('Ah 2d'), parseCards('7s 7c 2h'))).toBe('weak');
  });
  it('strategy tables are probabilities', () => {
    for (const t of [P_BET, P_CALL, P_VS_RAISE]) for (const st of Object.values(t)) for (const p of Object.values(st)) expect(p >= 0 && p <= 1).toBe(true);
  });
});

describe('full hand: value-rule grading', () => {
  const opts = [
    { key: 'check', kind: 'check' as const, label: 'Check' },
    { key: 'bet-50', kind: 'bet' as const, amount: 3, label: 'Bet' },
    { key: 'bet-75', kind: 'bet' as const, amount: 4, label: 'Bet' },
  ];
  it('bets for value when ahead of the calling range', () => {
    const g = gradeCheckedTo(0.7, 0.7, { options: opts, strongDraw: false, street: 'river' });
    expect(g.best).toBe('bet-75');
    expect(g.grades.check).toBe('mistake');
  });
  it('checks medium strength; bluffing with showdown value is a mistake', () => {
    const g = gradeCheckedTo(0.55, 0.3, { options: opts, strongDraw: false, street: 'river' });
    expect(g.best).toBe('check');
    expect(g.grades['bet-50']).toBe('mistake');
  });
  it('a medium-strength protection bet is acceptable on the flop but not on the river', () => {
    expect(gradeCheckedTo(0.58, 0.38, { options: opts, strongDraw: false, street: 'flop' }).grades['bet-50']).toBe('ok');
    expect(gradeCheckedTo(0.58, 0.38, { options: opts, strongDraw: false, street: 'river' }).grades['bet-50']).toBe('mistake');
  });
  it('bluffing with no showdown value is acceptable', () => {
    expect(gradeCheckedTo(0.1, 0.05, { options: opts, strongDraw: false, street: 'river' }).grades['bet-50']).toBe('ok');
  });
});

describe('full hand: simulated play', () => {
  it('chips are conserved, villain hand stays in range, every decision graded', async () => {
    const rng = newRng(2026);
    const templates: Template[] = ['random', 'draw', 'top', 'strong', 'weak', 'air'];
    for (let n = 0; n < 60; n++) {
      const h = startHand(rng, DEFAULT_SETTINGS, templates[n % templates.length]);
      const dead = h.pot - 5; // blinds that folded
      expect(new Set([...h.hero, ...h.villain, ...h.board5]).size).toBe(9);
      if (templates[n % 6] !== 'random') expect(strength(h.hero, h.board5.slice(0, 3))).toBe(templates[n % 6]);
      let steps = 0;
      while (true) {
        advance(h, rng);
        if (h.result) break;
        // villain's real hand must still be possible
        const key = h.villain.slice().sort((a, b) => a - b).join();
        const mine = h.range.find((c) => c.cards.slice().sort((a, b) => a - b).join() === key)!;
        expect(mine.w).toBeGreaterThan(0);
        const { spot } = await prepareDecision(h, syncEq);
        expect(spot.board).toEqual(boardNow(h));
        expect(spot.grades[spot.best]).toMatch(/best|ok/);
        const choice = spot.options[Math.floor(rng() * spot.options.length)].key;
        heroAct(h, spot, choice, rng);
        expect(Math.abs(h.pot - (h.heroIn + h.villainIn + dead))).toBeLessThan(0.05);
        expect(h.stack).toBeGreaterThanOrEqual(-0.05);
        if (++steps > 6) throw new Error('more than 6 decisions');
      }
      expect(h.log.length).toBeGreaterThan(0);
      expect(h.log.filter((r) => !r.auto).every((r) => r.grade)).toBe(true);
      // out of position you never get a "bet after he checked" spot
      if (!h.ctx.ip) expect(h.log.some((r) => !r.auto && r.villainAction === 'check')).toBe(false);
      const r = h.result!;
      if (r.winner === 'hero') expect(r.net).toBeGreaterThan(0);
      if (r.winner === 'villain') expect(r.net).toBeLessThan(0);
    }
  }, 120_000);
});

import { generateCheckedToSpot } from '../src/scenarios/fullhand';
describe('checked-to (c-bet / barrel) generator', () => {
  it('produces graded check/bet spots on every street with a consistent pot', async () => {
    const rng = newRng(77);
    for (const st of ['flop', 'turn', 'river'] as const) {
      for (let i = 0; i < 5; i++) {
        const s = await generateCheckedToSpot(rng, DEFAULT_SETTINGS, syncEq, st);
        expect(s.street).toBe(st);
        expect(s.board.length).toBe(st === 'flop' ? 3 : st === 'turn' ? 4 : 5);
        expect(Math.abs(s.pot - 5.5 * 2 ** ['flop', 'turn', 'river'].indexOf(st))).toBeLessThan(0.6); // bets rounded to 0.1bb
        expect(s.options.map((o) => o.kind)).toContain('check');
        expect(s.grades[s.best]).toBe('best');
        expect(new Set([...s.hero, ...s.board]).size).toBe(s.hero.length + s.board.length);
      }
    }
  }, 60_000);
});
