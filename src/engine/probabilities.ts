// Exact probabilities computed by enumeration. These feed flashcards and reference tables;
// nothing here is typed in by hand — tests cross-check the results against published values.
import { type Card, FULL_DECK, makeCard, rankOf, suitOf, remainingDeck, combinations, choose } from './cards';
import { evaluate, categoryOf } from './evaluator';

export interface Fraction {
  hits: number;
  total: number;
  p: number;
}
const frac = (hits: number, total: number): Fraction => ({ hits, total, p: hits / total });

/** Enumerate all 1,326 starting hands and count those matching the predicate. */
export function startingHandProbability(pred: (a: Card, b: Card) => boolean): Fraction {
  let hits = 0;
  let total = 0;
  for (let i = 0; i < 52; i++)
    for (let j = i + 1; j < 52; j++) {
      total++;
      if (pred(FULL_DECK[i], FULL_DECK[j])) hits++;
    }
  return frac(hits, total);
}

/** Enumerate all 19,600 flops for a given hole hand. */
export function flopProbability(hole: Card[], pred: (flop: Card[]) => boolean): Fraction {
  let hits = 0;
  let total = 0;
  for (const f of combinations(remainingDeck(hole), 3)) {
    total++;
    if (pred(f)) hits++;
  }
  return frac(hits, total);
}

// Representative hole cards. Results do not depend on the specific ranks/suits chosen (symmetry).
const POCKET_PAIR = [makeCard(7, 0), makeCard(7, 1)]; // 9s 9h
const UNPAIRED = [makeCard(12, 0), makeCard(9, 1)]; // As Jh
const SUITED = [makeCard(12, 0), makeCard(9, 0)]; // As Js

export const facts = {
  pocketPair: () => startingHandProbability((a, b) => rankOf(a) === rankOf(b)),
  specificPair: () => startingHandProbability((a, b) => rankOf(a) === 12 && rankOf(b) === 12),
  suited: () => startingHandProbability((a, b) => suitOf(a) === suitOf(b) && rankOf(a) !== rankOf(b)),
  /** Flop contains at least one card of the pair's rank (set, or quads). */
  pairFlopsSetOrBetter: () => flopProbability(POCKET_PAIR, (f) => f.some((c) => rankOf(c) === 7)),
  /** Flop pairs at least one of two unpaired hole cards. */
  unpairedFlopsPair: () =>
    flopProbability(UNPAIRED, (f) => f.some((c) => rankOf(c) === 12 || rankOf(c) === 9)),
  /** Suited hole cards; exactly two of the flop are of that suit (flush draw). */
  suitedFlopsFlushDraw: () => flopProbability(SUITED, (f) => f.filter((c) => suitOf(c) === 0).length === 2),
  /** Suited hole cards; all three flop cards are of that suit (made flush). */
  suitedFlopsFlush: () => flopProbability(SUITED, (f) => f.every((c) => suitOf(c) === 0)),
};

/** Count of 5-card hands per category by full enumeration of C(52,5) = 2,598,960 hands. */
export function fiveCardCategoryCounts(): number[] {
  const counts = new Array(9).fill(0);
  let royal = 0;
  const h = new Int32Array(5);
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++)
        for (let d = c + 1; d < 52; d++)
          for (let e = d + 1; e < 52; e++) {
            h[0] = a;
            h[1] = b;
            h[2] = c;
            h[3] = d;
            h[4] = e;
            const s = evaluate(h, 5);
            const cat = categoryOf(s);
            counts[cat]++;
            if (cat === 8 && ((s >> 16) & 0xf) === 12) royal++;
          }
  return [...counts, royal]; // index 9 = royal flushes (also included in index 8)
}

/** Total 5-card hands, for reference. */
export const TOTAL_5 = choose(52, 5);
export const TOTAL_7 = choose(52, 7);

/**
 * 5-card hand counts by closed-form combinatorics (index = category 0..8, plus royal at 9).
 * tests/evaluator.test.ts checks these equal the full enumeration above.
 */
export function fiveCardCountsClosedForm(): number[] {
  const straightsPerSuitPattern = 10; // A-high .. 5-high
  const sf = straightsPerSuitPattern * 4; // incl. royal
  const flushAll = 4 * choose(13, 5);
  const straightAll = straightsPerSuitPattern * 4 ** 5;
  return [
    (choose(13, 5) - 10) * (4 ** 5 - 4), // high card
    13 * choose(4, 2) * choose(12, 3) * 4 ** 3, // one pair
    choose(13, 2) * choose(4, 2) ** 2 * 11 * 4, // two pair
    13 * choose(4, 3) * choose(12, 2) * 4 ** 2, // trips
    straightAll - sf, // straight (not flush)
    flushAll - sf, // flush (not straight)
    13 * choose(4, 3) * 12 * choose(4, 2), // full house
    13 * 48, // quads
    sf, // straight flush incl. royal
    4, // royal
  ];
}

/**
 * 7-card (best 5 of 7) category counts over all C(52,7) = 133,784,560 hands.
 * Too slow to recompute in the browser, so stored here — but tests/evaluator.test.ts recomputes every value
 * by exhaustive enumeration with this app's evaluator (and they match Wikipedia's table).
 * Index = category 0..8 (straight flush includes royal), 9 = royal flush.
 */
export const SEVEN_CARD_COUNTS = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584, 4324];
