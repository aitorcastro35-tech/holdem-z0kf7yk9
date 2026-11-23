// Range Explorer core: for each of the 169 starting hands, the EV of each option vs a villain hand or range.
//
// EXACT (chip EV, measured from the decision point; folding = 0):
//   - facing an all-in (call / fold), push-or-fold (shove / fold) and river calls:
//     EV(call)  = equity × final pot − amount called
//     EV(shove) = P(fold)·pot now + P(call)·(equity vs calling range × final pot − amount added)
//   Equity is combo-level with card removal: each of your specific combos removes villain combos it blocks, and a
//   grid cell averages its suit combos (6 / 4 / 12, fewer if the board blocks some).
// MODEL-BASED (assumptions are inputs shown in the UI):
//   - calls that see more streets: EV(call) = realization × equity × final pot − call  (rough "equity realization")
//   - raises / 3-bets: villain folds, calls (continuing range) or re-raises (you fold) per the response model.
import type { Card } from '../engine/cards';
import { classCombos, classComboCount, ALL_CLASSES, classOfCards, type HandClass } from '../engine/range';
import { evaluate } from '../engine/evaluator';
import { RANKING } from '../bot/ranges';

export type SpotType = 'allin-call' | 'vs-raise' | 'postflop' | 'push-fold';
export type ExAction = 'fold' | 'call' | 'raise' | 'shove';

export interface ResponseModel {
  mode: 'fold-pct' | 'top-n';
  foldPct: number; // 0..1 (mode fold-pct)
  continuePct: number; // 0..1 of villain's range (by weight) that continues (mode top-n)
  reraisePct: number; // 0..1 of the continuing part that re-raises (you then fold)
}

export interface ExplorerInput {
  spot: SpotType;
  villainCombos: { cards: [Card, Card]; w: number }[]; // range (or a single combo) before removing your cards
  board: Card[]; // postflop only
  // money (bb). Everything already in the middle when you decide counts as pot.
  potBefore: number; // chips in the middle before your decision (incl. villain's bet/shove and your posted blind)
  heroPosted: number; // your chips already in (blind) — sunk
  villainPosted?: number; // villain's chips already in the pot before your decision (push-fold: his blind)
  toCall: number; // chips you must add to call (allin-call / vs-raise / postflop)
  heroBehind: number; // your chips behind (not yet in the pot)
  villainBehind: number; // villain's chips behind after his bet/shove
  raiseTo?: number; // your raise / 3-bet total for this street (vs-raise / postflop)
  villainCommitted?: number; // villain's chips in on this street (to size the call of a raise)
  heroCommitted?: number; // your chips in on this street before acting
  // push-fold: villain's calling range; P(call) uses villain's full range (any two cards) by default
  callCombos?: { cards: [Card, Card]; w: number }[];
  response: ResponseModel;
  realization: number; // multiplier on equity for calls that see more streets (1 = none)
  raiseRealization: number; // same, after your raise is called
}

export interface CellResult {
  cls: HandClass;
  combos: number; // your available combos (after board / exact-hand blockers)
  equity: number; // vs villain's range (call scenario) — or vs calling range (push-fold)
  ev: Partial<Record<ExAction, number>>;
  best: ExAction;
  margin: number; // EV(best) − EV(second best)
  foldPct?: number; // villain's fold probability vs your raise / shove (card-removal aware)
  breakEvenFold?: number; // fold % needed for a pure bluff raise / shove to break even
  eqVsContinue?: number;
}

/** Equity of a specific hero combo vs a specific villain combo (exact preflop table, or computed on a board). */
export type PairEquity = (hero: [Card, Card], vill: [Card, Card]) => number;
/** Equity of a hero combo vs weighted villain combos (used postflop where a pair-table is not available). */
export type RangeEquity = (hero: [Card, Card], vill: { cards: [Card, Card]; w: number }[]) => number;

const blocks = (a: [Card, Card], b: [Card, Card]) => a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1];

/** Strength order for "villain continues with the top N%": preflop by the 169-hand order, postflop by made hand on the board. */
export function strengthKey(c: [Card, Card], board: Card[]): number {
  if (board.length >= 3) return evaluate([...c, ...board]);
  const i = RANKING.indexOf(classOfCards(c[0], c[1]));
  return 1000 - i;
}

/** Split villain combos (already card-removed) into fold / call / re-raise parts per the response model. */
export function splitResponse(vill: { cards: [Card, Card]; w: number }[], board: Card[], m: ResponseModel) {
  const total = vill.reduce((s, c) => s + c.w, 0);
  if (m.mode === 'fold-pct') {
    const cont = 1 - m.foldPct;
    return {
      foldP: m.foldPct,
      callP: cont * (1 - m.reraisePct),
      reraiseP: cont * m.reraisePct,
      callers: vill.map((c) => ({ ...c, w: c.w * cont * (1 - m.reraisePct) })),
      total,
    };
  }
  const sorted = vill.slice().sort((a, b) => strengthKey(b.cards, board) - strengthKey(a.cards, board));
  let acc = 0;
  const contW = total * m.continuePct;
  const reW = contW * m.reraisePct;
  const callers: { cards: [Card, Card]; w: number }[] = [];
  let reraise = 0;
  let call = 0;
  for (const c of sorted) {
    if (acc >= contW - 1e-9) break;
    const take = Math.min(c.w, contW - acc);
    // the strongest part of the continuing range re-raises
    const reTake = Math.max(0, Math.min(take, reW - acc));
    reraise += reTake;
    const callTake = take - reTake;
    if (callTake > 0) callers.push({ cards: c.cards, w: callTake });
    call += callTake;
    acc += take;
  }
  return { foldP: total ? 1 - (reraise + call) / total : 1, callP: total ? call / total : 0, reraiseP: total ? reraise / total : 0, callers, total };
}

function weightedEq(hero: [Card, Card], vill: { cards: [Card, Card]; w: number }[], pairEq?: PairEquity, rangeEq?: RangeEquity): number {
  if (rangeEq) return rangeEq(hero, vill);
  let s = 0;
  let w = 0;
  for (const v of vill) {
    s += v.w * pairEq!(hero, v.cards);
    w += v.w;
  }
  return w ? s / w : 0;
}

/** EV of each option for ONE specific hero combo. */
export function comboEV(hero: [Card, Card], inp: ExplorerInput, pairEq?: PairEquity, rangeEq?: RangeEquity) {
  const vill = inp.villainCombos.filter((v) => !blocks(hero, v.cards) && !inp.board.includes(v.cards[0]) && !inp.board.includes(v.cards[1]) && v.w > 0);
  const out: { ev: Partial<Record<ExAction, number>>; equity: number; foldPct?: number; breakEvenFold?: number; eqVsContinue?: number } = { ev: { fold: 0 }, equity: 0 };
  if (!vill.length) return out;

  if (inp.spot === 'push-fold') {
    // villain calls with callCombos (weights) out of his full range (inp.villainCombos)
    const callers = (inp.callCombos ?? []).filter((v) => !blocks(hero, v.cards) && v.w > 0);
    const total = vill.reduce((s, c) => s + c.w, 0);
    const callW = callers.reduce((s, c) => s + c.w, 0);
    const pCall = total ? Math.min(1, callW / total) : 0;
    const eq = callers.length ? weightedEq(hero, callers, pairEq, rangeEq) : 0;
    // both stacks go in up to the effective (smaller) total; the bigger stack's excess goes back
    const heroTotal = inp.heroPosted + inp.heroBehind;
    const villTotal = (inp.villainPosted ?? 0) + inp.villainBehind;
    const eff = Math.min(heroTotal, villTotal);
    const finalPot = inp.potBefore - inp.heroPosted - (inp.villainPosted ?? 0) + 2 * eff;
    const invested = eff - inp.heroPosted;
    out.ev.shove = (1 - pCall) * inp.potBefore + pCall * (eq * finalPot - invested);
    out.equity = eq;
    out.foldPct = 1 - pCall;
    out.breakEvenFold = invested / (invested + inp.potBefore);
    return out;
  }

  const eq = weightedEq(hero, vill, pairEq, rangeEq);
  out.equity = eq;
  const call = Math.min(inp.toCall, inp.heroBehind);
  // the villain's uncalled excess (if you're all-in for less) goes back to him
  const excess = Math.max(0, inp.toCall - inp.heroBehind);
  const potAfterCall = inp.potBefore - excess + call;
  const exact = inp.spot === 'allin-call' || (inp.spot === 'postflop' && inp.board.length === 5) || call >= inp.heroBehind;
  out.ev.call = (exact ? 1 : inp.realization) * eq * potAfterCall - call;

  if ((inp.spot === 'vs-raise' || inp.spot === 'postflop') && inp.raiseTo && inp.heroBehind > call) {
    const heroIn = inp.heroCommitted ?? 0;
    const add = Math.min(inp.raiseTo - heroIn, inp.heroBehind); // chips you add by raising
    const villIn = inp.villainCommitted ?? inp.toCall + heroIn;
    const villAdd = Math.min(Math.max(0, heroIn + add - villIn), inp.villainBehind);
    const r = splitResponse(vill, inp.board, inp.response);
    const eqC = r.callers.length ? weightedEq(hero, r.callers, pairEq, rangeEq) : 0;
    const finalPot = inp.potBefore + add + villAdd;
    const allInRaise = add >= inp.heroBehind || villAdd >= inp.villainBehind;
    const realize = allInRaise || inp.board.length === 5 ? 1 : inp.raiseRealization;
    out.ev.raise = r.foldP * inp.potBefore + r.callP * (realize * eqC * finalPot - add) + r.reraiseP * -add;
    out.foldPct = r.foldP;
    out.breakEvenFold = add / (add + inp.potBefore);
    out.eqVsContinue = eqC;
  }
  return out;
}

/** All 169 cells. `onProgress` is called with 0..1. */
export function computeGrid(inp: ExplorerInput, pairEq?: PairEquity, rangeEq?: RangeEquity, onProgress?: (p: number) => void): CellResult[] {
  const dead = new Set(inp.board);
  // an exact villain hand also removes your combos that contain its cards
  if (inp.villainCombos.length === 1) inp.villainCombos[0].cards.forEach((c) => dead.add(c));
  const out: CellResult[] = [];
  ALL_CLASSES.forEach((cls, i) => {
    const combos = classCombos(cls, [...dead]);
    const sums: Partial<Record<ExAction, number>> = {};
    let eq = 0;
    let fold = 0;
    let be = 0;
    let eqc = 0;
    let n = 0;
    for (const c of combos) {
      const r = comboEV(c, inp, pairEq, rangeEq);
      for (const [k, v] of Object.entries(r.ev)) sums[k as ExAction] = (sums[k as ExAction] ?? 0) + (v as number);
      eq += r.equity;
      fold += r.foldPct ?? 0;
      be += r.breakEvenFold ?? 0;
      eqc += r.eqVsContinue ?? 0;
      n++;
    }
    const ev: Partial<Record<ExAction, number>> = {};
    for (const [k, v] of Object.entries(sums)) ev[k as ExAction] = n ? (v as number) / n : 0;
    const ranked = (Object.entries(ev) as [ExAction, number][]).sort((a, b) => b[1] - a[1]);
    out.push({
      cls,
      combos: n,
      equity: n ? eq / n : 0,
      ev,
      best: ranked[0]?.[0] ?? 'fold',
      margin: ranked.length > 1 ? ranked[0][1] - ranked[1][1] : 0,
      foldPct: n && (inp.spot === 'push-fold' || inp.raiseTo) ? fold / n : undefined,
      breakEvenFold: n && (inp.spot === 'push-fold' || inp.raiseTo) ? be / n : undefined,
      eqVsContinue: n && inp.raiseTo ? eqc / n : undefined,
    });
    onProgress?.((i + 1) / ALL_CLASSES.length);
  });
  return out;
}

export interface Summary {
  pct: Partial<Record<ExAction, number>>; // share of available combos whose best action is X
  totalCombos: number;
  close: HandClass[]; // within ±0.1bb of the next option
}

export const CLOSE_BB = 0.1;

export function summarize(cells: CellResult[]): Summary {
  const total = cells.reduce((s, c) => s + c.combos, 0);
  const pct: Partial<Record<ExAction, number>> = {};
  for (const c of cells) if (c.combos) pct[c.best] = (pct[c.best] ?? 0) + c.combos / total;
  return { pct, totalCombos: total, close: cells.filter((c) => c.combos && Math.abs(c.margin) <= CLOSE_BB).map((c) => c.cls) };
}

export const maxCombos = classComboCount;
