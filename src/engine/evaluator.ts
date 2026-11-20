// Hand evaluator for 5–7 cards. Returns an integer score; higher beats lower, equal = tie.
// Layout: category << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5
// where r1..r5 are tie-break ranks (0 = deuce .. 12 = ace), most significant first.
import { type Card, RANK_NAMES, RANK_PLURALS, combinations } from './cards';

export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_NAMES = [
  'High card',
  'One pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

// ---- lookup tables over 13-bit rank masks ----
const POP = new Uint8Array(8192);
const STRAIGHT_HIGH = new Int8Array(8192); // rank of top card of best straight, -1 if none (wheel = 3)
const TOP5 = new Int32Array(8192); // top 5 ranks packed into nibbles (r1<<16 ... r5)
for (let m = 0; m < 8192; m++) {
  let p = 0;
  for (let b = 0; b < 13; b++) if (m & (1 << b)) p++;
  POP[m] = p;
  let sh = -1;
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4);
    if ((m & need) === need) {
      sh = hi;
      break;
    }
  }
  if (sh < 0 && (m & 0x100f) === 0x100f) sh = 3; // A-2-3-4-5
  STRAIGHT_HIGH[m] = sh;
  let packed = 0;
  let got = 0;
  for (let b = 12; b >= 0 && got < 5; b--) {
    if (m & (1 << b)) {
      packed |= b << (16 - 4 * got);
      got++;
    }
  }
  TOP5[m] = packed;
}

const rc = new Int32Array(13);
const sm = new Int32Array(4);

/** Evaluate the best 5-card hand out of `n` cards (5 ≤ n ≤ 7). */
export function evaluate(cards: ArrayLike<Card>, n: number = cards.length): number {
  rc.fill(0);
  sm[0] = sm[1] = sm[2] = sm[3] = 0;
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    rc[r]++;
    sm[c & 3] |= 1 << r;
    rankMask |= 1 << r;
  }
  // With ≤7 cards a flush excludes quads and full houses, so checking it first is safe.
  for (let s = 0; s < 4; s++) {
    const m = sm[s];
    if (POP[m] >= 5) {
      const sh = STRAIGHT_HIGH[m];
      if (sh >= 0) return (Category.StraightFlush << 20) | (sh << 16);
      return (Category.Flush << 20) | TOP5[m];
    }
  }
  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  let pair3 = -1;
  let singlesMask = 0;
  for (let r = 12; r >= 0; r--) {
    const k = rc[r];
    if (k === 4) quad = r;
    else if (k === 3) {
      if (trip1 < 0) trip1 = r;
      else trip2 = r;
    } else if (k === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
      else pair3 = r;
    } else if (k === 1) singlesMask |= 1 << r;
  }
  if (quad >= 0) {
    const kick = 31 - Math.clz32(rankMask & ~(1 << quad));
    return (Category.Quads << 20) | (quad << 16) | (kick << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const second = Math.max(trip2, pair1);
    return (Category.FullHouse << 20) | (trip1 << 16) | (second << 12);
  }
  const sh = STRAIGHT_HIGH[rankMask];
  if (sh >= 0) return (Category.Straight << 20) | (sh << 16);
  if (trip1 >= 0) {
    const t = TOP5[singlesMask];
    return (Category.Trips << 20) | (trip1 << 16) | ((t >> 4) & 0xff00);
  }
  if (pair2 >= 0) {
    const kickMask = singlesMask | (pair3 >= 0 ? 1 << pair3 : 0);
    const kick = 31 - Math.clz32(kickMask);
    return (Category.TwoPair << 20) | (pair1 << 16) | (pair2 << 12) | (kick << 8);
  }
  if (pair1 >= 0) {
    const t = TOP5[singlesMask];
    return (Category.Pair << 20) | (pair1 << 16) | ((t >> 4) & 0xfff0);
  }
  return TOP5[singlesMask];
}

export const categoryOf = (score: number): Category => (score >> 20) as Category;

const nib = (score: number, i: number) => (score >> (16 - 4 * i)) & 0xf;

/** Human description, e.g. "Two pair, Aces and Kings (Queen kicker)". */
export function describe(score: number): string {
  const cat = categoryOf(score);
  const r = [0, 1, 2, 3, 4].map((i) => nib(score, i));
  switch (cat) {
    case Category.StraightFlush:
      return r[0] === 12 ? 'Royal flush' : `Straight flush, ${RANK_NAMES[r[0]]}-high`;
    case Category.Quads:
      return `Four of a kind, ${RANK_PLURALS[r[0]]}`;
    case Category.FullHouse:
      return `Full house, ${RANK_PLURALS[r[0]]} full of ${RANK_PLURALS[r[1]]}`;
    case Category.Flush:
      return `Flush, ${RANK_NAMES[r[0]]}-high`;
    case Category.Straight:
      return `Straight, ${RANK_NAMES[r[0]]}-high`;
    case Category.Trips:
      return `Three of a kind, ${RANK_PLURALS[r[0]]}`;
    case Category.TwoPair:
      return `Two pair, ${RANK_PLURALS[r[0]]} and ${RANK_PLURALS[r[1]]}`;
    case Category.Pair:
      return `Pair of ${RANK_PLURALS[r[0]]}`;
    default:
      return `High card, ${RANK_NAMES[r[0]]}`;
  }
}

/** The best 5 cards (for display). Brute force over all 5-subsets; only for UI use. */
export function bestFive(cards: Card[]): Card[] {
  if (cards.length <= 5) return cards.slice();
  let best = -1;
  let bestSet: Card[] = [];
  for (const combo of combinations(cards, 5)) {
    const s = evaluate(combo, 5);
    if (s > best) {
      best = s;
      bestSet = combo;
    }
  }
  return bestSet;
}
