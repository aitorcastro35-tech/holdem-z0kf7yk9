// Multiway equity: each player's share of the pot (ties split) — exact for known hands when the number of runouts is
// manageable, Monte Carlo otherwise; and hero vs several opponents' weighted ranges (Monte Carlo, seeded).
import { type Card, remainingDeck, mulberry32, choose } from './cards';
import { evaluate } from './evaluator';

export interface MultiResult {
  equity: number[]; // per player, sums to 1
  exact: boolean;
  samples: number;
}

/** Equity of each known hand on an optional partial board. Exact if runouts × players ≤ maxWork. */
export function multiEquityHands(hands: Card[][], board: Card[] = [], opts: { maxWork?: number; iterations?: number; seed?: number } = {}): MultiResult {
  const dead = [...hands.flat(), ...board];
  if (new Set(dead).size !== dead.length) throw new Error('Duplicate cards');
  const deck = remainingDeck(dead);
  const need = 5 - board.length;
  const runouts = choose(deck.length, need);
  const n = hands.length;
  const share = new Float64Array(n);
  const bufs = hands.map((h) => {
    const b = new Int32Array(7);
    b[0] = h[0];
    b[1] = h[1];
    for (let i = 0; i < board.length; i++) b[2 + i] = board[i];
    return b;
  });
  const base = 2 + board.length;
  const scores = new Int32Array(n);
  const score = (w: number) => {
    let best = -1;
    let cnt = 0;
    for (let p = 0; p < n; p++) {
      scores[p] = evaluate(bufs[p], 7);
      if (scores[p] > best) {
        best = scores[p];
        cnt = 1;
      } else if (scores[p] === best) cnt++;
    }
    for (let p = 0; p < n; p++) if (scores[p] === best) share[p] += w / cnt;
  };
  const exact = runouts * n <= (opts.maxWork ?? 6_000_000);
  if (exact) {
    if (need === 0) score(1);
    else {
      const idx = Array.from({ length: need }, (_, i) => i);
      while (true) {
        for (let p = 0; p < n; p++) for (let i = 0; i < need; i++) bufs[p][base + i] = deck[idx[i]];
        score(1);
        let i = need - 1;
        while (i >= 0 && idx[i] === deck.length - need + i) i--;
        if (i < 0) break;
        idx[i]++;
        for (let j = i + 1; j < need; j++) idx[j] = idx[j - 1] + 1;
      }
    }
    return { equity: Array.from(share, (x) => x / runouts), exact: true, samples: runouts };
  }
  const iters = opts.iterations ?? 60_000;
  const rng = mulberry32(opts.seed ?? 1);
  const pick = deck.slice();
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pick.length - i));
      [pick[i], pick[j]] = [pick[j], pick[i]];
      for (let p = 0; p < n; p++) bufs[p][base + i] = pick[i];
    }
    score(1);
  }
  return { equity: Array.from(share, (x) => x / iters), exact: false, samples: iters };
}

/**
 * Hero's equity vs several opponents, each described by a weighted range (Monte Carlo). Opponent combos are sampled
 * in turn by weight, rejecting combos that conflict with cards already dealt (card removal between all ranges).
 */
export function multiEquityVsRanges(
  hero: Card[],
  ranges: { cards: [Card, Card]; weight: number }[][],
  board: Card[] = [],
  opts: { iterations?: number; seed?: number; timeBudgetMs?: number } = {},
): { equity: number; exact: false; samples: number } {
  const rng = mulberry32(opts.seed ?? 7);
  const iters = opts.iterations ?? 4000;
  const dead0 = new Uint8Array(52);
  hero.forEach((c) => (dead0[c] = 1));
  board.forEach((c) => (dead0[c] = 1));
  const live = ranges.map((r) => r.filter((c) => c.weight > 0 && !dead0[c.cards[0]] && !dead0[c.cards[1]]));
  if (live.some((r) => !r.length)) throw new Error('An opponent range is empty after card removal');
  const cums = live.map((r) => {
    let s = 0;
    return { cum: r.map((c) => (s += c.weight)), total: s };
  });
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const hb = new Int32Array(7);
  hb[0] = hero[0];
  hb[1] = hero[1];
  board.forEach((c, i) => (hb[2 + i] = c));
  const ob = live.map(() => new Int32Array(7));
  ob.forEach((b) => board.forEach((c, i) => (b[2 + i] = c)));
  const base = 2 + board.length;
  let share = 0;
  let done = 0;
  const t0 = Date.now();
  for (let it = 0; it < iters; it++) {
    if (opts.timeBudgetMs && (it & 255) === 0 && it > 0 && Date.now() - t0 > opts.timeBudgetMs) break;
    used.set(dead0);
    let ok = true;
    for (let p = 0; p < live.length && ok; p++) {
      let tries = 0;
      let c: [Card, Card];
      do {
        const x = rng() * cums[p].total;
        let lo = 0;
        let hi = cums[p].cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cums[p].cum[mid] > x) hi = mid;
          else lo = mid + 1;
        }
        c = live[p][lo].cards;
        if (++tries > 40) {
          ok = false;
          break;
        }
      } while (used[c[0]] || used[c[1]]);
      if (!ok) break;
      used[c![0]] = used[c![1]] = 1;
      ob[p][0] = c![0];
      ob[p][1] = c![1];
    }
    if (!ok) continue;
    for (let k = 0; k < need; k++) {
      let c: number;
      do c = (rng() * 52) | 0;
      while (used[c]);
      used[c] = 1;
      hb[base + k] = c;
      for (const b of ob) b[base + k] = c;
    }
    const hs = evaluate(hb, 7);
    let best = hs;
    let cnt = 1;
    let heroBest = true;
    for (const b of ob) {
      const s = evaluate(b, 7);
      if (s > best) {
        best = s;
        cnt = 1;
        heroBest = false;
      } else if (s === best) cnt++;
    }
    if (heroBest && hs === best) share += 1 / cnt;
    done++;
  }
  return { equity: done ? share / done : 0, exact: false, samples: done };
}
