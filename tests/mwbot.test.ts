import { describe, it, expect } from 'vitest';
import { newMWHand, mwAct, mwLegal, positionsFor, type MWConfig, type MWState } from '../src/engine/multiway';
import { mwBotView, mwBotDecide, STYLES, valueThreshold, bluffFactor, fairShare, type MultiEqFn } from '../src/bot/mwbot';
import { multiEquityVsRanges } from '../src/engine/multiequity';
import { parseCards } from '../src/engine/cards';

const eqFn: MultiEqFn = async (h, r, b, seed) => {
  const m = multiEquityVsRanges(h, r, b, { iterations: 2500, seed, timeBudgetMs: 250 });
  return { win: m.equity, tie: 0, lose: 1 - m.equity, equity: m.equity, exact: false, samples: m.samples, combos: 0 };
};

describe('multiway bot: documented thresholds', () => {
  it('value threshold rises relative to the fair share; bluffs halve per extra opponent', () => {
    expect(valueThreshold(1)).toBeCloseTo(0.75, 10);
    expect(valueThreshold(2)).toBeCloseTo((1 / 3) * 1.65, 10);
    expect(valueThreshold(5)).toBeCloseTo((1 / 6) * 2.1, 10);
    for (let k = 1; k < 5; k++) expect(valueThreshold(k + 1) / fairShare(k + 1)).toBeGreaterThan(valueThreshold(k) / fairShare(k));
    expect(bluffFactor(3)).toBe(0.25);
  });
});

describe('multiway bot information rule (extended test)', () => {
  it("changing any other player's hidden cards or the future board never changes a bot's decision", async () => {
    const botCards = parseCards('Ah Qd');
    const flop = parseCards('Kc 7d 2s');
    const variants: { holes: string[]; future: string }[] = [
      { holes: ['Ks Kh', '7c 7h', '3h 3s'], future: '9h 4c' },
      { holes: ['Js Ts', '5c 5d', '8h 6h'], future: '5h 6s' },
      { holes: ['2c 2d', 'Jh Jd', 'Ac Kd'], future: 'Th Ts' },
    ];
    for (const style of Object.values(STYLES)) {
      const out: string[] = [];
      for (const v of variants) {
        // 4 players: CO (bot under test = seat 0), BTN, SB, BB
        const cfg: MWConfig = { seed: 42, positions: positionsFor(4), stacks: [100, 100, 100, 100], holes: [botCards, ...v.holes.map(parseCards)], board: [...flop, ...parseCards(v.future)] };
        let st = newMWHand(cfg);
        st = mwAct(st, 'raise', 2.5); // CO (seat 0) opens
        st = mwAct(st, 'call'); // BTN calls
        st = mwAct(st, 'fold'); // SB
        st = mwAct(st, 'call'); // BB calls → flop; BB checks
        st = mwAct(st, 'check');
        expect(st.toAct).toBe(0);
        const view = mwBotView(st, 0, 0);
        for (const h of v.holes) expect(JSON.stringify(view)).not.toContain(JSON.stringify(parseCards(h)));
        const d = await mwBotDecide(view, style, 77, eqFn);
        out.push(`${d.type}:${d.to ?? ''}:${d.log.rule}:${d.log.equity?.toFixed(6)}`);
      }
      expect(new Set(out).size).toBe(1);
    }
  });
});

describe('multiway bot: legal play and speed', () => {
  it('plays legal actions in 2–6 player hands; each decision within the time budget', async () => {
    const styles = Object.values(STYLES);
    let maxMs = 0;
    let decisions = 0;
    for (let n = 0; n < 40; n++) {
      const players = 2 + (n % 5);
      let st: MWState = newMWHand({ seed: n, positions: positionsFor(players), stacks: Array.from({ length: players }, (_, i) => [20, 50, 100, 200][(n + i) % 4]) });
      const idx = Array(players).fill(0);
      let steps = 0;
      while (!st.over) {
        const s = st.toAct!;
        const t0 = Date.now();
        const d = await mwBotDecide(mwBotView(st, s, idx[s]++), styles[(n + s) % 3], n, eqFn, { actionTable: n % 2 === 0 });
        maxMs = Math.max(maxMs, Date.now() - t0);
        decisions++;
        const L = mwLegal(st);
        if (d.type === 'fold') expect(L.fold).toBe(true);
        if (d.type === 'check') expect(L.check).toBe(true);
        st = mwAct(st, d.type, d.to);
        if (++steps > 80) throw new Error('too long');
      }
    }
    expect(decisions).toBeGreaterThan(100);
    expect(maxMs).toBeLessThan(600); // budget 250ms of Monte Carlo + range estimation; generous for CI machines
  }, 300_000);
});
