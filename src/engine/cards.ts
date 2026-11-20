// Card representation: integer 0..51. rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc'; // spades, hearts, diamonds, clubs
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function parseCard(s: string): Card {
  const t = s.trim();
  if (t.length !== 2) throw new Error(`Bad card: "${s}"`);
  const r = RANKS.indexOf(t[0].toUpperCase());
  const su = SUITS.indexOf(t[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Bad card: "${s}"`);
  return makeCard(r, su);
}

/** Parse "AsKd" or "As Kd" or "As,Kd" into cards. */
export function parseCards(s: string): Card[] {
  const clean = s.replace(/[\s,]+/g, '');
  if (clean.length % 2 !== 0) throw new Error(`Bad card list: "${s}"`);
  const out: Card[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseCard(clean.slice(i, i + 2)));
  if (new Set(out).size !== out.length) throw new Error(`Duplicate card in "${s}"`);
  return out;
}

export const cardToString = (c: Card): string => RANKS[rankOf(c)] + SUITS[suitOf(c)];
export const cardsToString = (cs: Card[]): string => cs.map(cardToString).join(' ');

export const FULL_DECK: Card[] = Array.from({ length: 52 }, (_, i) => i);

export function remainingDeck(dead: Iterable<Card>): Card[] {
  const d = new Set(dead);
  return FULL_DECK.filter((c) => !d.has(c));
}

/** Iterate all k-combinations of arr (as index arrays reused; copy if you keep them). */
export function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n || k < 0) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Small seedable PRNG (mulberry32) so Monte Carlo runs and generators can be reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
