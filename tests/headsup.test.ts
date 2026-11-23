import { describe, it, expect } from 'vitest';
import { newHand, act, legalActions, firstToAct, totalPot, chipsInPlay, dealCards, type HUConfig, type HUState } from '../src/engine/headsup';
import { parseCards, mulberry32 } from '../src/engine/cards';

const cfg = (o: Partial<HUConfig> = {}): HUConfig => ({ seed: 1, tableSize: 6, positions: ['CO', 'BB'], stacks: [100, 100], ...o });

describe('heads-up engine: action order', () => {
  it('ring game CO vs BB: CO first preflop, BB first postflop; dead SB in the pot', () => {
    let s = newHand(cfg());
    expect(s.toAct).toBe(0);
    expect(s.pot).toBe(0.5); // folded SB
    expect(s.committed).toEqual([0, 1]);
    s = act(s, 'raise', 2.5);
    s = act(s, 'call');
    expect(s.street).toBe(1);
    expect(s.board.length).toBe(3);
    expect(totalPot(s)).toBe(5.5);
    expect(s.toAct).toBe(1); // BB acts first postflop
  });
  it('ring game SB vs BB: SB first preflop and first postflop', () => {
    const c = cfg({ positions: ['SB', 'BB'] });
    expect(firstToAct(c, 0)).toBe(0);
    expect(firstToAct(c, 1)).toBe(0);
  });
  it('ring game BTN vs SB: BTN first preflop, SB first postflop; dead BB', () => {
    const c = cfg({ positions: ['BTN', 'SB'] });
    expect(firstToAct(c, 0)).toBe(0);
    expect(firstToAct(c, 2)).toBe(1);
    expect(newHand(c).pot).toBe(1);
  });
  it('2-player game: button posts SB, acts first preflop and last postflop', () => {
    const c = cfg({ tableSize: 2, positions: ['BTN', 'BB'] });
    const s = newHand(c);
    expect(s.committed).toEqual([0.5, 1]);
    expect(s.toAct).toBe(0);
    expect(firstToAct(c, 1)).toBe(1);
    expect(firstToAct(c, 3)).toBe(1);
  });
  it('BB gets the option after a limp', () => {
    let s = newHand(cfg({ positions: ['SB', 'BB'] }));
    s = act(s, 'call'); // complete
    expect(s.street).toBe(0);
    expect(s.toAct).toBe(1);
    expect(legalActions(s).check).toBe(true);
    s = act(s, 'check');
    expect(s.street).toBe(1);
  });
});

describe('heads-up engine: bet sizing rules', () => {
  it('min raise preflop = 2bb, then current bet + last raise size', () => {
    let s = newHand(cfg());
    expect(legalActions(s).raise!.min).toBe(2);
    expect(() => act(s, 'raise', 1.5)).toThrow();
    s = act(s, 'raise', 3); // raise of 2
    expect(legalActions(s).raise!.min).toBe(5);
    s = act(s, 'raise', 9); // re-raise of 6
    expect(legalActions(s).raise!.min).toBe(15);
  });
  it('postflop min bet 1bb; min raise doubles the bet', () => {
    let s = newHand(cfg());
    s = act(s, 'raise', 2.5);
    s = act(s, 'call');
    expect(legalActions(s).bet!.min).toBe(1);
    s = act(s, 'bet', 4);
    expect(legalActions(s).raise!.min).toBe(8);
    s = act(s, 'raise', 10);
    expect(legalActions(s).raise!.min).toBe(16);
  });
  it('short all-in raise: the bettor may only call or fold', () => {
    // CO (seat 0) 100bb, BB (seat 1) 14.5bb. Postflop BB acts first and checks; CO bets 10; BB shoves 12 total (raise of 2 < 10).
    let s = newHand(cfg({ stacks: [100, 14.5] }));
    s = act(s, 'raise', 2.5);
    s = act(s, 'call');
    s = act(s, 'check');
    s = act(s, 'bet', 10);
    s = act(s, 'raise', 12); // all-in, short
    expect(s.history[s.history.length - 1].allIn).toBe(true);
    const L = legalActions(s);
    expect(L.raise).toBeNull();
    expect(L.call).toBe(2);
    expect(L.fold).toBe(true);
  });
});

describe('heads-up engine: all-ins, returns, showdown', () => {
  it('uncalled excess is returned when the caller is all-in for less', () => {
    let s = newHand(cfg({ stacks: [100, 30], positions: ['SB', 'BB'] }));
    s = act(s, 'raise', 100); // SB shoves
    s = act(s, 'call'); // BB calls all-in for 30
    expect(s.over).toBe(true);
    expect(s.result!.returned).toBe(70);
    expect(s.invested).toEqual([30, 30]);
    expect(s.board.length).toBe(5);
    expect(s.result!.net[0] + s.result!.net[1]).toBeCloseTo(0, 6);
  });
  it('uncalled bet is returned on a fold', () => {
    let s = newHand(cfg());
    s = act(s, 'raise', 2.5);
    s = act(s, 'fold');
    expect(s.result!.reason).toBe('fold');
    expect(s.result!.returned).toBe(1.5);
    expect(s.result!.net).toEqual([1.5, -1]); // wins BB's 1 + dead SB 0.5
  });
  it('split pot when the board plays', () => {
    const c = cfg({ positions: ['SB', 'BB'], holes: [parseCards('2s 3d'), parseCards('2h 4c')], board: parseCards('Ac Kd Qh Js Tc') });
    let s = newHand(c);
    s = act(s, 'raise', 100);
    s = act(s, 'call');
    expect(s.result!.winners).toEqual([0, 1]);
    expect(s.result!.net).toEqual([0, 0]);
  });
  it('presets are honored and the deal depends only on the seed', () => {
    const c = cfg({ seed: 42, holes: [parseCards('As Ah'), undefined], board: [undefined, undefined, undefined, parseCards('2c')[0], undefined] });
    const d1 = dealCards(c);
    const d2 = dealCards(c);
    expect(d1).toEqual(d2);
    expect(d1.holes[0]).toEqual(parseCards('As Ah'));
    expect(d1.board[3]).toBe(parseCards('2c')[0]);
    expect(new Set([...d1.holes[0], ...d1.holes[1], ...d1.board]).size).toBe(9);
  });
});

describe('heads-up engine: random play invariants', () => {
  it('2,000 random hands: chips conserved, every hand ends, nets sum to the dead money', () => {
    const rng = mulberry32(7);
    const positions: [string, string][] = [['CO', 'BB'], ['SB', 'BB'], ['BTN', 'SB'], ['UTG', 'BTN']];
    for (let n = 0; n < 2000; n++) {
      const tableSize = n % 5 === 0 ? 2 : 6;
      const pos: [string, string] = tableSize === 2 ? (n % 2 ? ['BTN', 'BB'] : ['BB', 'BTN']) : positions[n % positions.length];
      let s: HUState = newHand({ seed: n, tableSize, positions: pos, stacks: [5 + Math.floor(rng() * 200), 5 + Math.floor(rng() * 200)], ante: n % 3 === 0 ? 0.1 : 0 });
      const start = chipsInPlay(s);
      let steps = 0;
      while (!s.over) {
        const L = legalActions(s);
        const opts: (() => HUState)[] = [];
        if (L.fold) opts.push(() => act(s, 'fold'));
        if (L.check) opts.push(() => act(s, 'check'));
        if (L.call !== null) opts.push(() => act(s, 'call'));
        if (L.bet) opts.push(() => act(s, 'bet', L.bet!.min + rng() * (L.bet!.max - L.bet!.min)));
        if (L.raise) opts.push(() => act(s, 'raise', L.raise!.min + rng() * (L.raise!.max - L.raise!.min)));
        expect(opts.length).toBeGreaterThan(0);
        s = opts[Math.floor(rng() * opts.length)]();
        expect(Math.abs(chipsInPlay(s) - start)).toBeLessThan(0.02);
        expect(s.stack[0]).toBeGreaterThanOrEqual(-1e-9);
        expect(s.stack[1]).toBeGreaterThanOrEqual(-1e-9);
        if (++steps > 200) throw new Error('hand did not end');
      }
      expect(s.result!.net[0] + s.result!.net[1]).toBeCloseTo(s.dead, 1);
    }
  });
});
