// Equity: hero hand vs a specific hand or vs a weighted range, on an optional partial board.
// Exhaustive enumeration when cheap enough, otherwise Monte Carlo (flagged exact=false).
import { type Card, choose, remainingDeck, mulberry32 } from './cards';
import { evaluate } from './evaluator';
import { type Range, expandRange, type WeightedCombo } from './range';

export interface EquityResult {
  win: number; // fraction of (weighted) outcomes hero wins outright
  tie: number;
  lose: number;
  equity: number; // win + tie / 2
  exact: boolean; // true = full enumeration, false = Monte Carlo estimate
  samples: number; // number of (combo, runout) outcomes evaluated
  combos: number; // weighted villain combos considered (after blockers)
}

export interface EquityOptions {
  /** Max number of hand evaluations pairs for exhaustive mode (default 3,000,000). */
  maxExhaustive?: number;
  /** Monte Carlo iterations (default 60,000 → 95% CI about ±0.4% on equity). */
  iterations?: number;
  seed?: number;
  /** Force a mode, mainly for tests. */
  mode?: 'auto' | 'exact' | 'mc';
}

function checkDistinct(cards: Card[]) {
  if (new Set(cards).size !== cards.length) throw new Error('Duplicate cards in equity input');
}

const hBuf = new Int32Array(7);
const vBuf = new Int32Array(7);

/**
 * Enumerate all completions of the board for one hero/villain pair; accumulates win/tie/lose counts.
 */
function enumeratePair(hero: Card[], vill: Card[], board: Card[], acc: [number, number, number], weight: number) {
  const dead = [...hero, ...vill, ...board];
  const deck = remainingDeck(dead);
  const need = 5 - board.length;
  hBuf[0] = hero[0];
  hBuf[1] = hero[1];
  vBuf[0] = vill[0];
  vBuf[1] = vill[1];
  for (let i = 0; i < board.length; i++) hBuf[2 + i] = vBuf[2 + i] = board[i];
  const base = 2 + board.length;
  const n = deck.length;
  const score = () => {
    const hs = evaluate(hBuf, 7);
    const vs = evaluate(vBuf, 7);
    if (hs > vs) acc[0] += weight;
    else if (hs === vs) acc[1] += weight;
    else acc[2] += weight;
  };
  if (need === 0) {
    score();
    return;
  }
  // nested loops over k-combinations of the deck
  const idx = new Int32Array(need);
  for (let i = 0; i < need; i++) idx[i] = i;
  while (true) {
    for (let i = 0; i < need; i++) hBuf[base + i] = vBuf[base + i] = deck[idx[i]];
    score();
    let i = need - 1;
    while (i >= 0 && idx[i] === n - need + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < need; j++) idx[j] = idx[j - 1] + 1;
  }
}

function finish(acc: [number, number, number], exact: boolean, samples: number, combos: number): EquityResult {
  const tot = acc[0] + acc[1] + acc[2];
  if (tot === 0) return { win: 0, tie: 0, lose: 0, equity: 0, exact, samples: 0, combos };
  const win = acc[0] / tot;
  const tie = acc[1] / tot;
  const lose = acc[2] / tot;
  return { win, tie, lose, equity: win + tie / 2, exact, samples, combos };
}

/** Hero vs a weighted list of villain combos. */
export function equityVsCombos(
  hero: Card[],
  villainCombos: WeightedCombo[],
  board: Card[] = [],
  opts: EquityOptions = {},
): EquityResult {
  checkDistinct([...hero, ...board]);
  const deadSet = new Set([...hero, ...board]);
  const combos = villainCombos.filter((c) => c.weight > 0 && !deadSet.has(c.cards[0]) && !deadSet.has(c.cards[1]));
  const totalWeight = combos.reduce((s, c) => s + c.weight, 0);
  if (combos.length === 0) throw new Error('Villain range is empty after removing blocked combos');
  const runouts = choose(52 - 4 - board.length, 5 - board.length);
  const cost = runouts * combos.length;
  const mode = opts.mode ?? 'auto';
  const useExact = mode === 'exact' || (mode === 'auto' && cost <= (opts.maxExhaustive ?? 3_000_000));
  const acc: [number, number, number] = [0, 0, 0];
  if (useExact) {
    for (const c of combos) enumeratePair(hero, c.cards, board, acc, c.weight);
    return finish(acc, true, cost, totalWeight);
  }
  // Monte Carlo
  const iters = opts.iterations ?? 60_000;
  const rng = mulberry32(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
  const cum: number[] = [];
  let s = 0;
  for (const c of combos) cum.push((s += c.weight));
  const used = new Uint8Array(52);
  const need = 5 - board.length;
  hBuf[0] = hero[0];
  hBuf[1] = hero[1];
  for (let i = 0; i < board.length; i++) hBuf[2 + i] = vBuf[2 + i] = board[i];
  const base = 2 + board.length;
  for (let it = 0; it < iters; it++) {
    // weighted pick of villain combo (binary search)
    const x = rng() * s;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    const v = combos[lo].cards;
    used.fill(0);
    for (const c of hero) used[c] = 1;
    for (const c of board) used[c] = 1;
    used[v[0]] = used[v[1]] = 1;
    vBuf[0] = v[0];
    vBuf[1] = v[1];
    for (let k = 0; k < need; k++) {
      let c: number;
      do c = (rng() * 52) | 0;
      while (used[c]);
      used[c] = 1;
      hBuf[base + k] = vBuf[base + k] = c;
    }
    const hs = evaluate(hBuf, 7);
    const vs = evaluate(vBuf, 7);
    if (hs > vs) acc[0]++;
    else if (hs === vs) acc[1]++;
    else acc[2]++;
  }
  return finish(acc, false, iters, totalWeight);
}

export function equityVsRange(hero: Card[], range: Range, board: Card[] = [], opts: EquityOptions = {}): EquityResult {
  return equityVsCombos(hero, expandRange(range, [...hero, ...board]), board, opts);
}

export function equityVsHand(hero: Card[], villain: Card[], board: Card[] = [], opts: EquityOptions = {}): EquityResult {
  checkDistinct([...hero, ...villain, ...board]);
  return equityVsCombos(hero, [{ cards: [villain[0], villain[1]], weight: 1, cls: '' }], board, { ...opts, mode: opts.mode ?? 'exact' });
}
