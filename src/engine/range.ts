// Hand classes (the 169 starting hands) and range notation parsing / formatting / combo expansion.
import { type Card, RANKS, makeCard, rankOf, suitOf } from './cards';

/** A hand class label: "AA", "AKs", "AKo". */
export type HandClass = string;
/** A range: hand class → weight in [0, 1] (1 = always in range, 0.5 = half the combos/frequency). */
export type Range = Map<HandClass, number>;

/** Grid index 0 = Ace … 12 = Deuce (display order). */
export const GRID_RANKS = 'AKQJT98765432';

/** Label for grid cell (row, col). Pairs on the diagonal, suited above (row < col), offsuit below. */
export function gridLabel(row: number, col: number): HandClass {
  const a = GRID_RANKS[row];
  const b = GRID_RANKS[col];
  if (row === col) return a + a;
  return row < col ? a + b + 's' : b + a + 'o';
}

export const ALL_CLASSES: HandClass[] = (() => {
  const out: HandClass[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(gridLabel(r, c));
  return out;
})();

export interface ClassInfo {
  hi: number; // rank index 0..12 (deuce..ace)
  lo: number;
  kind: 'pair' | 'suited' | 'offsuit';
}

export function classInfo(cls: HandClass): ClassInfo {
  const hi = RANKS.indexOf(cls[0]);
  const lo = RANKS.indexOf(cls[1]);
  if (hi < 0 || lo < 0) throw new Error(`Bad hand class "${cls}"`);
  if (hi === lo) return { hi, lo, kind: 'pair' };
  if (cls[2] === 's') return { hi, lo, kind: 'suited' };
  if (cls[2] === 'o') return { hi, lo, kind: 'offsuit' };
  throw new Error(`Bad hand class "${cls}"`);
}

export function makeClass(hi: number, lo: number, kind: ClassInfo['kind']): HandClass {
  if (lo > hi) [hi, lo] = [lo, hi];
  if (kind === 'pair' || hi === lo) return RANKS[hi] + RANKS[hi];
  return RANKS[hi] + RANKS[lo] + (kind === 'suited' ? 's' : 'o');
}

/** Hand class of two specific hole cards. */
export function classOfCards(a: Card, b: Card): HandClass {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra === rb) return RANKS[ra] + RANKS[ra];
  return makeClass(ra, rb, suitOf(a) === suitOf(b) ? 'suited' : 'offsuit');
}

/** Number of combos of a class with no dead cards: 6 / 4 / 12. */
export function classComboCount(cls: HandClass): number {
  const k = classInfo(cls).kind;
  return k === 'pair' ? 6 : k === 'suited' ? 4 : 12;
}

/** All specific 2-card combos for a class, excluding any that use a dead card. */
export function classCombos(cls: HandClass, dead: Iterable<Card> = []): [Card, Card][] {
  const d = new Set(dead);
  const { hi, lo, kind } = classInfo(cls);
  const out: [Card, Card][] = [];
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (kind === 'pair' && s2 <= s1) continue;
      if (kind === 'suited' && s1 !== s2) continue;
      if (kind === 'offsuit' && s1 === s2) continue;
      const a = makeCard(hi, s1);
      const b = makeCard(lo, s2);
      if (d.has(a) || d.has(b)) continue;
      out.push([a, b]);
    }
  }
  return out;
}

// ---------------- parsing ----------------

function addClass(r: Range, cls: HandClass, w: number) {
  r.set(cls, Math.max(r.get(cls) ?? 0, w));
}

function parseToken(tok: string, r: Range) {
  let w = 1;
  const wm = tok.match(/^(.*?)(?::([\d.]+)|@([\d.]+))$/);
  if (wm) {
    tok = wm[1];
    w = wm[2] !== undefined ? parseFloat(wm[2]) : parseFloat(wm[3]) / 100;
    if (!(w >= 0 && w <= 1)) throw new Error(`Bad weight in "${tok}"`);
  }
  const t = tok.trim();
  if (!t) return;
  if (/^(random|any|100%)$/i.test(t)) {
    for (const c of ALL_CLASSES) addClass(r, c, w);
    return;
  }
  const norm = (s: string) => s[0].toUpperCase() + s[1].toUpperCase() + s.slice(2).toLowerCase();

  // Range with dash: 77-99, A2s-A5s, K9o-KJo
  const dash = t.match(/^([2-9TJQKA]{2}[so]?)-([2-9TJQKA]{2}[so]?)$/i);
  if (dash) {
    const a = norm(dash[1]);
    const b = norm(dash[2]);
    const ia = RANKS.indexOf(a[0]);
    const ja = RANKS.indexOf(a[1]);
    const ib = RANKS.indexOf(b[0]);
    const jb = RANKS.indexOf(b[1]);
    if (ia === ja && ib === jb) {
      for (let x = Math.min(ia, ib); x <= Math.max(ia, ib); x++) addClass(r, RANKS[x] + RANKS[x], w);
      return;
    }
    if (ia !== ib || (a[2] ?? '') !== (b[2] ?? '')) throw new Error(`Bad range "${t}"`);
    for (let x = Math.min(ja, jb); x <= Math.max(ja, jb); x++) addSuitedness(r, ia, x, a[2], w);
    return;
  }
  // Plus: 22+, A2s+, KTo+, AT+
  const plus = t.match(/^([2-9TJQKA]{2}[so]?)\+$/i);
  if (plus) {
    const a = norm(plus[1]);
    const i = RANKS.indexOf(a[0]);
    const j = RANKS.indexOf(a[1]);
    if (i === j) {
      for (let x = i; x <= 12; x++) addClass(r, RANKS[x] + RANKS[x], w);
    } else {
      const hi = Math.max(i, j);
      const lo = Math.min(i, j);
      for (let x = lo; x < hi; x++) addSuitedness(r, hi, x, a[2], w);
    }
    return;
  }
  const single = t.match(/^([2-9TJQKA]{2}[so]?)$/i);
  if (single) {
    const a = norm(single[1]);
    const i = RANKS.indexOf(a[0]);
    const j = RANKS.indexOf(a[1]);
    if (i === j) addClass(r, a.slice(0, 2), w);
    else addSuitedness(r, Math.max(i, j), Math.min(i, j), a[2], w);
    return;
  }
  throw new Error(`Cannot parse range token "${t}"`);
}

function addSuitedness(r: Range, hi: number, lo: number, s: string | undefined, w: number) {
  if (hi === lo) {
    addClass(r, RANKS[hi] + RANKS[hi], w);
    return;
  }
  if (!s || s === 's') addClass(r, makeClass(hi, lo, 'suited'), w);
  if (!s || s === 'o') addClass(r, makeClass(hi, lo, 'offsuit'), w);
}

/** Parse standard notation, e.g. "22+, A2s+, KTo+, 76s, AQo:0.5". */
export function parseRange(text: string): Range {
  const r: Range = new Map();
  for (const tok of text.split(/[,\s]+/)) if (tok.trim()) parseToken(tok, r);
  return r;
}

// ---------------- stats ----------------

/** Weighted combo count of a range after removing combos blocked by dead cards. */
export function rangeComboCount(r: Range, dead: Iterable<Card> = []): number {
  const d = [...dead];
  let n = 0;
  for (const [cls, w] of r) n += w * classCombos(cls, d).length;
  return n;
}

/** Fraction of all 1,326 starting combos (no dead cards). */
export function rangePercent(r: Range): number {
  return rangeComboCount(r) / 1326;
}

export interface WeightedCombo {
  cards: [Card, Card];
  weight: number;
  cls: HandClass;
}

export function expandRange(r: Range, dead: Iterable<Card> = []): WeightedCombo[] {
  const d = [...dead];
  const out: WeightedCombo[] = [];
  for (const [cls, w] of r) {
    if (w <= 0) continue;
    for (const cards of classCombos(cls, d)) out.push({ cards, weight: w, cls });
  }
  return out;
}

// ---------------- formatting ----------------

/** Compress a range back to standard notation (weights shown as ":w" when < 1). */
export function formatRange(r: Range): string {
  const parts: string[] = [];
  const byWeight = new Map<number, Set<HandClass>>();
  for (const [cls, w] of r) {
    if (w <= 0) continue;
    if (!byWeight.has(w)) byWeight.set(w, new Set());
    byWeight.get(w)!.add(cls);
  }
  const weights = [...byWeight.keys()].sort((a, b) => b - a);
  for (const w of weights) {
    const set = byWeight.get(w)!;
    const suffix = w < 1 ? `:${+w.toFixed(3)}` : '';
    // pairs
    const runs: string[] = [];
    let x = 12;
    while (x >= 0) {
      if (!set.has(RANKS[x] + RANKS[x])) {
        x--;
        continue;
      }
      const top = x;
      while (x >= 0 && set.has(RANKS[x] + RANKS[x])) x--;
      const bottom = x + 1;
      const tp = RANKS[top] + RANKS[top];
      const bp = RANKS[bottom] + RANKS[bottom];
      if (top === 12 && bottom < 12) runs.push(bp + '+');
      else if (top === bottom) runs.push(tp);
      else runs.push(`${tp}-${bp}`);
    }
    // non-pairs per high card and suitedness
    for (let hi = 12; hi >= 1; hi--) {
      for (const kind of ['suited', 'offsuit'] as const) {
        const ch = kind === 'suited' ? 's' : 'o';
        let lo = hi - 1;
        while (lo >= 0) {
          if (!set.has(makeClass(hi, lo, kind))) {
            lo--;
            continue;
          }
          const top = lo;
          while (lo >= 0 && set.has(makeClass(hi, lo, kind))) lo--;
          const bottom = lo + 1;
          const tl = RANKS[hi] + RANKS[top] + ch;
          const bl = RANKS[hi] + RANKS[bottom] + ch;
          if (top === hi - 1 && bottom < top) runs.push(bl + '+');
          else if (top === bottom) runs.push(tl);
          else runs.push(`${tl}-${bl}`);
        }
      }
    }
    parts.push(...runs.map((s) => s + suffix));
  }
  return parts.join(', ');
}

/** Rank of hand classes by preflop all-in equity vs a random hand is computed elsewhere (see preflopRank). */
export function isInRange(r: Range, cls: HandClass): boolean {
  return (r.get(cls) ?? 0) > 0;
}
