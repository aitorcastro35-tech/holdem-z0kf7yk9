// Rule-based heads-up bot: plays sensibly, NOT optimally (it is not a solver).
// It only ever sees a BotView: its own cards + public information. It never receives the opponent's cards or
// undealt board cards (tests/bot.test.ts proves the decision is independent of them).
import type { Card } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { classOfCards, parseRange, type HandClass } from '../engine/range';
import { features, describeFeatures } from '../engine/handclass';
import { evaluate, categoryOf, Category } from '../engine/evaluator';
import type { EquityResult } from '../engine/equity';
import { requiredEquity, mdf } from '../engine/odds';
import { CHARTS, chartAction, findChart, type Position } from '../data/charts';
import { legalActions, totalPot, type HUState, type HUAction, type ActionType, type Legal } from '../engine/headsup';
import { estimateRange, topPct, openRangeFor, rangePct, isInPosition, classWeights, totalWeight } from './ranges';
import { isStrongDraw } from '../scenarios/compute';

export interface BotView {
  seat: 0 | 1;
  cfg: Pick<HUState['cfg'], 'tableSize' | 'positions'>;
  myCards: Card[];
  board: Card[]; // dealt cards only
  street: 0 | 1 | 2 | 3;
  pot: number; // total incl. this street's chips
  toCall: number;
  myStack: number;
  oppStack: number;
  myCommitted: number;
  currentBet: number;
  legal: Legal;
  history: HUAction[]; // public actions
  decisionIndex: number; // how many bot decisions so far this hand (for the reproducible RNG)
}

/** Build the bot's view. Deliberately copies ONLY public information + the bot's own cards. */
export function botView(st: HUState, seat: 0 | 1, decisionIndex: number): BotView {
  const o = (1 - seat) as 0 | 1;
  return {
    seat,
    cfg: { tableSize: st.cfg.tableSize, positions: [st.cfg.positions[0], st.cfg.positions[1]] },
    myCards: st.holes[seat].slice(),
    board: st.board.slice(),
    street: st.street,
    pot: totalPot(st),
    toCall: Math.max(0, Math.round((st.currentBet - st.committed[seat]) * 100) / 100),
    myStack: st.stack[seat],
    oppStack: st.stack[o],
    myCommitted: st.committed[seat],
    currentBet: st.currentBet,
    legal: legalActions(st),
    history: st.history.map((a) => ({ ...a })),
    decisionIndex,
  };
}

export interface BotStyle {
  id: 'solid' | 'station' | 'maniac';
  name: string;
  description: string;
  openWiden: number; // multiplier on the chart's open % (extra hands taken from the strength order)
  callWiden: number; // multiplier on calling thresholds / bands
  threeBetPct: number; // 3-bet range when no chart exists
  bluffMult: number; // multiplier on bluff / semi-bluff frequencies
  valueBetProb: number; // probability to bet a strong hand (vs slow-play)
  stickyTopPair: boolean; // never folds top pair or better to a single bet
  sizeMult: number; // multiplier on bet sizes (capped at pot)
  impliedBonus: number; // equity points added for strong draws on flop/turn when facing a bet
}

export const STYLES: Record<BotStyle['id'], BotStyle> = {
  solid: {
    id: 'solid',
    name: 'Solid regular',
    description: 'Plays the cited preflop charts and simple pot-odds / value rules postflop.',
    openWiden: 1,
    callWiden: 1,
    threeBetPct: 0.04,
    bluffMult: 1,
    valueBetProb: 0.85,
    stickyTopPair: false,
    sizeMult: 1,
    impliedBonus: 0.04,
  },
  station: {
    id: 'station',
    name: 'Home-game calling station',
    description: 'Calls too wide, rarely bluffs, almost never folds top pair. An approximation of a player type, not a data-derived model.',
    openWiden: 1.2,
    callWiden: 1.8,
    threeBetPct: 0.025,
    bluffMult: 0.25,
    valueBetProb: 0.7,
    stickyTopPair: true,
    sizeMult: 0.8,
    impliedBonus: 0.08,
  },
  maniac: {
    id: 'maniac',
    name: 'Aggressive / maniac',
    description: 'Opens wider, 3-bets and bluffs a lot, uses bigger sizes. An approximation of a player type, not a data-derived model.',
    openWiden: 1.6,
    callWiden: 1.2,
    threeBetPct: 0.12,
    bluffMult: 2.2,
    valueBetProb: 0.95,
    stickyTopPair: false,
    sizeMult: 1.4,
    impliedBonus: 0.04,
  },
};

export type Bucket = 'strong' | 'medium' | 'draw' | 'air';

export interface BotLog {
  street: number;
  action: string;
  rule: string;
  bucket?: Bucket;
  hand?: string;
  equity?: number;
  required?: number;
  oppRangeCombos?: number;
  oppRange?: [HandClass, number][]; // class → relative weight (for the grid)
}

export interface BotDecision {
  type: ActionType;
  to?: number;
  log: BotLog;
}

export type EqFn = (myCards: Card[], combos: { cards: [Card, Card]; weight: number }[], board: Card[], seed: number) => Promise<EquityResult>;

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Map a desired "to" amount into the legal range (all-in if it would leave very little behind). */
function sizeTo(v: BotView, desiredTo: number, kind: 'bet' | 'raise'): number {
  const range = kind === 'bet' ? v.legal.bet! : v.legal.raise!;
  let to = Math.max(range.min, Math.min(range.max, r1(desiredTo)));
  if (range.max - to < 0.15 * range.max || to > 0.85 * range.max) to = range.max; // just jam
  return to;
}

function boardIsWet(board: Card[]): boolean {
  const suits = [0, 0, 0, 0];
  board.forEach((c) => suits[c & 3]++);
  const ranks = [...new Set(board.map((c) => c >> 2))].sort((a, b) => a - b);
  let connected = false;
  for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2] - ranks[i] <= 4) connected = true;
  return Math.max(...suits) >= 2 || connected;
}

function bucketOf(myCards: Card[], board: Card[], eq: number): Bucket {
  const f = features(myCards, board);
  const made = f.category >= Category.Pair && f.improvesBoard;
  if ((f.category >= Category.TwoPair && f.improvesBoard) || eq >= 0.75) return 'strong';
  if (isStrongDraw(f, board) && eq < 0.6) return 'draw';
  if (made || eq >= 0.45) return 'medium';
  return 'air';
}

const raisesSoFar = (h: HUAction[]) => h.filter((a) => a.street === 0 && a.type === 'raise').length;

export async function botDecide(v: BotView, style: BotStyle, seed: number, eqFn: EqFn): Promise<BotDecision> {
  const rng = mulberry32((seed * 7919 + v.decisionIndex * 104729 + 17) >>> 0);
  const me = v.seat;
  const myPos = v.cfg.positions[me];
  const oppPos = v.cfg.positions[1 - me];
  const L = v.legal;
  const cls = classOfCards(v.myCards[0], v.myCards[1]);
  const opp = estimateRange(v.cfg, (1 - me) as 0 | 1, v.history, v.board, v.myCards);
  const baseLog = () => ({ street: v.street, oppRangeCombos: Math.round(totalWeight(opp)), oppRange: [...classWeights(opp)] as [HandClass, number][] });
  const check = (rule: string, extra: Partial<BotLog> = {}): BotDecision => ({ type: 'check', log: { ...baseLog(), action: 'check', rule, ...extra } });
  const fold = (rule: string, extra: Partial<BotLog> = {}): BotDecision =>
    L.fold ? { type: 'fold', log: { ...baseLog(), action: 'fold', rule, ...extra } } : check(rule + ' (checking is free)', extra);
  const call = (rule: string, extra: Partial<BotLog> = {}): BotDecision =>
    L.call !== null ? { type: 'call', log: { ...baseLog(), action: `call ${L.call}`, rule, ...extra } } : check(rule, extra);
  const raiseTo = (to: number, rule: string, extra: Partial<BotLog> = {}): BotDecision => {
    if (L.raise) {
      const t = sizeTo(v, to, 'raise');
      return { type: 'raise', to: t, log: { ...baseLog(), action: `raise to ${t}`, rule, ...extra } };
    }
    if (L.bet) {
      const t = sizeTo(v, to, 'bet');
      return { type: 'bet', to: t, log: { ...baseLog(), action: `bet ${t}`, rule, ...extra } };
    }
    return call(rule + ' (raising not allowed; calling)', extra);
  };
  const betFrac = (frac: number, rule: string, extra: Partial<BotLog> = {}): BotDecision => {
    const f = Math.min(1, frac * style.sizeMult);
    const pot = v.pot;
    if (L.bet) {
      const t = sizeTo(v, pot * f, 'bet');
      return { type: 'bet', to: t, log: { ...baseLog(), action: t >= L.bet.max ? `all-in ${t}` : `bet ${t} (${Math.round(f * 100)}% pot)`, rule, ...extra } };
    }
    return raiseTo(v.currentBet + (pot + v.toCall) * f, rule, extra);
  };

  // ---------------- PREFLOP ----------------
  if (v.street === 0) {
    const raises = raisesSoFar(v.history);
    const eff = Math.min(v.myStack + v.myCommitted, v.oppStack + (v.currentBet - 0));
    if (raises === 0) {
      // first in, or BB facing a limp
      if (myPos === 'BB' && v.toCall === 0) {
        const t = topPct(0.15 * style.openWiden);
        if (t.has(cls)) return raiseTo(4, 'BB raises a limp with the top ~15% of hands (×style)');
        return check('BB checks its option with hands outside the top ~15%');
      }
      const size = v.cfg.tableSize === 6 || v.cfg.tableSize === 9 ? v.cfg.tableSize : 6;
      const chart = findChart('rfi', size, (v.cfg.tableSize === 2 ? 'BTN' : myPos) as Position);
      let inRange = false;
      let mixed = false;
      if (chart) {
        inRange = chartAction(chart, cls) !== 'fold';
        mixed = !!chart.mixedActions && inRange;
        if (!inRange && style.openWiden > 1) inRange = topPct(Math.min(0.95, rangePct(openRangeFor(v.cfg, myPos)!) * style.openWiden)).has(cls);
      } else inRange = topPct(0.4 * style.openWiden).has(cls);
      if (!inRange) return fold(`${cls} is outside its ${myPos} opening range (${chart ? chart.title : 'top 40%'}${style.openWiden > 1 ? `, widened ×${style.openWiden}` : ''})`);
      if (mixed && rng() < 0.5) return call(`${cls} is in the SB "raise or call" range; the source gives no split, so it completes 50% of the time`);
      const open = myPos === 'SB' ? 3 : 2.5;
      if (eff <= 12) return raiseTo(9999, `${cls} opens; with ≤12bb effective it shoves instead of raising`);
      return raiseTo(open, `${cls} is in its ${myPos} opening range (${chart?.title ?? 'top 40%'}) — open to ${open}bb`);
    }
    if (raises === 1) {
      // facing an open
      const ch = CHARTS.find((c) => c.kind === 'vsOpen' && c.hero === myPos && c.villain === oppPos);
      const ip = isInPosition(v.cfg, myPos, oppPos);
      const openTo = v.currentBet;
      const tbSize = ip ? openTo * 3 : openTo * 4;
      if (ch) {
        const a = chartAction(ch, cls);
        if (a === 'threebet' || (a === 'call' && ch.mixedActions && rng() < 0.25 * style.bluffMult)) return raiseTo(eff <= 25 ? 9999 : tbSize, `${ch.title}: ${cls} is a ${a === 'threebet' ? '3-bet' : 'defend hand; 3-bets part of the time'}`);
        if (a === 'call') return call(`${ch.title}: ${cls} is a call`);
        if (style.callWiden > 1) {
          const cont = new Set<HandClass>();
          ch.parts.forEach((p) => parseRange(p.range).forEach((_w, k) => cont.add(k)));
          if (topPct(Math.min(0.9, rangePct(cont) * style.callWiden)).has(cls)) return call(`Loose style: widens the chart's continuing range ×${style.callWiden}`);
        }
        return fold(`${ch.title}: ${cls} is not in the continuing range`);
      }
      // no verified chart: documented heuristic
      const opener = openRangeFor(v.cfg, oppPos) ?? topPct(0.3);
      const tb = topPct(style.threeBetPct);
      if (tb.has(cls) || (['A5s', 'A4s', 'A3s', 'A2s'].includes(cls) && rng() < 0.5 * style.bluffMult)) return raiseTo(eff <= 25 ? 9999 : tbSize, `No verified chart for ${myPos} vs ${oppPos}: 3-bets the top ${Math.round(style.threeBetPct * 100)}% (and some suited wheel aces)`);
      const k = myPos === 'BB' ? 2.0 : ip ? 0.7 : 0.5;
      const band = topPct(Math.min(0.9, rangePct(opener) * k * style.callWiden));
      if (band.has(cls)) return call(`No verified chart: calls hands inside a band ${Math.round(k * style.callWiden * 100)}% the size of the ${oppPos} opening range`);
      return fold(`No verified chart: ${cls} is outside its calling band vs a ${oppPos} open`);
    }
    if (raises === 2 && v.toCall > 0 && !v.history.some((a) => a.allIn && a.seat !== me)) {
      // facing a 3-bet (no verified chart exists → documented heuristic)
      if (topPct(0.025).has(cls)) return raiseTo(eff <= 60 ? 9999 : v.currentBet * 2.3, 'Facing a 3-bet: 4-bets the top 2.5% (heuristic; no verified vs-3-bet chart)');
      if (topPct(0.12 * style.callWiden).has(cls)) return call('Facing a 3-bet: calls with the top ~12% (heuristic; no verified vs-3-bet chart)');
      return fold('Facing a 3-bet: folds outside the top ~12% (heuristic)');
    }
  }

  // ---------------- facing a bet / all-in (preflop 4-bets or shoves, and every postflop bet) ----------------
  const pot = v.pot;
  const combos = opp.map((c) => ({ cards: c.cards, weight: c.w }));
  const eqRes = await eqFn(v.myCards, combos, v.board, (seed * 31 + v.decisionIndex) >>> 0);
  const eq = eqRes.equity;
  const bucket: Bucket = v.street === 0 ? (eq >= 0.6 ? 'strong' : eq >= 0.45 ? 'medium' : 'air') : bucketOf(v.myCards, v.board, eq);
  const hand = v.street > 0 ? describeFeatures(features(v.myCards, v.board)) : cls;
  const info = { bucket, equity: eq, hand };
  const streetName = ['preflop', 'flop', 'turn', 'river'][v.street];

  if (v.toCall > 0) {
    const req = requiredEquity(Math.min(v.toCall, v.myStack), pot + Math.min(v.toCall, v.myStack));
    const f = v.street > 0 ? features(v.myCards, v.board) : null;
    const draw = !!f && isStrongDraw(f, v.board);
    const bonus = draw && v.street < 3 ? style.impliedBonus : 0;
    const adj = eq + bonus;
    const betFracFaced = v.toCall / Math.max(0.01, pot - v.toCall);
    const x = { ...info, required: req };
    // value raise
    if (bucket === 'strong' && eq >= 0.7 && L.raise && rng() < 0.6) return raiseTo(v.currentBet * 3, `Strong hand (${Math.round(eq * 100)}% vs your estimated range) facing a bet: raises for value`, x);
    if (draw && v.street === 1 && L.raise && rng() < 0.15 * style.bluffMult) return raiseTo(v.currentBet * 3, 'Strong draw on the flop: occasional semi-bluff raise', x);
    if (adj >= req) return call(`Equity ${Math.round(eq * 100)}%${bonus ? ` (+${Math.round(bonus * 100)} for implied odds with a draw)` : ''} ≥ the ${Math.round(req * 100)}% the price requires: call`, x);
    if (style.stickyTopPair && f && (f.pair === 'top' || f.pair === 'overpair' || (f.category >= Category.TwoPair && f.improvesBoard))) return call('Calling-station style: never folds top pair or better', x);
    // MDF guard against small bets
    if (v.street > 0 && betFracFaced <= 0.4 && (bucket === 'medium' || draw) && eq >= req - 0.05)
      return call(`MDF guard: vs a small bet (${Math.round(betFracFaced * 100)}% pot, MDF ${Math.round(mdf(1, betFracFaced) * 100)}%) it keeps pairs and draws that are close to the price`, x);
    if (style.callWiden > 1 && eq >= req - 0.05 * (style.callWiden - 1) * 2) return call(`Loose style: calls slightly below the price (${Math.round(eq * 100)}% vs ${Math.round(req * 100)}%)`, x);
    return fold(`Equity ${Math.round(eq * 100)}% < the ${Math.round(req * 100)}% the price requires: fold`, x);
  }

  // ---------------- no bet to face: bet or check ----------------
  const ip = isInPosition(v.cfg, myPos, oppPos);
  const wet = boardIsWet(v.board);
  const spr = Math.min(v.myStack, v.oppStack) / Math.max(0.01, pot);
  const valueFrac = spr <= 1.2 ? 1.5 : v.street === 3 ? (eq >= 0.9 ? 1 : 0.75) : wet ? 0.75 : v.street === 1 ? 0.33 : 0.5;
  if (bucket === 'strong') {
    if (rng() < style.valueBetProb) return betFrac(valueFrac, `Strong hand: value bet (${spr <= 1.2 ? 'low SPR → all-in' : wet ? 'wet board → bigger size' : 'dry board → smaller size'})`, info);
    return check('Strong hand: occasional slow-play', info);
  }
  if (bucket === 'medium') {
    const p = v.street === 3 ? 0.15 : ip ? 0.45 : 0.2;
    if (rng() < p) return betFrac(v.street === 1 ? 0.33 : 0.5, `Medium-strength hand: small ${v.street === 3 ? 'thin value' : 'protection'} bet part of the time (${Math.round(p * 100)}%)`, info);
    return check('Medium-strength hand: check (pot control)', info);
  }
  if (bucket === 'draw') {
    const p = Math.min(0.9, 0.5 * style.bluffMult);
    if (rng() < p) return betFrac(0.5, `Strong draw: semi-bluff ${Math.round(p * 100)}% of the time`, info);
    return check('Strong draw: check and take a free card', info);
  }
  // air
  if (v.street === 3) {
    // river bluffs tied to the size: bluffs : value = a/(1−a), a = B/(P+2B); assume value:air ≈ 1 : 1.5 in a betting range
    const frac = 0.75;
    const a = requiredEquity(frac, 1 + 2 * frac);
    const pBluff = Math.min(0.9, (1 / 1.5) * (a / (1 - a)) * style.bluffMult);
    if (rng() < pBluff) return betFrac(frac, `River air: bluffs ${Math.round(pBluff * 100)}% so its betting range is ~${Math.round(a * 100)}% bluffs (B/(P+2B) for a ¾-pot bet)`, info);
    return check(`River air: gives up (bluff frequency ${Math.round(pBluff * 100)}%)`, info);
  }
  const pStab = Math.min(0.9, (ip ? 0.35 : 0.2) * style.bluffMult * (v.street === 1 ? 1 : 0.7));
  if (rng() < pStab) return betFrac(v.street === 1 ? 0.33 : 0.5, `Air on the ${streetName}: stabs ${Math.round(pStab * 100)}% of the time`, info);
  return check(`Air on the ${streetName}: checks`, info);
}

/** Used in tests: the hand category the bot holds (proves only its own cards are used). */
export const _botHandCategory = (v: BotView) => (v.board.length >= 3 ? categoryOf(evaluate([...v.myCards, ...v.board])) : -1);
