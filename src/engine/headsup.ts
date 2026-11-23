// Heads-up No-Limit Hold'em hand state machine (pure, seeded, replayable).
// Two players remain; everyone else folded preflop. Amounts are in big blinds (bb).
//
// Rules implemented (Robert's Rules of Poker / standard TDA conventions):
//  - Blinds: SB 0.5, BB 1 (folded blinds are dead money). Optional ante per seat at the table.
//  - Preflop order follows table position (UTG … BTN, SB, BB); postflop the player closer to the button's
//    left acts first (SB, BB, UTG, …, BTN acts last). In a true 2-player game the button posts the SB,
//    acts first preflop and last postflop.
//  - Min bet = 1bb. Min raise: raise-to ≥ current bet + size of the last full bet/raise.
//  - An all-in for less than a full raise does not reopen the betting to the player who already acted.
//  - Uncalled chips are returned; showdown with the 7-card evaluator; ties split the pot.
import { type Card, FULL_DECK, mulberry32, shuffle } from './cards';
import { evaluate } from './evaluator';

export type Street = 0 | 1 | 2 | 3; // preflop, flop, turn, river
export const STREET_NAMES = ['preflop', 'flop', 'turn', 'river'] as const;
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface HUConfig {
  seed: number;
  tableSize: 2 | 6 | 9;
  positions: [string, string]; // seat 0, seat 1 position names (e.g. 'CO', 'BB'); in a 2-player game 'BTN' / 'BB'
  stacks: [number, number]; // starting stacks in bb (before blinds/antes)
  ante?: number; // per player at the table (all seats pay), default 0
  holes?: [Card[] | undefined, Card[] | undefined]; // preset hole cards
  board?: (Card | undefined)[]; // preset board cards by index 0..4
}

export interface HUAction {
  seat: 0 | 1;
  street: Street;
  type: ActionType;
  /** for call: chips added; for bet/raise: total committed on this street after the action ("raise to") */
  amount: number;
  allIn: boolean;
  /** public info recorded with the action: total pot (incl. this street's chips) and chips to call before acting */
  potBefore?: number;
  toCallBefore?: number;
}

export interface HUState {
  cfg: HUConfig;
  holes: [Card[], Card[]];
  boardAll: Card[]; // all 5 board cards, decided at the start (players only ever see the dealt ones)
  street: Street;
  board: Card[]; // dealt so far
  stack: [number, number]; // behind
  committed: [number, number]; // this street
  invested: [number, number]; // whole hand (incl. blinds/antes)
  pot: number; // completed streets + dead money (excl. this street's committed)
  dead: number; // dead blinds/antes from folded players
  toAct: 0 | 1 | null;
  currentBet: number; // highest committed this street
  lastRaise: number; // size of last full bet/raise this street (min raise increment)
  canRaise: [boolean, boolean]; // raise rights (false after facing a short all-in having already acted)
  acted: [boolean, boolean]; // acted this street (posting blinds doesn't count)
  folded: [boolean, boolean];
  history: HUAction[];
  over: boolean;
  result?: { winners: (0 | 1)[]; net: [number, number]; reason: 'fold' | 'showdown'; returned: number; hands?: [number, number] };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

const ORDER: Record<number, string[]> = {
  2: ['BTN', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

/** Which seat acts first on a street. */
export function firstToAct(cfg: HUConfig, street: Street): 0 | 1 {
  const order = ORDER[cfg.tableSize];
  const i0 = order.indexOf(cfg.positions[0]);
  const i1 = order.indexOf(cfg.positions[1]);
  if (i0 < 0 || i1 < 0 || i0 === i1) throw new Error('Invalid positions for this table size');
  if (cfg.tableSize === 2) {
    // button = small blind: first preflop, last postflop
    const btn: 0 | 1 = cfg.positions[0] === 'BTN' ? 0 : 1;
    return street === 0 ? btn : ((1 - btn) as 0 | 1);
  }
  if (street === 0) return i0 < i1 ? 0 : 1;
  // postflop: SB first, then BB, then UTG ... BTN last
  const post = (i: number) => (order[i] === 'SB' ? -2 : order[i] === 'BB' ? -1 : i);
  return post(i0) < post(i1) ? 0 : 1;
}

/** Deal cards from the seed, honoring presets. Never depends on the actions taken. */
export function dealCards(cfg: HUConfig): { holes: [Card[], Card[]]; board: Card[] } {
  const preset = [...(cfg.holes?.[0] ?? []), ...(cfg.holes?.[1] ?? []), ...((cfg.board ?? []).filter((c) => c !== undefined) as Card[])];
  if (new Set(preset).size !== preset.length) throw new Error('Duplicate preset cards');
  const deck = shuffle(FULL_DECK.filter((c) => !preset.includes(c)), mulberry32(cfg.seed));
  let k = 0;
  const draw = () => deck[k++];
  const holes: [Card[], Card[]] = [cfg.holes?.[0]?.slice() ?? [draw(), draw()], cfg.holes?.[1]?.slice() ?? [draw(), draw()]];
  const board: Card[] = [];
  for (let i = 0; i < 5; i++) board.push(cfg.board?.[i] ?? draw());
  return { holes, board };
}

export function newHand(cfg: HUConfig): HUState {
  const { holes, board } = dealCards(cfg);
  const ante = cfg.ante ?? 0;
  const seats = cfg.tableSize;
  const stack: [number, number] = [cfg.stacks[0], cfg.stacks[1]];
  const committed: [number, number] = [0, 0];
  const invested: [number, number] = [0, 0];
  let dead = 0;
  // antes: both players pay; folded players' antes are dead
  for (const s of [0, 1] as const) {
    const a = Math.min(ante, stack[s]);
    stack[s] = r2(stack[s] - a);
    invested[s] = r2(invested[s] + a);
  }
  dead += ante * (seats - 2);
  const post = (s: 0 | 1, amt: number) => {
    const a = Math.min(amt, stack[s]);
    stack[s] = r2(stack[s] - a);
    committed[s] = r2(committed[s] + a);
    invested[s] = r2(invested[s] + a);
  };
  const isSB = (p: string) => p === 'SB' || (seats === 2 && p === 'BTN');
  let sbIn = false;
  let bbIn = false;
  for (const s of [0, 1] as const) {
    if (isSB(cfg.positions[s])) {
      post(s, 0.5);
      sbIn = true;
    }
    if (cfg.positions[s] === 'BB') {
      post(s, 1);
      bbIn = true;
    }
  }
  if (!sbIn) dead += 0.5;
  if (!bbIn) dead += 1;
  const antesIn = invested[0] - committed[0] + invested[1] - committed[1];
  const st: HUState = {
    cfg,
    holes,
    boardAll: board,
    street: 0,
    board: [],
    stack,
    committed,
    invested,
    pot: r2(dead + antesIn),
    dead: r2(dead),
    toAct: firstToAct(cfg, 0),
    currentBet: 1, // the big blind is the bet to call preflop (even if the BB folded)
    lastRaise: 1,
    canRaise: [true, true],
    acted: [false, false],
    folded: [false, false],
    history: [],
    over: false,
  };
  // a player all-in from blinds/antes can't act
  if (stack[st.toAct!] === 0 && stack[1 - st.toAct!] === 0) finishStreet(st);
  return st;
}

export interface Legal {
  fold: boolean;
  check: boolean;
  call: number | null; // chips to add
  bet: { min: number; max: number } | null; // "bet to" range (no bet yet this street)
  raise: { min: number; max: number } | null; // "raise to" range; min may equal max (all-in only)
}

export function legalActions(st: HUState): Legal {
  if (st.over || st.toAct === null) return { fold: false, check: false, call: null, bet: null, raise: null };
  const s = st.toAct;
  const o = (1 - s) as 0 | 1;
  const toCall = r2(st.currentBet - st.committed[s]);
  const maxTo = r2(st.committed[s] + st.stack[s]);
  const oppCanAct = st.stack[o] > 0; // raising is pointless if the opponent is already all-in
  const L: Legal = { fold: toCall > 0, check: toCall <= 0, call: toCall > 0 ? Math.min(toCall, st.stack[s]) : null, bet: null, raise: null };
  const noBetYet = st.street > 0 && st.currentBet === 0;
  if (noBetYet) {
    if (st.stack[s] > 0 && oppCanAct) L.bet = { min: Math.min(1, maxTo), max: maxTo };
  } else if (st.canRaise[s] && oppCanAct && maxTo > st.currentBet) {
    const minTo = r2(st.currentBet + st.lastRaise);
    L.raise = { min: Math.min(minTo, maxTo), max: maxTo };
  }
  return L;
}

/** Apply an action. For bet/raise, `to` is the total committed this street after the action. */
export function act(st0: HUState, type: ActionType, to?: number): HUState {
  const st = clone(st0);
  if (st.over || st.toAct === null) throw new Error('Hand is over');
  const s = st.toAct;
  const o = (1 - s) as 0 | 1;
  const L = legalActions(st);
  const potBefore = totalPot(st);
  const toCallBefore = r2(st.currentBet - st.committed[s]);
  const add = (amt: number) => {
    const a = Math.min(r2(amt), st.stack[s]);
    st.stack[s] = r2(st.stack[s] - a);
    st.committed[s] = r2(st.committed[s] + a);
    st.invested[s] = r2(st.invested[s] + a);
  };
  let rec: HUAction;
  switch (type) {
    case 'fold': {
      if (!L.fold) throw new Error('Cannot fold when checking is free');
      st.folded[s] = true;
      rec = { seat: s, street: st.street, type, amount: 0, allIn: false, potBefore, toCallBefore };
      st.history.push(rec);
      awardFold(st, o);
      return st;
    }
    case 'check':
      if (!L.check) throw new Error('Cannot check facing a bet');
      rec = { seat: s, street: st.street, type, amount: 0, allIn: false };
      break;
    case 'call': {
      if (L.call === null) throw new Error('Nothing to call');
      add(L.call);
      rec = { seat: s, street: st.street, type, amount: L.call, allIn: st.stack[s] === 0 };
      break;
    }
    case 'bet':
    case 'raise': {
      const range = type === 'bet' ? L.bet : L.raise;
      if (!range) throw new Error(`Cannot ${type} now`);
      if (to === undefined) throw new Error('Amount required');
      const tgt = r2(to);
      if (tgt > range.max + 1e-9 || (tgt < range.min - 1e-9 && tgt !== range.max)) throw new Error(`${type} to ${tgt} is not legal (min ${range.min}, max ${range.max})`);
      const increment = r2(tgt - st.currentBet);
      add(tgt - st.committed[s]);
      const full = increment >= st.lastRaise - 1e-9 || (type === 'bet' && tgt >= 1 - 1e-9);
      if (full) {
        st.lastRaise = Math.max(increment, type === 'bet' ? tgt : st.lastRaise);
        st.canRaise = [true, true];
      } else {
        // short all-in raise: does not reopen betting for the player who already acted
        if (st.acted[o]) st.canRaise[o] = false;
      }
      st.currentBet = tgt;
      rec = { seat: s, street: st.street, type, amount: tgt, allIn: st.stack[s] === 0 };
      break;
    }
  }
  rec.potBefore = potBefore;
  rec.toCallBefore = toCallBefore;
  st.history.push(rec);
  st.acted[s] = true;
  advance(st, s);
  return st;
}

function advance(st: HUState, justActed: 0 | 1) {
  const o = (1 - justActed) as 0 | 1;
  const matched = st.committed[0] === st.committed[1];
  const someoneAllIn = st.stack[0] === 0 || st.stack[1] === 0;
  // round over when both acted and bets are matched, or a call leaves the bettor uncallable
  const roundOver =
    (st.acted[0] && st.acted[1] && matched) ||
    (someoneAllIn && st.acted[o] && st.committed[justActed] <= st.committed[o] && st.history[st.history.length - 1].type === 'call') ||
    (st.stack[justActed] === 0 && st.committed[justActed] <= st.committed[o] && st.acted[o]);
  if (roundOver) {
    finishStreet(st);
    return;
  }
  st.toAct = o;
  // opponent can't act (all-in) and bets are matched or he is behind → round over
  if (st.stack[o] === 0 && st.committed[o] >= st.committed[justActed]) finishStreet(st);
}

/** Close the betting round: return uncalled chips, move to pot, deal next street or show down. */
function finishStreet(st: HUState) {
  const [c0, c1] = st.committed;
  let returned = 0;
  if (c0 !== c1) {
    const hi = c0 > c1 ? 0 : 1;
    const excess = r2(Math.abs(c0 - c1));
    st.stack[hi] = r2(st.stack[hi] + excess);
    st.committed[hi] = r2(st.committed[hi] - excess);
    st.invested[hi] = r2(st.invested[hi] - excess);
    returned = excess;
  }
  st.pot = r2(st.pot + st.committed[0] + st.committed[1]);
  st.committed = [0, 0];
  st.currentBet = 0;
  st.lastRaise = 1;
  st.canRaise = [true, true];
  st.acted = [false, false];
  const allIn = st.stack[0] === 0 || st.stack[1] === 0;
  if (st.street === 3 || allIn) {
    // run out the board and show down
    st.street = 3;
    st.board = st.boardAll.slice();
    showdown(st, returned);
    return;
  }
  st.street = (st.street + 1) as Street;
  st.board = st.boardAll.slice(0, st.street === 1 ? 3 : st.street === 2 ? 4 : 5);
  st.toAct = firstToAct(st.cfg, st.street);
}

function showdown(st: HUState, returned: number) {
  const h0 = evaluate([...st.holes[0], ...st.boardAll]);
  const h1 = evaluate([...st.holes[1], ...st.boardAll]);
  const winners: (0 | 1)[] = h0 > h1 ? [0] : h1 > h0 ? [1] : [0, 1];
  const share = st.pot / winners.length;
  const net: [number, number] = [r2(-st.invested[0]), r2(-st.invested[1])];
  for (const w of winners) net[w] = r2(net[w] + share);
  st.over = true;
  st.toAct = null;
  st.result = { winners, net, reason: 'showdown', returned, hands: [h0, h1] };
}

function awardFold(st: HUState, winner: 0 | 1) {
  // uncalled part of the winner's bet goes back
  const loser = (1 - winner) as 0 | 1;
  let returned = 0;
  if (st.committed[winner] > st.committed[loser]) {
    returned = r2(st.committed[winner] - st.committed[loser]);
    st.stack[winner] = r2(st.stack[winner] + returned);
    st.invested[winner] = r2(st.invested[winner] - returned);
    st.committed[winner] = st.committed[loser];
  }
  st.pot = r2(st.pot + st.committed[0] + st.committed[1]);
  st.committed = [0, 0];
  const net: [number, number] = [r2(-st.invested[0]), r2(-st.invested[1])];
  net[winner] = r2(net[winner] + st.pot);
  st.over = true;
  st.toAct = null;
  st.result = { winners: [winner], net, reason: 'fold', returned };
}

export function clone(st: HUState): HUState {
  return {
    ...st,
    holes: [st.holes[0].slice(), st.holes[1].slice()],
    boardAll: st.boardAll.slice(),
    board: st.board.slice(),
    stack: [...st.stack] as [number, number],
    committed: [...st.committed] as [number, number],
    invested: [...st.invested] as [number, number],
    canRaise: [...st.canRaise] as [boolean, boolean],
    acted: [...st.acted] as [boolean, boolean],
    folded: [...st.folded] as [boolean, boolean],
    history: st.history.slice(),
  };
}

/** Pot including chips committed on the current street. */
export const totalPot = (st: HUState) => r2(st.pot + st.committed[0] + st.committed[1]);

/** Total chips in play (conservation check). */
export const chipsInPlay = (st: HUState) => r2(st.stack[0] + st.stack[1] + st.pot + st.committed[0] + st.committed[1] - st.dead);
