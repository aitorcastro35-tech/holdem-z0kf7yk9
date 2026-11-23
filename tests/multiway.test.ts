import { describe, it, expect } from 'vitest';
import { newMWHand, mwAct, mwLegal, actingOrder, positionsFor, buildPots, mwChips, mwTotalPot, currentPots, type MWConfig, type MWState } from '../src/engine/multiway';
import { parseCards, mulberry32 } from '../src/engine/cards';

const cfg = (n: number, o: Partial<MWConfig> = {}): MWConfig => ({ seed: 1, positions: positionsFor(n), stacks: Array(n).fill(100), ...o });
const posOf = (st: MWState, s: number | null) => (s === null ? null : st.cfg.positions[s]);

describe('multiway engine: seats and action order', () => {
  it('removes the earliest positions first', () => {
    expect(positionsFor(6)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(4)).toEqual(['CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(5)).toEqual(['HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(3)).toEqual(['BTN', 'SB', 'BB']);
    expect(positionsFor(2)).toEqual(['BTN', 'BB']);
  });
  it('6 players: UTG first preflop, SB first postflop, folded and all-in players skipped', () => {
    let st = newMWHand(cfg(6, { stacks: [100, 100, 100, 100, 100, 20] }));
    expect(posOf(st, st.toAct)).toBe('UTG');
    st = mwAct(st, 'raise', 2.5); // UTG
    st = mwAct(st, 'fold'); // HJ
    expect(posOf(st, st.toAct)).toBe('CO');
    st = mwAct(st, 'call'); // CO
    st = mwAct(st, 'fold'); // BTN
    st = mwAct(st, 'fold'); // SB
    st = mwAct(st, 'raise', 20); // BB all-in (20bb)
    expect(posOf(st, st.toAct)).toBe('UTG');
    st = mwAct(st, 'call'); // UTG
    st = mwAct(st, 'call'); // CO
    expect(st.street).toBe(1);
    // BB is all-in and SB folded: postflop UTG acts first, then CO
    expect(posOf(st, st.toAct)).toBe('UTG');
    expect(actingOrder(st.cfg, 1).map((s) => st.cfg.positions[s])).toEqual(['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']);
  });
  it('2 players: button posts SB, first preflop, last postflop', () => {
    let st = newMWHand(cfg(2));
    expect(st.committed).toEqual([50, 100]);
    expect(posOf(st, st.toAct)).toBe('BTN');
    st = mwAct(st, 'call');
    expect(posOf(st, st.toAct)).toBe('BB');
    st = mwAct(st, 'check');
    expect(posOf(st, st.toAct)).toBe('BB');
  });
  it('BB keeps its option in a limped pot', () => {
    let st = newMWHand(cfg(3));
    st = mwAct(st, 'call'); // BTN limps
    st = mwAct(st, 'call'); // SB completes
    expect(posOf(st, st.toAct)).toBe('BB');
    expect(mwLegal(st).check).toBe(true);
  });
});

describe('multiway engine: raises', () => {
  it('min raise = current bet + last full raise', () => {
    let st = newMWHand(cfg(4));
    expect(mwLegal(st).raise!.min).toBe(2);
    st = mwAct(st, 'raise', 3); // CO raises by 2
    st = mwAct(st, 'raise', 8); // BTN re-raises by 5
    expect(mwLegal(st).raise!.min).toBe(13);
  });
  it('a short all-in does not reopen the betting for players who already acted', () => {
    // CO 100, BTN 100, SB 100, BB 14bb. Postflop: SB bets 10, BB shoves 13 total (raise of 3 < 10), CO & BTN not yet acted.
    let st = newMWHand(cfg(4, { stacks: [100, 100, 100, 15] }));
    st = mwAct(st, 'call'); // CO limp
    st = mwAct(st, 'call'); // BTN limp
    st = mwAct(st, 'call'); // SB complete
    st = mwAct(st, 'check'); // BB → flop, BB has 14 left
    expect(posOf(st, st.toAct)).toBe('SB');
    st = mwAct(st, 'bet', 10); // SB
    st = mwAct(st, 'raise', 14); // BB all-in, short (increment 4 < 10)
    expect(st.history[st.history.length - 1].allIn).toBe(true);
    // CO hasn't acted since the full bet: may still raise
    expect(posOf(st, st.toAct)).toBe('CO');
    expect(mwLegal(st).raise).not.toBeNull();
    st = mwAct(st, 'call'); // CO calls 14
    st = mwAct(st, 'call'); // BTN calls 14
    // SB already acted (bet 10): only call or fold
    expect(posOf(st, st.toAct)).toBe('SB');
    const L = mwLegal(st);
    expect(L.raise).toBeNull();
    expect(L.call).toBe(4);
  });
  it('cumulative short all-ins that total a full raise do reopen the betting (TDA Rule 49A)', () => {
    // 5 players postflop. SB bets 10. BB shoves 16 (short: +6). UTG shoves 21 (short again: +5). Together 21 − 10 = 11 ≥ 10:
    // SB, who already acted at 10, faces a cumulative full raise and may re-raise.
    let st = newMWHand(cfg(5, { stacks: [100, 100, 100, 100, 100].map((x, i) => (i === 4 ? 17 : i === 0 ? 22 : x)) }));
    // positions: HJ(0) CO(1) BTN(2) SB(3) BB(4) — HJ has 22, BB 17
    st = mwAct(st, 'call'); // HJ limp
    st = mwAct(st, 'call'); // CO limp (100bb — keeps raising meaningful)
    st = mwAct(st, 'fold'); // BTN
    st = mwAct(st, 'call'); // SB
    st = mwAct(st, 'check'); // BB → flop: SB, BB, HJ, CO
    st = mwAct(st, 'bet', 10); // SB
    st = mwAct(st, 'raise', 16); // BB all-in (16 left)
    st = mwAct(st, 'raise', 21); // HJ all-in (21 left)
    expect(posOf(st, st.toAct)).toBe('CO');
    st = mwAct(st, 'call'); // CO calls 21
    expect(posOf(st, st.toAct)).toBe('SB');
    expect(mwLegal(st).raise).not.toBeNull();
  });
  it('a full raise does reopen the betting', () => {
    let st = newMWHand(cfg(3));
    st = mwAct(st, 'raise', 2.5); // BTN
    st = mwAct(st, 'call'); // SB
    st = mwAct(st, 'raise', 10); // BB full raise
    st = mwAct(st, 'call'); // BTN
    expect(posOf(st, st.toAct)).toBe('SB');
    expect(mwLegal(st).raise).not.toBeNull();
  });
});

describe('multiway engine: pots', () => {
  it('side pots with three unequal all-ins', () => {
    // A 10bb, B 30bb, C 60bb, D 100bb all in preflop; D covers everyone.
    const c = cfg(4, { stacks: [10, 30, 60, 100], holes: [parseCards('As Ah'), parseCards('Ks Kh'), parseCards('Qs Qh'), parseCards('Js Jh')], board: parseCards('2c 7d 9s 3h 4c') });
    let st = newMWHand(c);
    st = mwAct(st, 'raise', 10); // CO all-in 10
    st = mwAct(st, 'raise', 30); // BTN all-in 30
    st = mwAct(st, 'raise', 60); // SB all-in 60
    st = mwAct(st, 'call'); // BB calls 60 (has 100) — excess irrelevant
    expect(st.over).toBe(true);
    const pots = st.result!.pots;
    expect(pots.map((p) => p.amount)).toEqual([40, 60, 60]); // 4×10, 3×20, 2×30
    expect(pots[0].winners).toEqual([0]); // AA wins the main pot
    expect(pots[1].winners).toEqual([1]); // KK wins side pot 1 (AA not eligible)
    expect(pots[2].winners).toEqual([2]); // QQ wins side pot 2
    expect(st.result!.net).toEqual([30, 30, 0, -60]);
    expect(st.result!.net.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });
  it('buildPots handles folded dead money', () => {
    // folded player put in 5 (cents 500), live players 10 and 30
    expect(buildPots([500, 1000, 3000], [true, false, false])).toEqual([
      { amount: 2500, eligible: [1, 2] },
      { amount: 2000, eligible: [2] },
    ]);
  });
  it('three-way split with the odd chip to the first winner left of the button', () => {
    // 4 players (CO, BTN, SB, BB), antes 0.01. CO folds; BTN raises to 3.33; SB & BB call; the board plays for all three.
    // Pot = 3 × 3.33 + 4 × 0.01 = 10.03bb = 1,003 cents → 334 each with 1 odd cent → SB (first left of the button).
    const c = cfg(4, { ante: 0.01, holes: [parseCards('5h 6h'), parseCards('2c 3d'), parseCards('2d 4c'), parseCards('3c 4d')], board: parseCards('As Ks Qs Js Ts') });
    let st = newMWHand(c);
    st = mwAct(st, 'fold'); // CO
    st = mwAct(st, 'raise', 3.33); // BTN
    st = mwAct(st, 'call'); // SB
    st = mwAct(st, 'call'); // BB
    while (!st.over) st = mwAct(st, 'check');
    expect(mwTotalPot(st)).toBe(10.03);
    expect(st.result!.pots[0].winners.length).toBe(3);
    const [btn, sb, bb] = ['BTN', 'SB', 'BB'].map((p) => st.cfg.positions.indexOf(p));
    expect(st.result!.net[sb]).toBeCloseTo(3.35 - 3.34, 9);
    expect(st.result!.net[btn]).toBeCloseTo(3.34 - 3.34, 9);
    expect(st.result!.net[bb]).toBeCloseTo(3.34 - 3.34, 9);
  });
  it('odd chip goes to the first eligible winner left of the button', () => {
    // 3 players; BTN folds after raising? Use: BTN 1.01 limp-raise impossible → construct pot 3.03 split by SB & BB.
    const c = cfg(3, { holes: [parseCards('2c 3d'), parseCards('2d 4c'), parseCards('3c 4d')], board: parseCards('As Ks Qs Js Ts'), ante: 0.01 });
    let st = newMWHand(c); // antes 0.03 + blinds
    st = mwAct(st, 'fold'); // BTN folds (its 0.01 ante is dead)
    st = mwAct(st, 'call'); // SB completes
    st = mwAct(st, 'check'); // BB
    while (!st.over) st = mwAct(st, 'check');
    // pot = 0.03 antes + 1 + 1 = 2.03bb = 203 cents, split 2 ways → 102 to SB (left of button), 101 to BB
    expect(mwTotalPot(st)).toBe(2.03);
    const sb = st.cfg.positions.indexOf('SB');
    const bb = st.cfg.positions.indexOf('BB');
    expect(st.result!.net[sb]).toBeCloseTo(1.02 - 1.01, 9);
    expect(st.result!.net[bb]).toBeCloseTo(1.01 - 1.01, 9);
  });
  it('uncalled bets are returned', () => {
    let st = newMWHand(cfg(3, { stacks: [100, 100, 40] }));
    st = mwAct(st, 'raise', 100); // BTN shoves 100
    st = mwAct(st, 'fold'); // SB
    st = mwAct(st, 'call'); // BB calls 40 all-in
    expect(st.returned).toEqual([{ seat: 0, amount: 60 }]);
    expect(st.over).toBe(true);
  });
  it('no side pot is shown while nobody is all-in', () => {
    let st = newMWHand(cfg(4));
    st = mwAct(st, 'fold');
    st = mwAct(st, 'raise', 2.5);
    expect(currentPots(st).length).toBe(1);
  });
  it('current pots during the hand show main and side pots', () => {
    let st = newMWHand(cfg(3, { stacks: [100, 100, 20] }));
    st = mwAct(st, 'raise', 5);
    st = mwAct(st, 'call');
    st = mwAct(st, 'raise', 20); // BB all-in
    st = mwAct(st, 'raise', 50); // BTN re-raises
    const pots = currentPots(st);
    expect(pots[0].eligible.length).toBe(3);
    expect(pots.length).toBeGreaterThan(1);
  });
});

describe('multiway engine: random play invariants', () => {
  it('3,000 random hands with 2–6 players: chips conserved, hands end, nets sum to zero', () => {
    const rng = mulberry32(11);
    for (let n = 0; n < 3000; n++) {
      const players = 2 + (n % 5);
      let st = newMWHand({ seed: n, positions: positionsFor(players), stacks: Array.from({ length: players }, () => 1 + Math.floor(rng() * 150)), ante: n % 4 === 0 ? 0.1 : 0 });
      const start = mwChips(st);
      let steps = 0;
      while (!st.over) {
        const L = mwLegal(st);
        const opts: (() => MWState)[] = [];
        if (L.fold) opts.push(() => mwAct(st, 'fold'));
        if (L.check) opts.push(() => mwAct(st, 'check'));
        if (L.call !== null) opts.push(() => mwAct(st, 'call'));
        if (L.bet) opts.push(() => mwAct(st, 'bet', Math.round((L.bet!.min + rng() * (L.bet!.max - L.bet!.min)) * 100) / 100));
        if (L.raise) opts.push(() => mwAct(st, 'raise', Math.round((L.raise!.min + rng() * (L.raise!.max - L.raise!.min)) * 100) / 100));
        expect(opts.length).toBeGreaterThan(0);
        st = opts[Math.floor(rng() * opts.length)]();
        expect(mwChips(st)).toBeCloseTo(start, 6);
        expect(st.stack.every((x) => x >= 0)).toBe(true);
        if (++steps > 300) throw new Error('hand did not end');
      }
      expect(st.result!.net.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
      const potSum = st.result!.pots.reduce((a, p) => a + p.amount, 0);
      expect(potSum).toBeCloseTo(st.invested.reduce((a, b) => a + b, 0) / 100, 6);
    }
  });
});
