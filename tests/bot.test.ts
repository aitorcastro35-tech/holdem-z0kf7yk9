import { describe, it, expect } from 'vitest';
import { newHand, act, legalActions, type HUConfig } from '../src/engine/headsup';
import { botView, botDecide, STYLES, type EqFn } from '../src/bot/bot';
import { estimateRange, topPct, totalWeight } from '../src/bot/ranges';
import { equityVsCombos } from '../src/engine/equity';
import { parseCards } from '../src/engine/cards';
import { classOfCards } from '../src/engine/range';
import { findChart, chartAction } from '../src/data/charts';

const eqFn: EqFn = async (h, c, b, seed) => equityVsCombos(h, c.map((x) => ({ ...x, cls: '' })), b, { seed, iterations: 3000, mode: 'mc' });

describe('bot information hiding (brief §1.4)', () => {
  it('same bot cards + same public state, different hero cards and future board → identical decisions', async () => {
    const botCards = parseCards('Ah Qd');
    const flop = parseCards('Kc 7d 2s');
    for (const style of Object.values(STYLES)) {
      for (const heroCards of [parseCards('Ks Kh'), parseCards('7c 2c'), parseCards('Js Ts'), parseCards('3h 3s')]) {
        // two different full deals that agree on everything public + the bot's cards
        const decisions: string[] = [];
        for (const fut of [parseCards('9h 4c'), parseCards('5h 6h')]) {
          if ([...heroCards, ...fut].some((c) => botCards.includes(c) || flop.includes(c))) continue;
          const cfg: HUConfig = { seed: 99, tableSize: 6, positions: ['CO', 'BB'], stacks: [100, 100], holes: [heroCards, botCards], board: [...flop, ...fut] };
          let st = newHand(cfg);
          st = act(st, 'raise', 2.5); // hero (CO) opens
          st = act(st, 'call'); // bot (BB) calls  → flop, bot acts first
          const v = botView(st, 1, 0);
          expect(JSON.stringify(v)).not.toContain(JSON.stringify(heroCards));
          const d = await botDecide(v, style, 1234, eqFn);
          decisions.push(`${d.type}:${d.to ?? ''}:${d.log.rule}`);
        }
        expect(new Set(decisions).size).toBe(1);
      }
    }
  });
  it('the bot view never contains hero hole cards or undealt board cards', () => {
    const cfg: HUConfig = { seed: 5, tableSize: 6, positions: ['BTN', 'BB'], stacks: [100, 100], holes: [parseCards('As Ks'), parseCards('2c 7d')], board: parseCards('Qh Jh Th 9h 8h') };
    let st = newHand(cfg);
    st = act(st, 'raise', 2.5);
    st = act(st, 'call');
    const v = botView(st, 1, 0);
    const keys = JSON.stringify(v);
    expect(v.board).toEqual(parseCards('Qh Jh Th'));
    expect(v.myCards).toEqual(parseCards('2c 7d'));
    expect(keys).not.toMatch(/holes|boardAll/);
  });
  it('estimated ranges use only public info: same history → same estimate regardless of the estimated player’s cards', () => {
    const base: HUConfig = { seed: 3, tableSize: 6, positions: ['CO', 'BB'], stacks: [100, 100], board: parseCards('Kc 7d 2s 9h 4c') };
    const a = act(act(newHand({ ...base, holes: [parseCards('As Ad'), parseCards('Qc Jc')] }), 'raise', 2.5), 'call');
    const b = act(act(newHand({ ...base, holes: [parseCards('6s 5s'), parseCards('Qc Jc')] }), 'raise', 2.5), 'call');
    const ra = estimateRange(a.cfg, 0, a.history, a.board, a.holes[1]);
    const rb = estimateRange(b.cfg, 0, b.history, b.board, b.holes[1]);
    expect(totalWeight(ra)).toBeCloseTo(totalWeight(rb), 9);
  });
});

describe('bot preflop follows the cited charts (solid style)', () => {
  it('first-in decisions match the RFI chart', async () => {
    const chart = findChart('rfi', 6, 'CO')!;
    for (const hand of ['As Ks', '7c 2d', 'Kd 3d', 'Qs 6s', '3c 3d', 'Jh Td', '9c 7c', 'Ah 8d']) {
      const cards = parseCards(hand);
      const st = newHand({ seed: 1, tableSize: 6, positions: ['BB', 'CO'], stacks: [100, 100], holes: [undefined, cards] });
      expect(st.toAct).toBe(1); // CO acts first
      const d = await botDecide(botView(st, 1, 0), STYLES.solid, 1, eqFn);
      const inRange = chartAction(chart, classOfCards(cards[0], cards[1])) !== 'fold';
      expect(d.type).toBe(inRange ? 'raise' : 'fold');
    }
  });
  it('BB vs BTN open: defends the chart range, folds the rest', async () => {
    for (const [hand, defend] of [['Kd 9c', true], ['Jc 5h', false], ['6s 4s', true], ['6s 3s', false]] as const) {
      let st = newHand({ seed: 1, tableSize: 6, positions: ['BTN', 'BB'], stacks: [100, 100], holes: [undefined, parseCards(hand)] });
      st = act(st, 'raise', 2.5);
      const d = await botDecide(botView(st, 1, 0), STYLES.solid, 1, eqFn);
      expect(d.type === 'fold').toBe(!defend);
    }
  });
});

describe('bot plays only legal actions', () => {
  it('300 bot-vs-bot hands across styles and stack depths end legally', async () => {
    const styles = Object.values(STYLES);
    for (let n = 0; n < 300; n++) {
      const tableSize = n % 4 === 0 ? 2 : n % 4 === 1 ? 9 : 6;
      const positions: [string, string] = tableSize === 2 ? ['BTN', 'BB'] : tableSize === 9 ? ['MP', 'BB'] : (['CO', 'BB'] as [string, string]);
      let st = newHand({ seed: n, tableSize, positions, stacks: [[20, 50, 100, 200][n % 4], 100], ante: 0 });
      const idx = [0, 0];
      let steps = 0;
      while (!st.over) {
        const seat = st.toAct!;
        const d = await botDecide(botView(st, seat, idx[seat]++), styles[(n + seat) % 3], n, eqFn);
        const L = legalActions(st);
        if (d.type === 'fold') expect(L.fold).toBe(true);
        if (d.type === 'check') expect(L.check).toBe(true);
        st = act(st, d.type, d.to);
        if (++steps > 60) throw new Error('too long');
      }
    }
  }, 300_000);
  it('topPct is nested and sized by combos', () => {
    const a = topPct(0.05);
    const b = topPct(0.15);
    for (const c of a) expect(b.has(c)).toBe(true);
  });
});
