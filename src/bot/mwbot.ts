// Multiway rule-based bot (2–6 players): plays sensibly, NOT perfectly — and multiway is where simple rules are
// weakest. It sees only a MWBotView: its own cards + public information (never other players' cards or the undealt
// board). Heads-up (one opponent) uses the same thresholds as the heads-up bot.
//
// Documented multiway adjustments (heuristics written for this app, see SOURCES.md §10):
//  - Equity is vs ALL remaining opponents' estimated ranges together (Monte Carlo, capped iterations + time budget).
//  - Fair share = 1 / (players in the pot). Value threshold = fair share × (1.5 + 0.15 per extra opponent)
//    (heads-up: 0.5 × 1.5 = 75%, 3-way: 0.33 × 1.65 = 55%, 4-way: 0.25 × 1.8 = 45%, 6-way: 0.167 × 2.1 = 35%).
//  - Bluff / semi-bluff / stab frequencies × 0.5 for each extra opponent.
//  - Facing a bet: required equity = call ÷ (pot after calling), +3 points per player still to act behind
//    (they can raise or overcall). The MDF guard against small bets applies heads-up only.
//  - Preflop spots the charts don't cover: iso-raise over limpers with the top 12%; overcall with the heads-up calling
//    band ×0.7 per caller (pairs and suited connectors kept for implied odds); squeeze with the top max(2%, 3-bet% ×
//    (1 − 0.25 per caller)) to 3× the open + 1 open per caller (+1 out of position).
//  - "Action table" (training convenience, not realistic): opening and calling ranges ×1.35 by combos.
import type { Card } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { classOfCards, type HandClass } from '../engine/range';
import { features, describeFeatures } from '../engine/handclass';
import { Category } from '../engine/evaluator';
import type { EquityResult } from '../engine/equity';
import { requiredEquity, mdf } from '../engine/odds';
import { CHARTS, chartAction, findChart, type Position } from '../data/charts';
import { mwLegal, mwTotalPot, mwToCall, actingOrder, type MWState, type MWAction, type MWActionType, type MWLegal } from '../engine/multiway';
import { estimateRange, topPct, openRangeFor, rangePct, isInPosition, classWeights, totalWeight } from './ranges';
import { isStrongDraw } from '../scenarios/compute';
import { STYLES, type BotStyle, type Bucket } from './bot';

export { STYLES };

export interface MWBotView {
  seat: number;
  positions: string[];
  myCards: Card[];
  board: Card[];
  street: number;
  pot: number;
  toCall: number;
  stacks: number[]; // bb behind, public
  committed: number[]; // bb this street, public
  folded: boolean[]; // public
  legal: MWLegal;
  history: MWAction[];
  playersBehind: number; // active players still to act after me this round
  decisionIndex: number;
}

/** Build a bot's view from the state: own cards + public information only. */
export function mwBotView(st: MWState, seat: number, decisionIndex: number): MWBotView {
  const order = actingOrder(st.cfg, st.street);
  const after = order.slice(order.indexOf(seat) + 1);
  const playersBehind = after.filter((s) => !st.folded[s] && st.stack[s] > 0 && st.needAct[s]).length;
  return {
    seat,
    positions: st.cfg.positions.slice(),
    myCards: st.holes[seat].slice(),
    board: st.board.slice(),
    street: st.street,
    pot: mwTotalPot(st),
    toCall: mwToCall(st, seat),
    stacks: st.stack.map((c) => c / 100),
    committed: st.committed.map((c) => c / 100),
    folded: st.folded.slice(),
    legal: mwLegal(st),
    history: st.history.map((a) => ({ ...a })),
    playersBehind,
    decisionIndex,
  };
}

export interface MWBotLog {
  street: number;
  action: string;
  rule: string;
  bucket?: Bucket;
  hand?: string;
  equity?: number;
  required?: number;
  opponents: { seat: number; pos: string; combos: number; grid: [HandClass, number][] }[];
  heuristic: boolean; // true when the rule is a documented heuristic rather than a cited chart / pot-odds math
}

export interface MWBotDecision {
  type: MWActionType;
  to?: number;
  log: MWBotLog;
}

export type MultiEqFn = (myCards: Card[], ranges: { cards: [Card, Card]; weight: number }[][], board: Card[], seed: number) => Promise<EquityResult>;

export interface MWBotOptions {
  actionTable?: boolean;
}

export const ACTION_TABLE_WIDEN = 1.35;
const r1 = (x: number) => Math.round(x * 10) / 10;
export const fairShare = (opps: number) => 1 / (opps + 1);
export const valueThreshold = (opps: number) => fairShare(opps) * (1.5 + 0.15 * (opps - 1));
export const bluffFactor = (opps: number) => Math.pow(0.5, opps - 1);
export const behindPenalty = (behind: number) => 0.03 * behind;

function boardIsWet(board: Card[]): boolean {
  const suits = [0, 0, 0, 0];
  board.forEach((c) => suits[c & 3]++);
  const ranks = [...new Set(board.map((c) => c >> 2))].sort((a, b) => a - b);
  let connected = false;
  for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2] - ranks[i] <= 4) connected = true;
  return Math.max(...suits) >= 2 || connected;
}

export async function mwBotDecide(v: MWBotView, style: BotStyle, seed: number, eqFn: MultiEqFn, opts: MWBotOptions = {}): Promise<MWBotDecision> {
  const rng = mulberry32((seed * 7919 + v.decisionIndex * 104729 + v.seat * 15485863 + 17) >>> 0);
  const me = v.seat;
  const n = v.positions.length;
  const tableSize = n === 2 ? 2 : 6;
  const cfg = { tableSize, positions: v.positions };
  const myPos = v.positions[me];
  const L = v.legal;
  const cls = classOfCards(v.myCards[0], v.myCards[1]);
  const widen = opts.actionTable ? ACTION_TABLE_WIDEN : 1;
  const oppSeats = v.positions.map((_, i) => i).filter((i) => i !== me && !v.folded[i]);
  const ranges = oppSeats.map((s) => ({ seat: s, combos: estimateRange(cfg, s, v.history, v.board, v.myCards) }));
  const k = oppSeats.length;
  const baseLog = (heuristic: boolean) => ({
    street: v.street,
    heuristic,
    opponents: ranges.map((r) => ({ seat: r.seat, pos: v.positions[r.seat], combos: Math.round(totalWeight(r.combos)), grid: [...classWeights(r.combos)] as [HandClass, number][] })),
  });
  const mk = (type: MWActionType, action: string, rule: string, heuristic: boolean, extra: Partial<MWBotLog>, to?: number): MWBotDecision => ({ type, to, log: { ...baseLog(heuristic), action, rule, ...extra } });
  const check = (rule: string, h = false, x: Partial<MWBotLog> = {}) => mk('check', 'check', rule, h, x);
  const fold = (rule: string, h = false, x: Partial<MWBotLog> = {}) => (L.fold ? mk('fold', 'fold', rule, h, x) : check(rule + ' (checking is free)', h, x));
  const call = (rule: string, h = false, x: Partial<MWBotLog> = {}) => (L.call !== null ? mk('call', `call ${L.call}`, rule, h, x) : check(rule, h, x));
  const clampTo = (kind: 'bet' | 'raise', want: number) => {
    const r = kind === 'bet' ? L.bet! : L.raise!;
    let t = Math.max(r.min, Math.min(r.max, r1(want)));
    if (r.max - t < 0.15 * r.max || t > 0.85 * r.max) t = r.max;
    return Math.round(t * 100) / 100;
  };
  const raiseTo = (want: number, rule: string, h = false, x: Partial<MWBotLog> = {}) => {
    if (L.raise) {
      const t = clampTo('raise', want);
      return mk('raise', t >= L.raise.max ? `all-in ${t}` : `raise to ${t}`, rule, h, x, t);
    }
    if (L.bet) {
      const t = clampTo('bet', want);
      return mk('bet', t >= L.bet.max ? `all-in ${t}` : `bet ${t}`, rule, h, x, t);
    }
    return call(rule + ' (raising not allowed; calling)', h, x);
  };
  const betFrac = (frac: number, rule: string, h = false, x: Partial<MWBotLog> = {}) => {
    const f = Math.min(1, frac * style.sizeMult);
    if (L.bet) {
      const t = clampTo('bet', v.pot * f);
      return mk('bet', t >= L.bet.max ? `all-in ${t}` : `bet ${t} (${Math.round(f * 100)}% pot)`, rule, h, x, t);
    }
    return raiseTo(v.committed[me] + v.toCall + (v.pot + v.toCall) * f, rule, h, x);
  };

  // ---------------- PREFLOP ----------------
  if (v.street === 0) {
    const pre = v.history.filter((a) => a.street === 0);
    const raises = pre.filter((a) => a.type === 'raise');
    const myStackTotal = v.stacks[me] + v.committed[me];
    const effOpp = Math.max(...oppSeats.map((s) => v.stacks[s] + v.committed[s]));
    const eff = Math.min(myStackTotal, effOpp);
    const tbl = (tableSize === 2 ? 6 : 6) as 6;
    if (raises.length === 0) {
      const limpers = pre.filter((a) => a.type === 'call').length;
      if (myPos === 'BB' && v.toCall === 0) {
        if (topPct(Math.min(0.9, 0.12 * style.openWiden * widen)).has(cls)) return raiseTo(3 + limpers, 'BB raises over limpers with the top ~12% (heuristic)', true);
        return check('BB checks its option (outside the top ~12%)', true);
      }
      if (limpers > 0) {
        if (topPct(Math.min(0.9, 0.12 * style.openWiden * widen)).has(cls)) return raiseTo(3 + limpers, `Iso-raise over ${limpers} limper${limpers > 1 ? 's' : ''} with the top ~12% (heuristic)`, true);
        const open = openRangeFor(cfg, myPos);
        if (open && open.has(cls) && (cls.length === 2 || cls.endsWith('s'))) return call('Over-limps pairs and suited hands from its opening range (heuristic, implied odds)', true);
        return fold('Folds behind limpers (heuristic)', true);
      }
      const chart = findChart('rfi', tbl, (tableSize === 2 ? 'BTN' : myPos) as Position);
      let inRange = chart ? chartAction(chart, cls) !== 'fold' : false;
      const mixed = !!chart?.mixedActions && inRange;
      const w = style.openWiden * widen;
      if (!inRange && w > 1 && chart) inRange = topPct(Math.min(0.95, rangePct(openRangeFor(cfg, myPos)!) * w)).has(cls);
      if (!inRange) return fold(`${cls} is outside its ${myPos} opening range (${chart?.title ?? '—'}${w > 1 ? `, widened ×${w.toFixed(2)}` : ''})`, w > 1);
      if (mixed && rng() < 0.5) return call(`${cls} is in the SB "raise or call" range; no published split → completes 50% of the time`, true);
      if (eff <= 12) return raiseTo(9999, `${cls} opens; ≤12bb effective → shove`, true);
      return raiseTo(myPos === 'SB' ? 3 : 2.5, `${cls} is in its ${myPos} opening range (${chart?.title})${w > 1 ? ` (widened ×${w.toFixed(2)})` : ''}`, w > 1);
    }
    const last = raises[raises.length - 1];
    const lastIdx = pre.lastIndexOf(last);
    const callersAfter = pre.slice(lastIdx + 1).filter((a) => a.type === 'call').length;
    const raiserPos = v.positions[last.seat];
    const ip = isInPosition(cfg, myPos, raiserPos);
    const facingAllIn = v.history.some((a) => a.allIn && a.seat !== me);
    if (raises.length === 1 && !facingAllIn) {
      const openTo = last.amount;
      if (callersAfter === 0) {
        const ch = CHARTS.find((c) => c.kind === 'vsOpen' && c.hero === myPos && c.villain === raiserPos);
        const tb = ip ? openTo * 3 : openTo * 4;
        if (ch && widen === 1) {
          const a = chartAction(ch, cls);
          if (a === 'threebet' || (a === 'call' && ch.mixedActions && rng() < 0.25 * style.bluffMult)) return raiseTo(eff <= 25 ? 9999 : tb, `${ch.title}: ${cls} is a ${a === 'threebet' ? '3-bet' : 'defend hand, 3-bet part of the time'}`);
          if (a === 'call') return call(`${ch.title}: ${cls} is a call`);
          return fold(`${ch.title}: ${cls} is not in the continuing range`);
        }
        const opener = openRangeFor(cfg, raiserPos) ?? topPct(0.3);
        if (topPct(style.threeBetPct).has(cls) || (['A5s', 'A4s', 'A3s', 'A2s'].includes(cls) && rng() < 0.5 * style.bluffMult)) return raiseTo(eff <= 25 ? 9999 : tb, `No verified chart for ${myPos} vs ${raiserPos}: 3-bets the top ${Math.round(style.threeBetPct * 100)}% (heuristic)`, true);
        const kk = (myPos === 'BB' ? 2.0 : ip ? 0.7 : 0.5) * style.callWiden * widen;
        if (topPct(Math.min(0.9, rangePct(opener) * kk)).has(cls)) return call(`Calls inside a band ${Math.round(kk * 100)}% the size of the ${raiserPos} opening range (heuristic)`, true);
        return fold(`Outside its calling band vs a ${raiserPos} open (heuristic)`, true);
      }
      // open + callers: squeeze or overcall (heuristics)
      const sq = topPct(Math.max(0.02, style.threeBetPct * (1 - 0.25 * callersAfter)));
      if (sq.has(cls)) return raiseTo(eff <= 25 ? 9999 : openTo * (3 + callersAfter + (ip ? 0 : 1)), `Squeeze: top ${Math.round(Math.max(0.02, style.threeBetPct * (1 - 0.25 * callersAfter)) * 100)}% vs an open and ${callersAfter} caller${callersAfter > 1 ? 's' : ''} (heuristic)`, true);
      const opener = openRangeFor(cfg, raiserPos) ?? topPct(0.3);
      const kk = (myPos === 'BB' ? 2.0 : ip ? 0.7 : 0.5) * Math.pow(0.7, callersAfter) * style.callWiden * widen;
      const speculative = cls.length === 2 || (cls.endsWith('s') && Math.abs('23456789TJQKA'.indexOf(cls[0]) - '23456789TJQKA'.indexOf(cls[1])) === 1);
      if (topPct(Math.min(0.9, rangePct(opener) * kk)).has(cls) || (speculative && eff >= 40 && topPct(0.5).has(cls))) return call(`Overcall: calling band ×0.7 per caller; pairs and suited connectors kept with deep stacks (heuristic)`, true);
      return fold('Folds to an open with callers (tightened band, heuristic)', true);
    }
    if (raises.length === 2 && !facingAllIn) {
      const iOpened = raises[0].seat === me;
      if (topPct(iOpened ? 0.025 : 0.02).has(cls)) return raiseTo(eff <= 60 ? 9999 : last.amount * 2.3, `Facing a 3-bet: 4-bets the top ${iOpened ? '2.5' : '2'}% (heuristic; no verified vs-3-bet chart)`, true);
      if (topPct((iOpened ? 0.12 : 0.05) * style.callWiden * Math.pow(0.8, callersAfter)).has(cls)) return call(`Facing a 3-bet: calls with the top ~${iOpened ? 12 : 5}%${callersAfter ? ' (tighter with callers)' : ''} (heuristic)`, true);
      return fold('Facing a 3-bet: folds (heuristic)', true);
    }
  }

  // ---------------- equity-based: facing 4-bets / all-ins preflop, every postflop decision ----------------
  const rangeArgs = ranges.map((r) => r.combos.map((c) => ({ cards: c.cards, weight: c.w })));
  const eqRes = await eqFn(v.myCards, rangeArgs, v.board, (seed * 31 + v.decisionIndex * 7 + me) >>> 0);
  const eq = eqRes.equity;
  const fs = fairShare(k);
  const valueEq = valueThreshold(k);
  const bf = bluffFactor(k);
  const f = v.street > 0 ? features(v.myCards, v.board) : null;
  const madeStrong = !!f && f.category >= Category.TwoPair && f.improvesBoard;
  const draw = !!f && isStrongDraw(f, v.board);
  let bucket: Bucket;
  if (v.street === 0) bucket = eq >= valueEq ? 'strong' : eq >= fs ? 'medium' : 'air';
  else if ((madeStrong && eq >= fs * 1.2) || eq >= valueEq) bucket = 'strong';
  else if (draw && eq < valueEq) bucket = 'draw';
  else if ((f && f.category >= Category.Pair && f.improvesBoard) || eq >= fs) bucket = 'medium';
  else bucket = 'air';
  const hand = v.street > 0 ? describeFeatures(f!) : cls;
  const info = { bucket, equity: eq, hand };
  const mw = k > 1 ? ` vs ${k} opponents (fair share ${Math.round(fs * 100)}%)` : '';

  if (v.toCall > 0) {
    const callAmt = Math.min(v.toCall, v.stacks[me]);
    const req = requiredEquity(callAmt, v.pot + callAmt);
    const need = req + behindPenalty(v.playersBehind);
    const bonus = draw && v.street < 3 ? style.impliedBonus : 0;
    const x = { ...info, required: req };
    if (bucket === 'strong' && eq >= valueEq && L.raise && rng() < 0.6) return raiseTo(v.committed[me] + v.toCall + (v.pot + v.toCall), `Strong hand (${Math.round(eq * 100)}%${mw}) facing a bet: raises for value`, false, x);
    if (eq + bonus >= need)
      return call(`Equity ${Math.round(eq * 100)}%${bonus ? ` (+${Math.round(bonus * 100)} implied odds for a draw)` : ''} ≥ ${Math.round(need * 100)}% needed (price ${Math.round(req * 100)}%${v.playersBehind ? ` + ${Math.round(behindPenalty(v.playersBehind) * 100)} for ${v.playersBehind} player${v.playersBehind > 1 ? 's' : ''} behind` : ''})`, v.playersBehind > 0 || bonus > 0, x);
    if (style.stickyTopPair && f && (f.pair === 'top' || f.pair === 'overpair' || madeStrong)) return call('Calling-station style: never folds top pair or better', true, x);
    const betFracFaced = v.toCall / Math.max(0.01, v.pot - v.toCall);
    if (k === 1 && v.street > 0 && betFracFaced <= 0.4 && (bucket === 'medium' || draw) && eq >= req - 0.05)
      return call(`MDF guard (heads-up only): vs a ${Math.round(betFracFaced * 100)}% pot bet (MDF ${Math.round(mdf(1, betFracFaced) * 100)}%) it keeps pairs and draws close to the price`, true, x);
    return fold(`Equity ${Math.round(eq * 100)}%${mw} < ${Math.round(need * 100)}% needed`, v.playersBehind > 0, x);
  }

  // no bet to face
  const wet = boardIsWet(v.board);
  const spr = Math.min(v.stacks[me], ...oppSeats.map((s) => v.stacks[s])) / Math.max(0.01, v.pot);
  const valueFrac = spr <= 1.2 ? 1.5 : v.street === 3 ? (eq >= Math.min(0.95, valueEq + 0.15) ? 1 : 0.75) : wet ? 0.75 : v.street === 1 ? 0.33 : 0.5;
  if (bucket === 'strong') {
    if (rng() < style.valueBetProb) return betFrac(valueFrac, `Value bet: equity ${Math.round(eq * 100)}% ≥ value threshold ${Math.round(valueEq * 100)}%${mw}`, k > 1, info);
    return check('Strong hand: occasional slow-play', false, info);
  }
  if (bucket === 'medium') {
    const p = (v.street === 3 ? 0.15 : 0.35) * bf;
    if (rng() < p) return betFrac(v.street === 1 ? 0.33 : 0.5, `Medium hand: small bet ${Math.round(p * 100)}% of the time${k > 1 ? ' (halved per extra opponent)' : ''}`, true, info);
    return check(`Medium hand: check${mw}`, k > 1, info);
  }
  if (bucket === 'draw') {
    const p = Math.min(0.9, 0.5 * style.bluffMult * bf);
    if (rng() < p) return betFrac(0.5, `Strong draw: semi-bluff ${Math.round(p * 100)}%${k > 1 ? ' (halved per extra opponent)' : ''}`, true, info);
    return check('Strong draw: takes the free card', false, info);
  }
  if (v.street === 3) {
    const frac = 0.75;
    const a = requiredEquity(frac, 1 + 2 * frac);
    const pBluff = Math.min(0.9, (1 / 1.5) * (a / (1 - a)) * style.bluffMult * bf);
    if (rng() < pBluff) return betFrac(frac, `River bluff ${Math.round(pBluff * 100)}% (B/(P+2B) ratio${k > 1 ? ', halved per extra opponent' : ''})`, true, info);
    return check(`River air: gives up (bluff frequency ${Math.round(pBluff * 100)}%)`, true, info);
  }
  const pStab = Math.min(0.9, 0.3 * style.bluffMult * bf);
  if (rng() < pStab) return betFrac(v.street === 1 ? 0.33 : 0.5, `Air: stabs ${Math.round(pStab * 100)}% of the time${k > 1 ? ' (halved per extra opponent)' : ''}`, true, info);
  return check('Air: checks', true, info);
}
