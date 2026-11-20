// Postflop hand classification (made hand strength + draws), used to build stated villain ranges
// like "top pair or better plus strong draws" and to describe hero's hand.
import { type Card, rankOf, suitOf } from './cards';
import { evaluate, categoryOf, Category } from './evaluator';
import { type Range, expandRange, type WeightedCombo } from './range';

export interface HandFeatures {
  category: number; // evaluator category of hole + board
  improvesBoard: boolean; // hole cards make the hand better than the board alone (or board < 5 cards and hand uses a hole card)
  pair: 'overpair' | 'top' | 'second' | 'weak' | 'underpair' | null; // for one-pair hands
  flushDraw: boolean; // 4 to a flush using at least one hole card (not yet a flush)
  nutFlushDraw: boolean;
  oesd: boolean; // open-ended (or double gutter): 8 straight outs
  gutshot: boolean; // exactly 4 straight outs
}

function straightOutCount(hole: Card[], board: Card[]): number {
  const seen = new Set([...hole, ...board]);
  const ranks = new Set<number>();
  const has = [...hole, ...board].map(rankOf);
  const mask0 = has.reduce((m, r) => m | (1 << r), 0);
  const isStraight = (m: number) => {
    for (let hi = 12; hi >= 4; hi--) if ((m & (0x1f << (hi - 4))) === 0x1f << (hi - 4)) return true;
    return (m & 0x100f) === 0x100f;
  };
  if (isStraight(mask0)) return 0;
  const boardMask = board.reduce((m, c) => m | (1 << rankOf(c)), 0);
  for (let r = 0; r < 13; r++) {
    const m = mask0 | (1 << r);
    // must use a hole card: the board + new card alone must not already make it
    if (isStraight(m) && !isStraight(boardMask | (1 << r))) ranks.add(r);
  }
  let n = 0;
  for (const r of ranks) for (let s = 0; s < 4; s++) if (!seen.has((r << 2) | s)) n++;
  return n;
}

export function features(hole: Card[], board: Card[]): HandFeatures {
  const all = [...hole, ...board];
  const score = evaluate(all);
  const category = categoryOf(score);
  const boardScore = board.length >= 5 ? evaluate(board) : -1;
  const boardRanks = board.map(rankOf).sort((a, b) => b - a);
  const holeRanks = hole.map(rankOf);
  let improvesBoard = board.length >= 5 ? score > boardScore : true;
  // For <5 board cards: does the made hand use a hole card? Compare with the board's own pairing.
  if (board.length < 5) {
    const boardPairs = new Set(boardRanks.filter((r, i) => boardRanks.indexOf(r) !== i));
    const holePairsBoard = holeRanks.some((r) => boardRanks.includes(r));
    const pocketPair = holeRanks[0] === holeRanks[1];
    improvesBoard = holePairsBoard || pocketPair || category >= Category.Straight || (boardPairs.size === 0 && category > 0);
  }
  let pair: HandFeatures['pair'] = null;
  if (category === Category.Pair) {
    const top = boardRanks[0];
    const pocket = holeRanks[0] === holeRanks[1] ? holeRanks[0] : -1;
    if (pocket >= 0) pair = pocket > top ? 'overpair' : 'underpair';
    else if (holeRanks.includes(top)) pair = 'top';
    else if (boardRanks.length > 1 && holeRanks.includes(boardRanks[1])) pair = 'second';
    else if (holeRanks.some((r) => boardRanks.includes(r))) pair = 'weak';
  }
  let flushDraw = false;
  let nutFlushDraw = false;
  if (category !== Category.Flush && category !== Category.StraightFlush && board.length < 5) {
    for (let s = 0; s < 4; s++) {
      const n = all.filter((c) => suitOf(c) === s).length;
      const holeN = hole.filter((c) => suitOf(c) === s).length;
      if (n === 4 && holeN >= 1) {
        flushDraw = true;
        const seen = new Set(all.filter((c) => suitOf(c) === s).map(rankOf));
        let top = 12;
        while (seen.has(top) && !hole.some((c) => suitOf(c) === s && rankOf(c) === top)) top--;
        nutFlushDraw = hole.some((c) => suitOf(c) === s && rankOf(c) === top);
      }
    }
  }
  const so = board.length < 5 && category < Category.Straight ? straightOutCount(hole, board) : 0;
  return { category, improvesBoard, pair, flushDraw, nutFlushDraw, oesd: so >= 8, gutshot: so > 0 && so < 8 };
}

export type RangeFilter = 'all' | 'pair-plus' | 'top-pair-plus' | 'value-and-draws' | 'draws' | 'two-pair-plus' | 'air';

export const FILTER_LABEL: Record<RangeFilter, string> = {
  all: 'all combos',
  'pair-plus': 'any pair or better that uses a hole card',
  'top-pair-plus': 'top pair / overpair or better',
  'two-pair-plus': 'two pair or better (using a hole card)',
  'value-and-draws': 'top pair or better, plus flush draws and open-ended straight draws',
  draws: 'flush draws and open-ended straight draws without a pair',
  air: 'no pair and no draw',
};

export function passes(f: HandFeatures, filter: RangeFilter): boolean {
  const tpp = (f.category >= Category.TwoPair && f.improvesBoard) || f.pair === 'top' || f.pair === 'overpair';
  const draw = f.flushDraw || f.oesd;
  switch (filter) {
    case 'all':
      return true;
    case 'pair-plus':
      return f.category >= Category.Pair && f.improvesBoard;
    case 'top-pair-plus':
      return tpp;
    case 'two-pair-plus':
      return f.category >= Category.TwoPair && f.improvesBoard;
    case 'value-and-draws':
      return tpp || draw;
    case 'draws':
      return draw && !(f.category >= Category.Pair && f.improvesBoard);
    case 'air':
      return !draw && !f.gutshot && !(f.category >= Category.Pair && f.improvesBoard);
  }
}

/** Expand a preflop range on a board (blockers removed) and keep combos passing the filter. */
export function filteredCombos(range: Range, board: Card[], dead: Card[], filter: RangeFilter): WeightedCombo[] {
  return expandRange(range, [...board, ...dead]).filter((c) => passes(features(c.cards, board), filter));
}

export function describeFeatures(f: HandFeatures): string {
  const names = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const parts: string[] = [];
  if (f.category === Category.Pair && f.pair) parts.push({ overpair: 'Overpair', top: 'Top pair', second: 'Second pair', weak: 'Weak pair', underpair: 'Underpair' }[f.pair]);
  else if (f.category > 0 && !f.improvesBoard) parts.push(`${names[f.category]} (on the board)`);
  else parts.push(names[f.category]);
  if (f.nutFlushDraw) parts.push('nut flush draw');
  else if (f.flushDraw) parts.push('flush draw');
  if (f.oesd) parts.push('open-ended straight draw');
  else if (f.gutshot) parts.push('gutshot');
  return parts.join(' + ');
}
