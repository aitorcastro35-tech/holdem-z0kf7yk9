// Full-hand mode: play one hand flop → turn → river against a villain who follows a STATED, probabilistic
// strategy. The villain's actual hand is dealt at random from his preflop range; every action he takes
// re-weights his range (Bayes: weight × P(action | hand strength)), so the equity you see on each street is
// "your equity vs the hands he could have, given everything he has done". Cards and villain decisions are
// random; the strategy tables below are fixed, shown in the UI, and are a model — not solver output.
import { type Card, FULL_DECK, shuffle, rankOf } from '../engine/cards';
import { parseRange, expandRange } from '../engine/range';
import { features, describeFeatures } from '../engine/handclass';
import { evaluate, Category } from '../engine/evaluator';
import { requiredEquity } from '../engine/odds';
import type { EquityResult } from '../engine/equity';
import type { Settings } from '../store/settings';
import type { Grade } from '../store/progress';
import type { Option, Spot, OptKind } from './types';
import { contexts, pick, type Context, type Rng } from './generators';
import { CHARTS, findChart } from '../data/charts';
import { gradeByEquity, isStrongDraw, handFamily, CLOSE_MARGIN } from './compute';

export type FHStreet = 'flop' | 'turn' | 'river';
export const FH_STREETS: FHStreet[] = ['flop', 'turn', 'river'];

/** Coarse hand-strength classes the villain strategy is defined on. */
export type Strength = 'strong' | 'top' | 'draw' | 'weak' | 'air';
export const STRENGTH_LABEL: Record<Strength, string> = {
  strong: 'two pair or better',
  top: 'top pair / overpair',
  draw: 'flush draw or open-ender',
  weak: 'weaker pair',
  air: 'no pair, no strong draw',
};

export function strength(hole: Card[], board: Card[]): Strength {
  const f = features(hole, board);
  const boardRanks = board.map(rankOf);
  const boardPaired = new Set(boardRanks).size < boardRanks.length;
  if (f.category >= Category.TwoPair && f.improvesBoard) {
    // On a paired board, "two pair" made with one hole card is really a one-pair hand.
    if (boardPaired && f.category === Category.TwoPair) {
      const top = Math.max(...boardRanks);
      const holeRanks = hole.map(rankOf);
      const pocket = holeRanks[0] === holeRanks[1] ? holeRanks[0] : -1;
      const paired = holeRanks.filter((r) => boardRanks.includes(r));
      if (pocket > top || paired.includes(top)) return 'top';
      return 'weak';
    }
    return 'strong';
  }
  if (f.pair === 'top' || f.pair === 'overpair') return 'top';
  if (isStrongDraw(f, board)) return 'draw';
  if (f.category >= Category.Pair && f.improvesBoard) return 'weak';
  return 'air';
}

type Table = Record<FHStreet, Record<Strength, number>>;
/** P(villain bets | strength) when he is first to act (he was the preflop raiser). */
export const P_BET: Table = {
  flop: { strong: 1, top: 1, draw: 1, weak: 0.35, air: 0.35 },
  turn: { strong: 1, top: 0.85, draw: 0.6, weak: 0.15, air: 0.25 },
  river: { strong: 1, top: 0.6, draw: 0, weak: 0.05, air: 0.3 },
};
/** P(villain calls | strength) after he checks and you bet. */
export const P_CALL: Table = {
  flop: { strong: 1, top: 1, draw: 1, weak: 0.8, air: 0.1 },
  turn: { strong: 1, top: 1, draw: 0.8, weak: 0.5, air: 0.05 },
  river: { strong: 1, top: 0.9, draw: 0, weak: 0.4, air: 0 },
};
/** P(villain calls | strength) when you raise his bet (he never re-raises in this model). */
export const P_VS_RAISE: Table = {
  flop: { strong: 1, top: 0.6, draw: 0.6, weak: 0.1, air: 0 },
  turn: { strong: 1, top: 0.5, draw: 0.4, weak: 0.05, air: 0 },
  river: { strong: 1, top: 0.35, draw: 0, weak: 0, air: 0 },
};
const BET_SIZES: Record<FHStreet, number[]> = { flop: [1 / 3, 1 / 2], turn: [1 / 2, 2 / 3, 3 / 4], river: [2 / 3, 3 / 4, 1] };

export type Template = 'random' | 'draw' | 'top' | 'strong' | 'weak' | 'air';
export const TEMPLATE_LABEL: Record<Template, string> = {
  random: 'Any hand',
  draw: 'Drawing hand',
  top: 'Top pair / overpair',
  strong: 'Monster (two pair+)',
  weak: 'Marginal pair',
  air: 'Missed / air',
};

export interface StreetRecord {
  street: FHStreet;
  board: Card[];
  potAtDecision: number;
  villainAction: 'bet' | 'check' | 'none'; // 'none' = you acted first (OOP lead/probe)
  villainBet?: number;
  auto?: boolean; // street checked through behind you with no decision for you
  heroLabel?: string;
  heroKind?: OptKind;
  grade?: Grade;
  bestLabel?: string;
  equity?: number; // vs villain's range at the decision (for checks: his checking range)
  equityExact?: boolean;
  required?: number;
  response?: 'called' | 'folded';
}

export interface FullHand {
  id: string;
  ctx: Context;
  tableSize: 6 | 9;
  template: Template;
  hero: Card[];
  villain: Card[];
  board5: Card[];
  streetIdx: number; // 0 flop, 1 turn, 2 river, 3 = done
  pot: number;
  heroIn: number;
  villainIn: number;
  stack: number; // effective stack behind (both players)
  /** Villain's possible combos (hero's cards removed) with weights from his actions so far. */
  range: { cards: [Card, Card]; w: number }[];
  heroInitiative: boolean; // hero bet/raised and villain called (IP: villain checks to him; OOP: hero may lead)
  /** OOP only: hero acts first this street (after a check-through or after his bet was called). */
  leadAllowed: boolean;
  leadDone: boolean; // hero already checked first this street
  /** 'lead' = it's your turn to act first (out of position). */
  pending?: { action: 'bet' | 'check' | 'lead'; bet: number; frac?: number };
  log: StreetRecord[];
  lines: string[];
  result?: { winner: 'hero' | 'villain' | 'split'; reason: 'hero-folded' | 'villain-folded' | 'showdown'; net: number; heroHand?: string; villainHand?: string };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
export const boardNow = (h: FullHand) => h.board5.slice(0, 3 + Math.min(h.streetIdx, 2));
export const streetOf = (h: FullHand): FHStreet => FH_STREETS[Math.min(h.streetIdx, 2)];

export function startHand(rng: Rng, s: Settings, template: Template = 'random'): FullHand {
  const ctx = pick(rng, contexts(s.tableSize));
  const heroCombos = expandRange(parseRange(ctx.heroRange));
  const villainAll = expandRange(parseRange(ctx.villainRange));
  let hero: Card[] = [];
  let villain: Card[] = [];
  let board5: Card[] = [];
  for (let k = 0; k < 2000; k++) {
    hero = [...pick(rng, heroCombos).cards];
    const vOpts = villainAll.filter((c) => !hero.includes(c.cards[0]) && !hero.includes(c.cards[1]));
    villain = [...pick(rng, vOpts).cards];
    board5 = shuffle(FULL_DECK.filter((c) => !hero.includes(c) && !villain.includes(c)), rng).slice(0, 5);
    if (template === 'random' || strength(hero, board5.slice(0, 3)) === template) break;
  }
  const range = villainAll.filter((c) => !hero.includes(c.cards[0]) && !hero.includes(c.cards[1])).map((c) => ({ cards: c.cards, w: 1 }));
  const stack = s.stackDepth - 2.5;
  return {
    id: `fh-${Date.now().toString(36)}-${Math.floor(rng() * 1e6)}`,
    ctx,
    tableSize: s.tableSize,
    template,
    hero,
    villain,
    board5,
    streetIdx: 0,
    pot: ctx.flopPot,
    heroIn: 2.5,
    villainIn: 2.5,
    stack,
    range,
    heroInitiative: false,
    leadAllowed: false,
    leadDone: false,
    log: [],
    lines: [`${ctx.villainPos} opens 2.5bb, you call in the ${ctx.heroPos}.`],
  };
}

/** Multiply each still-possible villain combo's weight by f(strength) on the current board. */
function reweight(h: FullHand, f: (s: Strength) => number) {
  const board = boardNow(h);
  const dead = new Set(board);
  for (const c of h.range) {
    if (c.w === 0) continue;
    if (dead.has(c.cards[0]) || dead.has(c.cards[1])) {
      c.w = 0;
      continue;
    }
    c.w *= f(strength(c.cards, board));
  }
}

export function weightedCombos(h: FullHand, extra?: (s: Strength) => number) {
  const board = boardNow(h);
  const dead = new Set(board);
  return h.range
    .filter((c) => c.w > 0 && !dead.has(c.cards[0]) && !dead.has(c.cards[1]))
    .map((c) => ({ cards: c.cards, weight: extra ? c.w * extra(strength(c.cards, board)) : c.w }))
    .filter((c) => c.weight > 0);
}

/** Villain acts first on the current street. Mutates h. */
export function villainAct(h: FullHand, rng: Rng) {
  const st = streetOf(h);
  const vs = strength(h.villain, boardNow(h));
  let bet = 0;
  let action: 'bet' | 'check' = 'check';
  let frac: number | undefined;
  if (h.heroInitiative && h.ctx.ip) {
    reweight(h, () => 1); // checks to the aggressor in this model; only removes board-blocked combos
  } else {
    const p = P_BET[st][vs];
    action = rng() < p ? 'bet' : 'check';
    reweight(h, (s) => (action === 'bet' ? P_BET[st][s] : 1 - P_BET[st][s]));
  }
  if (action === 'bet') {
    frac = pick(rng, BET_SIZES[st]);
    bet = Math.min(r1(h.pot * frac), h.stack);
    h.pot = r1(h.pot + bet);
    h.villainIn = r1(h.villainIn + bet);
  }
  h.pending = { action, bet, frac };
  const name = st[0].toUpperCase() + st.slice(1);
  const prefix = h.leadDone ? '' : `${name}: ${h.ctx.ip ? '' : 'you check, '}`;
  const what = action === 'bet' ? `${h.ctx.villainPos} bets ${bet}.` : `${h.ctx.villainPos} checks${h.ctx.ip ? '' : ' behind'}.`;
  h.lines.push(prefix + what);
}

/**
 * Run the villain's actions until it's the hero's turn (h.pending set) or the hand ends.
 * Out of position the hero checks to the raiser on the flop and after calling a bet; after a check-through or after
 * his own bet was called he acts first on the next street (lead / probe).
 */
export function advance(h: FullHand, rng: Rng) {
  while (!h.result && !h.pending) {
    if (!h.ctx.ip && h.leadAllowed && !h.leadDone) {
      h.pending = { action: 'lead', bet: 0 };
      return;
    }
    villainAct(h, rng);
    if (h.pending!.action === 'check' && !h.ctx.ip) {
      // OOP: you checked (implicitly or explicitly) and he checked behind — the street is over.
      h.log.push({ street: streetOf(h), board: boardNow(h), potAtDecision: h.pot, villainAction: 'check', auto: true });
      h.pending = undefined;
      nextStreet(h, true);
    }
  }
}

function nextStreet(h: FullHand, checkedThrough: boolean) {
  if (h.streetIdx >= 2) {
    h.streetIdx = 3;
    showdown(h);
    return;
  }
  h.streetIdx++;
  h.leadAllowed = !h.ctx.ip && (checkedThrough || h.heroInitiative);
  h.leadDone = false;
}

export function decisionOptions(h: FullHand): Option[] {
  const p = h.pending!;
  if (p.action === 'bet') {
    const remaining = r1(h.stack - p.bet); // hero's stack after calling
    const opts: Option[] = [
      { key: 'fold', kind: 'fold', label: 'Fold' },
      { key: 'call', kind: 'call', label: remaining <= 0 ? `Call all-in ${p.bet}` : `Call ${p.bet}` },
    ];
    if (remaining > 0) {
      const to = Math.min(r1(p.bet * 3), h.stack);
      opts.push({ key: 'raise', kind: 'raise', amount: to, label: to >= h.stack ? `All-in ${to}` : `Raise to ${to}` });
    }
    return opts;
  }
  const b50 = Math.min(r1(h.pot * 0.5), h.stack);
  const b75 = Math.min(r1(h.pot * 0.75), h.stack);
  return [
    { key: 'check', kind: 'check', label: 'Check' },
    { key: 'bet-50', kind: 'bet', amount: b50, label: `Bet ½ pot (${b50})` },
    ...(b75 > b50 ? [{ key: 'bet-75', kind: 'bet' as const, amount: b75, label: `Bet ¾ pot (${b75})` }] : []),
  ];
}

/**
 * Grading when the villain checks to you:
 *  - Value rule: a bet makes money for value when you're ahead of the hands that call (equity vs calling range > 50%).
 *  - eqCall ≥ 50%: betting is best (¾ pot when ≥ 65%); checking is acceptable on flop/turn (slow-play / pot control) but a
 *    mistake on the river when eqCall ≥ 60% (missed value).
 *  - eqCall < 50%: checking is best. Betting is acceptable as a bluff/semi-bluff with little showdown value
 *    (equity vs his whole checking range < 30%) or a strong draw before the river, and as a protection bet with medium
 *    strength on the flop (or the turn while ahead of his whole range); otherwise — e.g. on the river — it's a mistake.
 */
export function gradeCheckedTo(eqAll: number, eqCall: number, opts: { options: Option[]; strongDraw: boolean; street: FHStreet }) {
  const grades: Record<string, Grade> = {};
  const bets = opts.options.filter((o) => o.kind === 'bet').map((o) => o.key);
  let best: string;
  if (eqCall >= 0.5) {
    const big = eqCall >= 0.65 && bets.includes('bet-75') ? 'bet-75' : 'bet-50';
    bets.forEach((k) => (grades[k] = k === big ? 'best' : 'ok'));
    grades.check = opts.street === 'river' && eqCall >= 0.6 ? 'mistake' : 'ok';
    best = big;
  } else {
    grades.check = 'best';
    const bluffOk = eqAll < 0.3 || (opts.strongDraw && opts.street !== 'river');
    // Medium strength: on the flop (and on the turn while still ahead of his whole range) a bet for protection /
    // equity denial is a reasonable alternative; on the river it only folds worse and gets called by better.
    const protectionOk = opts.street === 'flop' || (opts.street === 'turn' && eqAll >= 0.5);
    bets.forEach((k) => (grades[k] = bluffOk || protectionOk ? 'ok' : 'mistake'));
    best = 'check';
  }
  return { grades, best };
}

const pctTxt = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Build the decision spot for the current street (equities computed by the injected function, e.g. the worker). */
export async function prepareDecision(
  h: FullHand,
  eqFn: (hero: Card[], combos: { cards: [Card, Card]; weight: number }[], board: Card[]) => Promise<EquityResult>,
): Promise<{ spot: Spot; eqCall?: EquityResult }> {
  const st = streetOf(h);
  const board = boardNow(h);
  const p = h.pending!;
  const options = decisionOptions(h);
  const f = features(h.hero, board);
  const strong = isStrongDraw(f, board);
  const heroDesc = describeFeatures(f).toLowerCase();
  const combos = weightedCombos(h);
  const eq = await eqFn(h.hero, combos, board);
  const villainLabel = `${h.ctx.villainPos}'s opening range, re-weighted by every action he has taken this hand (see the strategy table)`;
  const strategyNote =
    'Villain model (assumption, not a solver): as the preflop raiser he bets two pair+ and top pair almost always, strong draws often, and weak pairs/air sometimes; ' +
    'he gives up more on later streets; facing a raise he continues mostly with strong hands and never re-raises.';
  let grades: Record<string, Grade>;
  let best: string;
  let why: string[];
  let eqCall: EquityResult | undefined;
  if (p.action === 'bet') {
    const req = requiredEquity(p.bet, h.pot + p.bet);
    ({ grades, best } = gradeByEquity(eq.equity, req, { options, strongDraw: strong, street: st }));
    const margin = eq.equity - req;
    why = [
      `${h.ctx.villainPos} bets ${p.bet} into ${r1(h.pot - p.bet)}: you call ${p.bet} to win ${h.pot}, so you need ${pctTxt(req)}.`,
      `Against the hands he can have after betting${h.log.length ? ' again' : ''}, your ${heroDesc} has ${eq.exact ? '' : '≈'}${pctTxt(eq.equity)} — ${margin >= 0 ? 'more' : 'less'} than needed by ${Math.abs(margin * 100).toFixed(1)} points.`,
      Math.abs(margin) < CLOSE_MARGIN
        ? 'Within 3 points: close — calling and folding are both reasonable.'
        : best === 'call'
          ? 'Calling makes money on average at this price.'
          : best === 'fold'
            ? 'Calling loses money on average at this price.'
            : 'With 60%+ equity against his betting range, raise for value.',
    ];
    if (strong && st !== 'river') why.push('Equity assumes no more betting; drawing hands also have implied odds when they hit.');
  } else {
    eqCall = await eqFn(h.hero, weightedCombos(h, (s) => P_CALL[st][s]), board);
    ({ grades, best } = gradeCheckedTo(eq.equity, eqCall.equity, { options, strongDraw: strong, street: st }));
    why = [
      p.action === 'lead'
        ? `You act first${h.heroInitiative ? ' after he called your bet' : ' after the last street checked through'}. Your ${heroDesc} has ${pctTxt(eq.equity)} against his whole range.`
        : `${h.ctx.villainPos} checks${h.heroInitiative ? ' to you after calling your bet' : ''}. Your ${heroDesc} has ${pctTxt(eq.equity)} against his whole checking range.`,
      `If you bet, the hands that continue (mostly pairs and draws) leave you with ${pctTxt(eqCall.equity)}.`,
      eqCall.equity >= 0.5
        ? 'You are ahead of the hands that call: bet for value.'
        : eq.equity < 0.3
          ? 'You are behind the calling hands and have little showdown value: checking is best; a bet only works as a bluff (it needs folds).'
          : st === 'river'
            ? 'You are behind the hands that call but often best at showdown: check — a bet folds out worse hands and gets called by better.'
            : 'You are behind the hands that call but often best at showdown: checking keeps the pot small. A small protection bet is an acceptable alternative this early in the hand.',
    ];
    if (strong && st !== 'river' && eqCall.equity < 0.5) why.push('A semi-bluff is acceptable: your draw has equity when called, plus fold equity.');
  }
  const spot: Spot = {
    id: `${h.id}-${st}`,
    origin: 'math',
    title: `Full hand · ${st}`,
    mode: p.action === 'bet' ? 'B' : 'A',
    street: st,
    tableSize: h.tableSize,
    heroPos: h.ctx.heroPos,
    villainPos: h.ctx.villainPos,
    hero: h.hero,
    board,
    pot: h.pot,
    toCall: p.action === 'bet' ? p.bet : 0,
    effStack: h.stack,
    history: h.lines.join(' '),
    villain: { label: villainLabel, parts: [], combos },
    options,
    grades,
    best,
    gradeBasis: 'equity',
    why,
    concepts: p.action === 'bet' ? ['pot-odds', 'equity', ...(strong ? ['outs'] : []), ...(st === 'river' ? ['bluff-catch'] : [])] : ['value-bet', 'equity', 'fold-equity'],
    assumptions: [
      strategyNote,
      p.action === 'bet' ? 'Grade = equity vs his betting range vs the price (±3 points = close), no further betting assumed.' : 'Grade = the value rule: bet when you beat more than half of the hands that call. (If you check, he may still bet.)',
      `Effective stack ${h.stack}bb at this decision; heads-up single-raised pot.`,
    ],
    sources: [h.ctx.villainChartSource, h.ctx.heroChartSource, 'wiki-potodds', 'engine'],
    tags: ['full-hand', st, h.ctx.ip ? 'ip' : 'oop', p.action === 'bet' ? 'facing-bet' : p.action === 'lead' ? 'lead' : 'checked-to', handFamily(h.hero), strength(h.hero, board)],
    precomputedEquity: eq,
  };
  return { spot, eqCall };
}

/** Apply the hero's choice; the villain responds (randomly, by the strategy table). Mutates h. */
export function heroAct(h: FullHand, spot: Spot, key: string, rng: Rng) {
  const st = streetOf(h);
  const p = h.pending!;
  const opt = spot.options.find((o) => o.key === key)!;
  const vs = strength(h.villain, boardNow(h));
  const rec: StreetRecord = {
    street: st,
    board: boardNow(h),
    potAtDecision: spot.pot,
    villainAction: p.action === 'lead' ? 'none' : p.action,
    villainBet: p.action === 'bet' ? p.bet : undefined,
    heroLabel: opt.label,
    heroKind: opt.kind,
    grade: spot.grades[key] ?? 'mistake',
    bestLabel: spot.options.find((o) => o.key === spot.best)?.label,
    equity: spot.precomputedEquity?.equity,
    equityExact: spot.precomputedEquity?.exact,
    required: spot.toCall > 0 ? requiredEquity(spot.toCall, spot.pot + spot.toCall) : undefined,
  };
  h.pending = undefined;
  let allIn = false;
  const lead = p.action === 'lead' ? `${st[0].toUpperCase() + st.slice(1)}: you` : 'You';
  if (opt.kind === 'fold') {
    h.lines.push(`${lead} fold.`);
    finish(h, 'villain', 'hero-folded');
  } else if (opt.kind === 'call') {
    const amt = p.bet;
    h.pot = r1(h.pot + amt);
    h.heroIn = r1(h.heroIn + amt);
    h.stack = r1(h.stack - amt);
    h.heroInitiative = false;
    h.lines.push(`${lead} call.`);
    allIn = h.stack <= 0;
  } else if (opt.kind === 'check') {
    h.heroInitiative = false;
    h.lines.push(`${lead} check.`);
  } else {
    // bet or raise
    const amt = opt.amount!;
    const extraForVillain = opt.kind === 'raise' ? r1(amt - p.bet) : amt;
    h.pot = r1(h.pot + amt);
    h.heroIn = r1(h.heroIn + amt);
    const table = opt.kind === 'raise' ? P_VS_RAISE : P_CALL;
    const pc = table[st][vs];
    const calls = rng() < pc;
    reweight(h, (s) => (calls ? table[st][s] : 1 - table[st][s]));
    h.lines.push(opt.kind === 'raise' ? `${lead} raise to ${amt}.` : `${lead} bet ${amt}.`);
    if (calls) {
      const put = Math.min(extraForVillain, r1(h.stack - (opt.kind === 'raise' ? p.bet : 0)));
      h.pot = r1(h.pot + put);
      h.villainIn = r1(h.villainIn + put);
      h.stack = r1(h.stack - amt);
      h.heroInitiative = true;
      rec.response = 'called';
      h.lines.push(`${h.ctx.villainPos} calls.`);
      allIn = h.stack <= 0;
    } else {
      rec.response = 'folded';
      h.lines.push(`${h.ctx.villainPos} folds.`);
      // the uncalled part goes back: hero only loses what villain matched
      h.pot = r1(h.pot - (opt.kind === 'raise' ? amt - p.bet : amt));
      h.heroIn = r1(h.heroIn - (opt.kind === 'raise' ? amt - p.bet : amt));
      finish(h, 'hero', 'villain-folded');
    }
  }
  h.log.push(rec);
  if (h.result) return;
  if (allIn) {
    h.streetIdx = 3;
    showdown(h);
    return;
  }
  if (p.action === 'lead' && opt.kind === 'check') {
    h.leadDone = true; // villain acts next on this same street
    return;
  }
  nextStreet(h, opt.kind === 'check');
}

function finish(h: FullHand, winner: 'hero' | 'villain' | 'split', reason: NonNullable<FullHand['result']>['reason']) {
  const net = winner === 'hero' ? r1(h.pot - h.heroIn) : winner === 'split' ? r1(h.pot / 2 - h.heroIn) : r1(-h.heroIn);
  h.result = { winner, reason, net };
  h.streetIdx = 3;
}

function showdown(h: FullHand) {
  const hs = evaluate([...h.hero, ...h.board5]);
  const vs = evaluate([...h.villain, ...h.board5]);
  finish(h, hs > vs ? 'hero' : vs > hs ? 'villain' : 'split', 'showdown');
}

// ---------------------------------------------------------------------------------------------
// Single "checked to you as the preflop raiser" spots (c-bet / barrel / river value), generated with the
// same villain model: you opened the BTN, the BB called and checks to you on every street; on earlier
// streets you bet half pot and he called (his range is re-weighted by P_CALL each time).
// ---------------------------------------------------------------------------------------------
export async function generateCheckedToSpot(
  rng: Rng,
  s: Settings,
  eqFn: (hero: Card[], combos: { cards: [Card, Card]; weight: number }[], board: Card[]) => Promise<EquityResult>,
  forceStreet?: FHStreet,
): Promise<Spot> {
  const btn = findChart('rfi', s.tableSize, 'BTN')!;
  const bbDef = CHARTS.find((c) => c.id === '6-vs-BB-BTN')!;
  const street = forceStreet ?? pick(rng, ['flop', 'flop', 'turn', 'river'] as FHStreet[]);
  const idx = FH_STREETS.indexOf(street);
  const heroCombos = expandRange(parseRange(btn.parts[0].range));
  const hero = [...pick(rng, heroCombos).cards];
  const board = shuffle(FULL_DECK.filter((c) => !hero.includes(c)), rng).slice(0, 3 + idx);
  const ctx: Context = {
    heroPos: 'BTN',
    villainPos: 'BB',
    ip: true,
    heroRange: btn.parts[0].range,
    villainRange: bbDef.parts[0].range,
    villainChartSource: bbDef.source,
    heroChartSource: btn.source,
    flopPot: 5.5,
  };
  const h: FullHand = {
    id: `cb-${Math.floor(rng() * 1e9)}`,
    ctx,
    tableSize: s.tableSize,
    template: 'random',
    hero,
    villain: [], // not needed for a single decision
    board5: [...board, ...Array(5 - board.length).fill(-1)],
    streetIdx: 0,
    pot: 5.5,
    heroIn: 2.5,
    villainIn: 2.5,
    stack: s.stackDepth - 2.5,
    range: expandRange(parseRange(bbDef.parts[0].range), hero).map((c) => ({ cards: c.cards, w: 1 })),
    heroInitiative: idx > 0, // only after you bet an earlier street and he called
    leadAllowed: false,
    leadDone: false,
    log: [],
    lines: [`You open the BTN to 2.5bb, the BB calls.`],
  };
  for (let i = 0; i < idx; i++) {
    const st = FH_STREETS[i];
    const b = r1(h.pot / 2);
    reweight(h, (x) => P_CALL[st][x]);
    h.lines.push(`${st[0].toUpperCase() + st.slice(1)}: BB checks, you bet ${b}, BB calls.`);
    h.pot = r1(h.pot + 2 * b);
    h.stack = r1(h.stack - b);
    h.heroIn = r1(h.heroIn + b);
    h.streetIdx++;
  }
  reweight(h, () => 1); // drop combos blocked by the newest card
  h.lines.push(`${street[0].toUpperCase() + street.slice(1)}: BB checks to you.`);
  h.pending = { action: 'check', bet: 0 };
  const { spot } = await prepareDecision(h, eqFn);
  return {
    ...spot,
    id: `${h.id}-${street}`,
    title: street === 'flop' ? 'C-bet or check?' : street === 'turn' ? 'Barrel the turn?' : 'River: value bet or check?',
    assumptions: [
      `BB's range: the Poker Skill BB-vs-BTN defend range${idx ? ', re-weighted by how likely each hand was to call your earlier bets (strategy table in Full hand mode)' : ''}. He checks every street to you in this drill.`,
      ...spot.assumptions.slice(1),
    ],
    concepts: ['value-bet', 'cbet', 'fold-equity', 'range-advantage'],
    tags: ['checked-to', 'cbet', street, 'ip', handFamily(hero), strength(hero, board)],
    exploit:
      street === 'river'
        ? 'In home games, rivers get called lighter than this model assumes by "sticky" players — value-bet thinner against them, bluff less.'
        : 'Against players who call any pair and any draw, bet your value hands bigger and give up more often with pure air.',
  };
}
