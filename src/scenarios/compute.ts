// Shared computations for spots: villain combos, numbers, and equity-based grading.
// Used by the UI (equity in the worker) and by tests (synchronously).
import type { Card } from '../engine/cards';
import { parseRange, type WeightedCombo, classOfCards } from '../engine/range';
import { filteredCombos, features, type HandFeatures } from '../engine/handclass';
import { equityVsCombos, type EquityResult } from '../engine/equity';
import { drawOuts } from '../engine/outs';
import { requiredEquity, evCall, hitProbability } from '../engine/odds';
import type { Grade } from '../store/progress';
import type { Spot, SpotNumbers, VillainSpec, Option } from './types';
import { resolveRange } from '../data/charts';

/** Expand a villain spec into weighted combos on the spot's board, removing hero/board blockers. */
export function villainCombos(v: VillainSpec, hero: Card[], board: Card[]): WeightedCombo[] {
  const map = new Map<string, WeightedCombo>();
  for (const p of v.parts) {
    const w = p.weight ?? 1;
    for (const c of filteredCombos(parseRange(resolveRange(p.range)), board, hero, p.filter ?? 'all')) {
      const key = c.cards.slice().sort((a, b) => a - b).join(',');
      const prev = map.get(key);
      const weight = c.weight * w;
      if (!prev || prev.weight < weight) map.set(key, { ...c, weight });
    }
  }
  return [...map.values()];
}

export function staticNumbers(spot: Spot): SpotNumbers {
  const n: SpotNumbers = { spr: spot.pot > 0 ? spot.effStack / spot.pot : Infinity };
  if (spot.toCall > 0) n.requiredEquity = requiredEquity(spot.toCall, spot.pot + spot.toCall);
  if (spot.villain) n.villainCombos = villainCombos(spot.villain, spot.hero, spot.board).reduce((s, c) => s + c.weight, 0);
  if (spot.board.length === 3 || spot.board.length === 4) {
    const r = drawOuts(spot.hero, spot.board);
    if (r.outs.length) {
      const unseen = 52 - 2 - spot.board.length;
      n.outs = {
        all: r.outs.map((o) => o.card),
        clean: r.clean,
        dirty: r.outs.filter((o) => o.dirty).map((o) => ({ card: o.card, reasons: o.reasons })),
        next: hitProbability(r.outs.length, unseen, 1),
        byRiver: spot.board.length === 3 ? hitProbability(r.outs.length, unseen, 2) : undefined,
      };
    }
  }
  return n;
}

export function withEquity(n: SpotNumbers, spot: Spot, eq: EquityResult): SpotNumbers {
  const out = { ...n, equity: eq.equity, equityExact: eq.exact, win: eq.win, tie: eq.tie };
  if (spot.toCall > 0) out.evCall = evCall(eq.equity, spot.pot + spot.toCall, spot.toCall);
  return out;
}

/** Synchronous equity for tests / scripts. */
export function spotEquity(spot: Spot): EquityResult | null {
  if (!spot.villain) return null;
  return equityVsCombos(spot.hero, villainCombos(spot.villain, spot.hero, spot.board), spot.board, { seed: 12345, iterations: 200_000 });
}

export const CLOSE_MARGIN = 0.03; // ±3 equity points counts as a close decision

/**
 * Equity-based grading for facing-a-bet decisions (Mode B math spots):
 *  - margin = equity − required equity.
 *  - margin ≥ +3pts: call is best (raise best instead when equity ≥ 60%); folding is a mistake.
 *  - |margin| < 3pts: close — calling and folding are both acceptable.
 *  - margin ≤ −3pts: fold is best; calling is a mistake. A raise is acceptable as a semi-bluff only with a strong draw (≥ 8 outs) before the river.
 */
export function gradeByEquity(eq: number, req: number, opts: { options: Option[]; strongDraw: boolean; street: Spot['street'] }): { grades: Record<string, Grade>; best: string } {
  const margin = eq - req;
  const grades: Record<string, Grade> = {};
  const raiseKeys = opts.options.filter((o) => o.kind === 'raise').map((o) => o.key);
  const set = (k: string, g: Grade) => {
    grades[k] = g;
  };
  let best: string;
  if (margin >= CLOSE_MARGIN) {
    set('fold', 'mistake');
    if (eq >= 0.6 && raiseKeys.length) {
      raiseKeys.forEach((k) => set(k, 'best'));
      set('call', 'ok');
      best = raiseKeys[0];
    } else {
      set('call', 'best');
      raiseKeys.forEach((k) => set(k, eq >= 0.5 || (opts.strongDraw && opts.street !== 'river') ? 'ok' : 'mistake'));
      best = 'call';
    }
  } else if (margin > -CLOSE_MARGIN) {
    set('call', 'ok');
    set('fold', 'ok');
    raiseKeys.forEach((k) => set(k, opts.strongDraw && opts.street !== 'river' ? 'ok' : 'mistake'));
    best = margin >= 0 ? 'call' : 'fold';
  } else {
    set('fold', 'best');
    set('call', 'mistake');
    raiseKeys.forEach((k) => set(k, opts.strongDraw && opts.street !== 'river' ? 'ok' : 'mistake'));
    best = 'fold';
  }
  return { grades, best };
}

export function isStrongDraw(f: HandFeatures, board: Card[]): boolean {
  return board.length < 5 && (f.flushDraw || f.oesd);
}

export function handFamily(hero: Card[]): string {
  const cls = classOfCards(hero[0], hero[1]);
  const hi = '23456789TJQKA'.indexOf(cls[0]);
  const lo = '23456789TJQKA'.indexOf(cls[1]);
  if (cls.length === 2) return 'pocket-pair';
  const suited = cls[2] === 's';
  if (hi === 12) return suited ? 'suited-ace' : 'offsuit-ace';
  if (lo >= 8) return suited ? 'suited-broadway' : 'offsuit-broadway';
  if (hi - lo === 1 && suited) return 'suited-connector';
  if (suited) return 'suited-other';
  return 'offsuit-other';
}

export function heroFeatures(spot: Spot) {
  return spot.board.length ? features(spot.hero, spot.board) : null;
}
