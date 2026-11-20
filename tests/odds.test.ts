import { describe, it, expect } from 'vitest';
import {
  requiredEquityFacingBet, requiredEquity, mdf, bluffBreakEven, evCall, flopToRiver, flopToTurn, turnToRiver,
  hitProbability, ruleOf4, ruleOf4Corrected, ruleOf2,
} from '../src/engine/odds';
import { facts } from '../src/engine/probabilities';
import { choose } from '../src/engine/cards';

describe('pot odds / MDF / alpha (formulas from §3 of the spec)', () => {
  it('half-pot bet requires 25% equity; pot-size bet 33.3%', () => {
    expect(requiredEquityFacingBet(100, 50)).toBeCloseTo(0.25, 10);
    expect(requiredEquityFacingBet(100, 100)).toBeCloseTo(1 / 3, 10);
    expect(requiredEquityFacingBet(100, 33)).toBeCloseTo(33 / 166, 10);
  });
  it('general required equity', () => {
    expect(requiredEquity(50, 200)).toBe(0.25);
  });
  it('MDF: pot bet → 50%, half pot → 66.7%', () => {
    expect(mdf(100, 100)).toBe(0.5);
    expect(mdf(100, 50)).toBeCloseTo(2 / 3, 10);
  });
  it('bluff break-even: pot bet 50%, half pot 33.3%', () => {
    expect(bluffBreakEven(100, 100)).toBe(0.5);
    expect(bluffBreakEven(100, 50)).toBeCloseTo(1 / 3, 10);
  });
  it('EV of call is zero at exactly the required equity', () => {
    const pot = 100;
    const bet = 50;
    const req = requiredEquityFacingBet(pot, bet);
    expect(evCall(req, pot + 2 * bet, bet)).toBeCloseTo(0, 10);
    expect(evCall(0.5, 200, 50)).toBe(50);
  });
});

// Cross-check: Wizard of Odds, Texas Hold'em main page "Pot Odds" table
// (https://wizardofodds.com/games/texas-hold-em/, last updated Aug 3 2026):
// after flop: 4-flush 34.97%, open-ended 31.45%, inside 16.47%; after turn: 19.57%, 17.39%, 8.70%.
describe('outs → probability matches Wizard of Odds pot-odds table', () => {
  it('flop → river', () => {
    expect(flopToRiver(9) * 100).toBeCloseTo(34.97, 2);
    expect(flopToRiver(8) * 100).toBeCloseTo(31.45, 2);
    expect(flopToRiver(4) * 100).toBeCloseTo(16.47, 2);
  });
  it('turn → river', () => {
    expect(turnToRiver(9) * 100).toBeCloseTo(19.57, 2);
    expect(turnToRiver(8) * 100).toBeCloseTo(17.39, 2);
    expect(turnToRiver(4) * 100).toBeCloseTo(8.7, 2);
  });
  it('flop → turn only (flush draw ≈ 19.1%)', () => {
    expect(flopToTurn(9)).toBeCloseTo(9 / 47, 12);
    expect(flopToTurn(9) * 100).toBeCloseTo(19.15, 2);
  });
  it('hitProbability equals the complement formula', () => {
    for (let outs = 1; outs <= 20; outs++)
      expect(hitProbability(outs, 47, 2)).toBeCloseTo(1 - ((47 - outs) * (46 - outs)) / (47 * 46), 12);
  });
});

describe('rules of thumb vs exact', () => {
  it('rule of 2 and 4 are close for small outs; correction keeps error small for many outs', () => {
    for (let outs = 1; outs <= 8; outs++) expect(Math.abs(ruleOf4(outs) - flopToRiver(outs) * 100)).toBeLessThan(2);
    for (let outs = 1; outs <= 15; outs++) {
      expect(Math.abs(ruleOf2(outs) - turnToRiver(outs) * 100)).toBeLessThan(3);
      expect(Math.abs(ruleOf4Corrected(outs) - flopToRiver(outs) * 100)).toBeLessThan(2.5);
    }
    // Uncorrected rule of 4 overstates 15 outs substantially
    expect(ruleOf4(15) - flopToRiver(15) * 100).toBeGreaterThan(5);
  });
});

describe('starting-hand and flop probabilities (enumerated)', () => {
  it('dealt a pocket pair = 78/1326 = 1/17 (Wikipedia, Texas hold \'em starting hands)', () => {
    const f = facts.pocketPair();
    expect(f.hits).toBe(78);
    expect(f.total).toBe(1326);
    expect(f.p).toBeCloseTo(1 / 17, 12);
  });
  it('dealt AA = 6/1326 = 1/221', () => {
    expect(facts.specificPair().p).toBeCloseTo(1 / 221, 12);
  });
  it('suited non-pair = 312/1326 (23.53%)', () => {
    expect(facts.suited().hits).toBe(312);
  });
  it('pocket pair flops set or better ≈ 11.8% (= 1 − C(48,3)/C(50,3))', () => {
    const f = facts.pairFlopsSetOrBetter();
    expect(f.total).toBe(19600);
    expect(f.p).toBeCloseTo(1 - choose(48, 3) / choose(50, 3), 12);
    expect(f.p * 100).toBeCloseTo(11.76, 2);
  });
  it('unpaired hand flops at least a pair (pairs a hole card) ≈ 32.4%', () => {
    const f = facts.unpairedFlopsPair();
    expect(f.p).toBeCloseTo(1 - choose(44, 3) / choose(50, 3), 12);
    expect(f.p * 100).toBeCloseTo(32.43, 2);
  });
  it('suited hand flops a flush draw ≈ 10.9%, a flush ≈ 0.84%', () => {
    expect(facts.suitedFlopsFlushDraw().hits).toBe(choose(11, 2) * 39);
    expect(facts.suitedFlopsFlushDraw().p * 100).toBeCloseTo(10.94, 2);
    expect(facts.suitedFlopsFlush().hits).toBe(choose(11, 3));
    expect(facts.suitedFlopsFlush().p * 100).toBeCloseTo(0.84, 2);
  });
});
