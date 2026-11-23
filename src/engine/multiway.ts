// Multiway No-Limit Hold'em hand state machine (2–6 players, pure, seeded, replayable).
// Amounts are tracked internally in integer cents of a big blind (1bb = 100) so pots split exactly and the odd chip
// can be assigned (to the first eligible winner left of the button), and exposed in bb.
//
// Rules (standard TDA / Robert's Rules conventions):
//  - Seats on a 6-max table; with fewer players the earliest positions are removed (4 players = CO, BTN, SB, BB).
//    Two players = a heads-up game: the button posts the small blind, acts first preflop and last postflop.
//  - Preflop order UTG → … → BTN → SB → BB; postflop SB → BB → UTG → … → BTN. Folded and all-in players are skipped.
//  - Min bet 1bb; min raise = current bet + the last full raise increment. An all-in smaller than a full raise does
//    not reopen the betting for players who already acted since the last full raise (they may only call or fold),
//    unless several short all-ins together reach a full raise (TDA 2026 Rules 45A, 49A).
//  - Uncalled chips are returned. Side pots by contribution level; each goes to the best eligible hand; ties split,
//    odd chip to the first eligible winner clockwise from the button.
import { type Card, FULL_DECK, mulberry32, shuffle } from './cards';
import { evaluate } from './evaluator';

export type MWStreet = 0 | 1 | 2 | 3;
export const MW_STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export type MWActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export const SIX_MAX = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;

/** Position names for n players at a 6-max table (earliest positions removed first). */
export function positionsFor(n: number): string[] {
  if (n < 2 || n > 6) throw new Error('2–6 players');
  if (n === 2) return ['BTN', 'BB']; // heads-up: button is the small blind
  return SIX_MAX.slice(6 - n) as unknown as string[];
}

export interface MWConfig {
  seed: number;
  /** position name per seat (seat index = array index); use positionsFor(n) */
  positions: string[];
  stacks: number[]; // bb, before blinds/antes
  ante?: number;
  holes?: (Card[] | undefined)[];
  board?: (Card | undefined)[];
}

export interface MWAction {
  seat: number;
  street: MWStreet;
  type: MWActionType;
  amount: number; // call: chips added; bet/raise: total committed this street after the action (bb)
  allIn: boolean;
  potBefore: number; // bb, incl. this street's chips (public)
  toCallBefore: number; // bb
}

export interface MWResult {
  pots: { amount: number; eligible: number[]; winners: number[] }[];
  net: number[]; // bb per seat
  reason: 'fold' | 'showdown';
  returned: { seat: number; amount: number }[];
  hands?: (number | null)[]; // evaluator scores at showdown (null = folded)
}

export interface MWState {
  cfg: MWConfig;
  n: number;
  holes: Card[][];
  boardAll: Card[];
  board: Card[];
  street: MWStreet;
  // cents
  stack: number[];
  committed: number[]; // this street
  invested: number[]; // whole hand
  currentBet: number;
  lastRaise: number;
  folded: boolean[];
  needAct: boolean[];
  canRaise: boolean[];
  actedSinceFull: boolean[];
  /** the bet level (cents) each player last acted against — for cumulative short all-ins (TDA Rule 49A) */
  facedAt: number[];
  toAct: number | null;
  history: MWAction[];
  returned: { seat: number; amount: number }[];
  over: boolean;
  result?: MWResult;
}

const C = (bb: number) => Math.round(bb * 100);
const B = (c: number) => c / 100;
const PRE = (p: string) => (SIX_MAX as readonly string[]).indexOf(p === 'BTN' ? 'BTN' : p);

/** Seats in preflop or postflop acting order. */
export function actingOrder(cfg: Pick<MWConfig, 'positions'>, street: MWStreet): number[] {
  const n = cfg.positions.length;
  const seats = Array.from({ length: n }, (_, i) => i);
  if (n === 2) {
    const btn = cfg.positions.indexOf('BTN');
    const bb = 1 - btn;
    return street === 0 ? [btn, bb] : [bb, btn];
  }
  const pre = (s: number) => PRE(cfg.positions[s]);
  const post = (s: number) => (cfg.positions[s] === 'SB' ? -2 : cfg.positions[s] === 'BB' ? -1 : PRE(cfg.positions[s]));
  return seats.sort((a, b) => (street === 0 ? pre(a) - pre(b) : post(a) - post(b)));
}

/** Seats clockwise starting with the first seat left of the button (for the odd chip). */
export function leftOfButtonOrder(cfg: Pick<MWConfig, 'positions'>): number[] {
  return actingOrder(cfg, 1); // postflop order starts left of the button and ends on it
}

export function dealMW(cfg: MWConfig): { holes: Card[][]; board: Card[] } {
  const n = cfg.positions.length;
  const preset = [...(cfg.holes ?? []).flatMap((h) => h ?? []), ...((cfg.board ?? []).filter((c) => c !== undefined) as Card[])];
  if (new Set(preset).size !== preset.length) throw new Error('Duplicate preset cards');
  const deck = shuffle(FULL_DECK.filter((c) => !preset.includes(c)), mulberry32(cfg.seed));
  let k = 0;
  const holes: Card[][] = [];
  for (let s = 0; s < n; s++) holes.push(cfg.holes?.[s]?.length === 2 ? cfg.holes[s]!.slice() : [deck[k++], deck[k++]]);
  const board: Card[] = [];
  for (let i = 0; i < 5; i++) board.push(cfg.board?.[i] ?? deck[k++]);
  return { holes, board };
}

export function newMWHand(cfg: MWConfig): MWState {
  const n = cfg.positions.length;
  if (cfg.stacks.length !== n) throw new Error('stacks must match positions');
  const { holes, board } = dealMW(cfg);
  const stack = cfg.stacks.map(C);
  const committed = Array(n).fill(0);
  const invested = Array(n).fill(0);
  const ante = C(cfg.ante ?? 0);
  for (let s = 0; s < n; s++) {
    const a = Math.min(ante, stack[s]);
    stack[s] -= a;
    invested[s] += a;
  }
  const post = (s: number, amt: number) => {
    const a = Math.min(amt, stack[s]);
    stack[s] -= a;
    committed[s] += a;
    invested[s] += a;
  };
  for (let s = 0; s < n; s++) {
    const p = cfg.positions[s];
    if (p === 'SB' || (n === 2 && p === 'BTN')) post(s, 50);
    if (p === 'BB') post(s, 100);
  }
  const st: MWState = {
    cfg,
    n,
    holes,
    boardAll: board,
    board: [],
    street: 0,
    stack,
    committed,
    invested,
    currentBet: 100,
    lastRaise: 100,
    folded: Array(n).fill(false),
    needAct: stack.map((x) => x > 0),
    canRaise: Array(n).fill(true),
    actedSinceFull: Array(n).fill(false),
    facedAt: Array(n).fill(0),
    toAct: null,
    history: [],
    returned: [],
    over: false,
  };
  st.toAct = nextToAct(st, -1);
  if (st.toAct === null) closeRound(st);
  return st;
}

const active = (st: MWState, s: number) => !st.folded[s] && st.stack[s] > 0;
const live = (st: MWState) => st.folded.map((f, i) => (!f ? i : -1)).filter((i) => i >= 0);

/** Next seat (in this street's order, after `from`) that still needs to act. */
function nextToAct(st: MWState, from: number): number | null {
  const order = actingOrder(st.cfg, st.street);
  const start = from < 0 ? 0 : order.indexOf(from) + 1;
  for (let k = 0; k < order.length; k++) {
    const s = order[(start + k) % order.length];
    if (active(st, s) && st.needAct[s]) return s;
  }
  return null;
}

export interface MWLegal {
  fold: boolean;
  check: boolean;
  call: number | null; // bb to add
  bet: { min: number; max: number } | null;
  raise: { min: number; max: number } | null; // "to" amounts in bb
}

export function mwLegal(st: MWState): MWLegal {
  if (st.over || st.toAct === null) return { fold: false, check: false, call: null, bet: null, raise: null };
  const s = st.toAct;
  const toCall = st.currentBet - st.committed[s];
  const maxTo = st.committed[s] + st.stack[s];
  const othersCanAct = live(st).some((o) => o !== s && st.stack[o] > 0);
  const L: MWLegal = { fold: toCall > 0, check: toCall <= 0, call: toCall > 0 ? B(Math.min(toCall, st.stack[s])) : null, bet: null, raise: null };
  if (st.street > 0 && st.currentBet === 0) {
    if (st.stack[s] > 0 && othersCanAct) L.bet = { min: B(Math.min(100, maxTo)), max: B(maxTo) };
  } else if (st.canRaise[s] && othersCanAct && maxTo > st.currentBet) {
    L.raise = { min: B(Math.min(st.currentBet + st.lastRaise, maxTo)), max: B(maxTo) };
  }
  return L;
}

export const mwTotalPot = (st: MWState) => B(st.invested.reduce((a, b) => a + b, 0));
export const mwToCall = (st: MWState, s: number) => B(Math.max(0, st.currentBet - st.committed[s]));

export function mwAct(st0: MWState, type: MWActionType, toBB?: number): MWState {
  const st = cloneMW(st0);
  if (st.over || st.toAct === null) throw new Error('Hand is over');
  const s = st.toAct;
  const L = mwLegal(st);
  const potBefore = mwTotalPot(st);
  const toCallBefore = mwToCall(st, s);
  const add = (c: number) => {
    const a = Math.min(c, st.stack[s]);
    st.stack[s] -= a;
    st.committed[s] += a;
    st.invested[s] += a;
  };
  const rec = (t: MWActionType, amount: number): MWAction => ({ seat: s, street: st.street, type: t, amount, allIn: st.stack[s] === 0 && t !== 'fold' && t !== 'check', potBefore, toCallBefore });
  switch (type) {
    case 'fold':
      if (!L.fold) throw new Error('Cannot fold when checking is free');
      st.folded[s] = true;
      st.needAct[s] = false;
      st.history.push(rec('fold', 0));
      break;
    case 'check':
      if (!L.check) throw new Error('Cannot check facing a bet');
      st.needAct[s] = false;
      st.actedSinceFull[s] = true;
      st.facedAt[s] = st.currentBet;
      st.history.push(rec('check', 0));
      break;
    case 'call': {
      if (L.call === null) throw new Error('Nothing to call');
      add(C(L.call));
      st.needAct[s] = false;
      st.actedSinceFull[s] = true;
      st.facedAt[s] = st.currentBet;
      st.history.push(rec('call', L.call));
      break;
    }
    case 'bet':
    case 'raise': {
      const range = type === 'bet' ? L.bet : L.raise;
      if (!range || toBB === undefined) throw new Error(`Cannot ${type} now`);
      const to = C(toBB);
      if (to > C(range.max) || (to < C(range.min) && to !== C(range.max))) throw new Error(`${type} to ${toBB} is not legal (min ${range.min}, max ${range.max})`);
      const increment = to - st.currentBet;
      add(to - st.committed[s]);
      const full = type === 'bet' ? to >= 100 : increment >= st.lastRaise;
      for (let o = 0; o < st.n; o++) {
        if (o === s || !active(st, o)) continue;
        st.needAct[o] = true;
        if (full) st.canRaise[o] = true;
        // short all-in: no reopening for players who already acted — unless the short all-ins since they acted add up
        // to at least a full raise (TDA 2026 Rule 49A, "cumulative multiple short all-ins")
        else if (st.actedSinceFull[o]) st.canRaise[o] = to - st.facedAt[o] >= st.lastRaise;
      }
      if (full) {
        st.lastRaise = type === 'bet' ? to : increment;
        st.actedSinceFull = st.actedSinceFull.map(() => false);
      }
      st.currentBet = to;
      st.facedAt[s] = to;
      st.needAct[s] = false;
      st.actedSinceFull[s] = true;
      st.history.push(rec(type, B(to)));
      break;
    }
  }
  // hand over by folds?
  const alive = live(st);
  if (alive.length === 1) {
    finishByFold(st, alive[0]);
    return st;
  }
  const nxt = nextToAct(st, s);
  // nobody left to act: or only one player can still act and he's matched the bet
  if (nxt === null) closeRound(st);
  else st.toAct = nxt;
  return st;
}

/** Return the part of the biggest street bet nobody matched. */
function returnUncalled(st: MWState) {
  // folded players' chips count as matched contributions
  const others = st.committed.map((c, i) => ({ c, i }));
  const top = Math.max(...st.committed);
  const topSeat = st.committed.indexOf(top);
  const second = Math.max(...others.filter((x) => x.i !== topSeat).map((x) => x.c), 0);
  if (top > second && !st.folded[topSeat]) {
    const ex = top - second;
    st.stack[topSeat] += ex;
    st.committed[topSeat] -= ex;
    st.invested[topSeat] -= ex;
    st.returned.push({ seat: topSeat, amount: B(ex) });
  }
}

function closeRound(st: MWState) {
  returnUncalled(st);
  st.committed = st.committed.map(() => 0);
  st.currentBet = 0;
  st.lastRaise = 100;
  st.canRaise = st.canRaise.map(() => true);
  st.actedSinceFull = st.actedSinceFull.map(() => false);
  st.facedAt = st.facedAt.map(() => 0);
  const alive = live(st);
  const canAct = alive.filter((s) => st.stack[s] > 0);
  if (st.street === 3 || canAct.length <= 1) {
    st.street = 3;
    st.board = st.boardAll.slice();
    showdown(st);
    return;
  }
  st.street = (st.street + 1) as MWStreet;
  st.board = st.boardAll.slice(0, st.street === 1 ? 3 : st.street === 2 ? 4 : 5);
  st.needAct = st.needAct.map((_, i) => active(st, i));
  st.toAct = nextToAct(st, -1);
  if (st.toAct === null) closeRound(st);
}

/** Main pot + side pots from contribution levels (folded players' chips are dead money in the pots they reached). */
export function buildPots(invested: number[], folded: boolean[], allInOnly?: boolean[]): { amount: number; eligible: number[] }[] {
  // At showdown every live player's contribution is a level; during the hand only all-in amounts (plus the top) split pots.
  const liveAmounts = invested.filter((_, i) => !folded[i]);
  const cand = allInOnly ? [...invested.filter((_, i) => !folded[i] && allInOnly[i]), Math.max(...liveAmounts)] : liveAmounts;
  const levels = [...new Set(cand)].filter((x) => x > 0).sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const lv of levels) {
    let amt = 0;
    for (let i = 0; i < invested.length; i++) amt += Math.max(0, Math.min(invested[i], lv) - prev);
    const eligible = invested.map((v, i) => (!folded[i] && (v >= lv || (allInOnly && !allInOnly[i])) ? i : -1)).filter((i) => i >= 0);
    if (amt > 0) pots.push({ amount: amt, eligible });
    prev = lv;
  }
  // chips above the highest live level (folded players who put in more) belong to the last pot
  const extra = invested.reduce((a, v) => a + Math.max(0, v - prev), 0);
  if (extra > 0 && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

/** Pots for display during the hand (bb). */
export function currentPots(st: MWState) {
  const allIn = st.stack.map((x, i) => x === 0 && !st.folded[i]);
  return buildPots(st.invested, st.folded, allIn).map((p) => ({ amount: B(p.amount), eligible: p.eligible }));
}

function showdown(st: MWState) {
  const scores = st.holes.map((h, i) => (st.folded[i] ? null : evaluate([...h, ...st.boardAll])));
  const pots = buildPots(st.invested, st.folded);
  const payout = Array(st.n).fill(0);
  const order = leftOfButtonOrder(st.cfg);
  const outPots: MWResult['pots'] = [];
  for (const p of pots) {
    const best = Math.max(...p.eligible.map((i) => scores[i]!));
    const winners = order.filter((i) => p.eligible.includes(i) && scores[i] === best);
    const share = Math.floor(p.amount / winners.length);
    let rem = p.amount - share * winners.length;
    for (const w of winners) {
      payout[w] += share + (rem > 0 ? 1 : 0); // odd chip(s): first winners left of the button
      if (rem > 0) rem--;
    }
    outPots.push({ amount: B(p.amount), eligible: p.eligible, winners });
  }
  st.over = true;
  st.toAct = null;
  st.result = { pots: outPots, net: payout.map((p, i) => B(p - st.invested[i])), reason: 'showdown', returned: st.returned, hands: scores };
}

function finishByFold(st: MWState, winner: number) {
  returnUncalled(st);
  const total = st.invested.reduce((a, b) => a + b, 0);
  const net = st.invested.map((v, i) => B((i === winner ? total : 0) - v));
  st.committed = st.committed.map(() => 0);
  st.over = true;
  st.toAct = null;
  st.result = { pots: [{ amount: B(total), eligible: [winner], winners: [winner] }], net, reason: 'fold', returned: st.returned };
}

export function cloneMW(st: MWState): MWState {
  return {
    ...st,
    holes: st.holes.map((h) => h.slice()),
    boardAll: st.boardAll.slice(),
    board: st.board.slice(),
    stack: st.stack.slice(),
    committed: st.committed.slice(),
    invested: st.invested.slice(),
    folded: st.folded.slice(),
    needAct: st.needAct.slice(),
    canRaise: st.canRaise.slice(),
    actedSinceFull: st.actedSinceFull.slice(),
    facedAt: st.facedAt.slice(),
    history: st.history.slice(),
    returned: st.returned.slice(),
  };
}

/** bb views */
export const stackBB = (st: MWState, s: number) => B(st.stack[s]);
export const committedBB = (st: MWState, s: number) => B(st.committed[s]);
export const investedBB = (st: MWState, s: number) => B(st.invested[s]);
export const currentBetBB = (st: MWState) => B(st.currentBet);
/** Total chips (conservation check, bb). */
export const mwChips = (st: MWState) => B(st.stack.reduce((a, b) => a + b, 0) + st.invested.reduce((a, b) => a + b, 0));
