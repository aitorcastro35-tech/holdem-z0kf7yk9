// Outs counting.
//  - drawOuts(): structural outs to a straight-or-better when villain's hand is unknown, flagging "dirty" outs.
//  - outsVsHand(): exact outs against a known villain hand (cards that put hero ahead).
import { type Card, rankOf, suitOf, remainingDeck } from './cards';
import { evaluate, categoryOf, Category, CATEGORY_NAMES } from './evaluator';

export interface Out {
  card: Card;
  makes: string; // category name hero makes with this card
  dirty: boolean;
  reasons: string[]; // why it is dirty
}

export interface OutsReport {
  outs: Out[]; // all improving cards to the target
  clean: Card[];
  dirty: Card[];
  currentCategory: string;
}

/** Highest straight (top-card rank) any two hole cards could make with this board; -1 if none. */
function nutStraightHigh(board: Card[]): number {
  let boardMask = 0;
  for (const c of board) boardMask |= 1 << rankOf(c);
  let best = -1;
  for (let a = 0; a < 13; a++)
    for (let b = a; b < 13; b++) {
      const m = boardMask | (1 << a) | (1 << b);
      const h = straightHigh(m);
      if (h > best) best = h;
    }
  return best;
}

function straightHigh(m: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4);
    if ((m & need) === need) return hi;
  }
  return (m & 0x100f) === 0x100f ? 3 : -1;
}

function boardIsPaired(board: Card[]): boolean {
  const s = new Set(board.map(rankOf));
  return s.size < board.length;
}

function maxSuitCount(board: Card[]): number {
  const n = [0, 0, 0, 0];
  for (const c of board) n[suitOf(c)]++;
  return Math.max(...n);
}

/**
 * Outs to a straight or better (the usual meaning of "drawing outs"), for a flop (3) or turn (4) board.
 * If hero already has trips/two pair, full-house/quads outs count too (they are straight-or-better).
 * Overcard / pair outs are reported separately (weaker, not counted).
 */
export function drawOuts(hole: Card[], board: Card[]): OutsReport {
  if (board.length < 3 || board.length > 4) throw new Error('drawOuts needs a flop or turn board');
  const cur = evaluate([...hole, ...board]);
  const curCat = categoryOf(cur);
  const deck = remainingDeck([...hole, ...board]);
  const outs: Out[] = [];
  for (const c of deck) {
    const nb = [...board, c];
    const s = evaluate([...hole, ...nb]);
    const cat = categoryOf(s);
    if (cat < Category.Straight || cat <= curCat) continue;
    // Hole cards must contribute: on a 5-card board, hero must beat the board itself.
    if (nb.length === 5 && evaluate(nb) >= s) continue;
    const reasons: string[] = [];
    if ((cat === Category.Straight || cat === Category.Flush) && boardIsPaired(nb))
      reasons.push('pairs the board (a full house is possible)');
    if (cat === Category.Straight && maxSuitCount(nb) >= 3) reasons.push('puts three of a suit on board (a flush is possible)');
    if (cat === Category.Straight) {
      const mine = (s >> 16) & 0xf;
      const nut = nutStraightHigh(nb);
      if (nut > mine) reasons.push('a higher straight is possible');
    }
    if (cat === Category.Flush) {
      // Non-nut flush: is there a higher card of the flush suit that is not visible to hero?
      const suitCounts = [0, 0, 0, 0];
      for (const x of [...hole, ...nb]) suitCounts[suitOf(x)]++;
      const fs = suitCounts.indexOf(Math.max(...suitCounts));
      const heroTop = Math.max(...hole.filter((x) => suitOf(x) === fs).map(rankOf), -1);
      const seen = new Set([...hole, ...nb].filter((x) => suitOf(x) === fs).map(rankOf));
      let higherMissing = false;
      for (let r = heroTop + 1; r <= 12; r++) if (!seen.has(r)) higherMissing = true;
      if (higherMissing) reasons.push('not the nut flush (a higher flush is possible)');
    }
    outs.push({ card: c, makes: CATEGORY_NAMES[cat], dirty: reasons.length > 0, reasons });
  }
  return {
    outs,
    clean: outs.filter((o) => !o.dirty).map((o) => o.card),
    dirty: outs.filter((o) => o.dirty).map((o) => o.card),
    currentCategory: CATEGORY_NAMES[curCat],
  };
}

export interface VsHandOuts {
  outs: Card[]; // cards after which hero is strictly ahead
  ties: Card[]; // cards after which it's a tie
  aheadNow: boolean;
  unseen: number;
}

/** Exact outs vs a known villain hand on a flop or turn board. */
export function outsVsHand(hero: Card[], villain: Card[], board: Card[]): VsHandOuts {
  if (board.length < 3 || board.length > 4) throw new Error('outsVsHand needs a flop or turn board');
  const deck = remainingDeck([...hero, ...villain, ...board]);
  const aheadNow = evaluate([...hero, ...board]) > evaluate([...villain, ...board]);
  const outs: Card[] = [];
  const ties: Card[] = [];
  for (const c of deck) {
    const h = evaluate([...hero, ...board, c]);
    const v = evaluate([...villain, ...board, c]);
    if (h > v) outs.push(c);
    else if (h === v) ties.push(c);
  }
  return { outs: aheadNow ? [] : outs, ties, aheadNow, unseen: deck.length };
}
