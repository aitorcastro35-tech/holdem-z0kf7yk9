// Estimated ranges from PUBLIC information only (positions, actions, sizes, board).
// Used by the bot to estimate your range, and by the review to estimate the bot's range ("a reasonable villain
// range"). The rules are simple heuristics written for this app — documented in RANGE_RULES and SOURCES.md.
import type { Card } from '../engine/cards';
import { expandRange, parseRange, classOfCards, ALL_CLASSES, classComboCount, type HandClass } from '../engine/range';
import vsRandom from '../data/preflopVsRandom.json';
import { CHARTS, findChart, type Position } from '../data/charts';
import type { HUAction, HUConfig } from '../engine/headsup';
import { strength, type Strength } from '../scenarios/fullhand';

export interface WCombo {
  cards: [Card, Card];
  w: number;
  cls: HandClass;
}

/** Classes ordered by all-in equity vs a random hand (src/data/preflopVsRandom.json) — a heuristic strength order. */
export const RANKING: HandClass[] = vsRandom.ranking;

/** The strongest classes adding up to `pct` of all 1,326 combos. */
export function topPct(pct: number): Set<HandClass> {
  const out = new Set<HandClass>();
  let n = 0;
  for (const c of RANKING) {
    if (n / 1326 >= pct) break;
    out.add(c);
    n += classComboCount(c);
  }
  return out;
}

const chartRange = (text: string) => new Set(parseRange(text).keys());

/** RFI chart for a position; the 2-player game uses the 6-max BTN chart for the button (approximation). */
export function openRangeFor(cfg: Pick<HUConfig, 'tableSize'>, pos: string): Set<HandClass> | null {
  const size = cfg.tableSize === 2 ? 6 : cfg.tableSize;
  const p = cfg.tableSize === 2 && pos === 'BTN' ? 'BTN' : pos;
  const ch = findChart('rfi', size, p as Position);
  return ch ? chartRange(ch.parts[0].range) : null;
}

export function rangePct(set: Set<HandClass>): number {
  let n = 0;
  for (const c of set) n += classComboCount(c);
  return n / 1326;
}

export type PreflopKind = 'open' | 'limp' | 'check-option' | 'call-open' | '3bet' | 'call-3bet' | '4bet' | 'call-4bet';

export const RANGE_RULES = {
  preflop: [
    'Open-raise: the cited RFI chart for that seat (2-player game: the 6-max button chart).',
    'Limp / complete: hands outside the top 8% at full weight, top 8% at 20% (occasional traps).',
    'Big blind checks its option: hands outside the top 15% at full weight, top 15% at 30%.',
    'Call an open: the cited vs-open chart when one exists (BB vs BTN, BTN vs CO); otherwise hands outside the top 4% but inside a band the size of the opener’s range (×2.0 from the BB — it already has 1bb in and gets the best price —, ×0.7 in position, ×0.5 out of position).',
    '3-bet: the cited chart’s 3-bet range when one exists; otherwise the top 6% plus A5s–A2s.',
    'Call a 3-bet: top 15% minus the top 3%. 4-bet or call a 4-bet / all-in: top 5%, plus the next 5% at 30%.',
  ],
  postflop:
    'After each postflop action, every combo is re-weighted by its hand-strength class on that board (table POSTFLOP_MULT): e.g. a big bet keeps strong hands, many draws and some air; a call keeps pairs and draws but few air hands; a check keeps weaker hands.',
};

/** P(action | strength class) multipliers used to narrow a range after a postflop action. */
export const POSTFLOP_MULT: Record<'bet-big' | 'bet-small' | 'raise' | 'call' | 'check', Record<Strength, number>> = {
  'bet-big': { strong: 1, top: 0.8, draw: 0.6, weak: 0.25, air: 0.3 },
  'bet-small': { strong: 1, top: 1, draw: 0.8, weak: 0.6, air: 0.5 },
  raise: { strong: 1, top: 0.5, draw: 0.5, weak: 0.1, air: 0.2 },
  call: { strong: 0.6, top: 1, draw: 1, weak: 0.7, air: 0.15 },
  check: { strong: 0.5, top: 0.7, draw: 0.9, weak: 1, air: 1 },
};

function preflopWeights(kind: PreflopKind, cfg: Pick<HUConfig, 'tableSize'>, pos: string, oppPos: string): (cls: HandClass) => number {
  const top = (p: number) => topPct(p);
  switch (kind) {
    case 'open': {
      const r = openRangeFor(cfg, pos) ?? top(0.4);
      return (c) => (r.has(c) ? 1 : 0.02);
    }
    case 'limp': {
      const t = top(0.08);
      return (c) => (t.has(c) ? 0.2 : 1);
    }
    case 'check-option': {
      const t = top(0.15);
      return (c) => (t.has(c) ? 0.3 : 1);
    }
    case 'call-open': {
      const ch = CHARTS.find((x) => x.kind === 'vsOpen' && x.hero === pos && x.villain === oppPos);
      if (ch) {
        const call = ch.parts.find((p) => p.action === 'call');
        const r = call ? chartRange(call.range) : new Set<string>();
        return (c) => (r.has(c) ? 1 : 0.02);
      }
      const opener = openRangeFor(cfg, oppPos) ?? top(0.3);
      const k = pos === 'BB' ? 2.0 : isInPosition(cfg, pos, oppPos) ? 0.7 : 0.5;
      const band = top(Math.min(0.9, rangePct(opener) * k));
      const t4 = top(0.04);
      return (c) => (band.has(c) && !t4.has(c) ? 1 : t4.has(c) ? 0.3 : 0.02);
    }
    case '3bet': {
      const ch = CHARTS.find((x) => x.kind === 'vsOpen' && x.hero === pos && x.villain === oppPos);
      const tb = ch?.parts.find((p) => p.action === 'threebet');
      const r = tb ? chartRange(tb.range) : new Set([...top(0.06), 'A5s', 'A4s', 'A3s', 'A2s']);
      return (c) => (r.has(c) ? 1 : 0.02);
    }
    case 'call-3bet': {
      const a = top(0.15);
      const b = top(0.03);
      return (c) => (a.has(c) && !b.has(c) ? 1 : b.has(c) ? 0.3 : 0.02);
    }
    case '4bet':
    case 'call-4bet': {
      const a = top(0.05);
      const b = top(0.1);
      return (c) => (a.has(c) ? 1 : b.has(c) ? 0.3 : 0.01);
    }
  }
}

/** In position postflop? (acts last) */
export function isInPosition(cfg: Pick<HUConfig, 'tableSize'>, pos: string, oppPos: string): boolean {
  if (cfg.tableSize === 2) return pos === 'BTN';
  const order = cfg.tableSize === 6 ? ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'] : ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN'];
  return order.indexOf(pos) > order.indexOf(oppPos);
}

/** Classify a preflop action by how many raises happened before it. */
export function preflopKind(history: HUAction[], idx: number, pos: string): PreflopKind | null {
  const a = history[idx];
  const raisesBefore = history.slice(0, idx).filter((x) => x.street === 0 && x.type === 'raise').length;
  if (a.type === 'fold') return null;
  if (raisesBefore === 0) {
    if (a.type === 'raise') return 'open';
    if (a.type === 'check') return pos === 'BB' ? 'check-option' : null;
    return 'limp';
  }
  if (raisesBefore === 1) return a.type === 'raise' ? '3bet' : a.type === 'call' ? 'call-open' : null;
  if (raisesBefore === 2) return a.type === 'raise' ? '4bet' : a.type === 'call' ? 'call-3bet' : null;
  return a.type === 'raise' || a.type === 'call' ? 'call-4bet' : null;
}

/**
 * Estimate `seat`'s range from the public action history. `dead` = cards the observer can see that the estimated
 * player cannot hold (the observer's own hole cards + board).
 */
export function estimateRange(
  cfg: Pick<HUConfig, 'tableSize' | 'positions'>,
  seat: 0 | 1,
  history: HUAction[],
  board: Card[],
  observerCards: Card[],
): WCombo[] {
  const pos = cfg.positions[seat];
  const oppPos = cfg.positions[1 - seat];
  const dead = new Set([...observerCards, ...board]);
  let combos: WCombo[] = expandRange(parseRange('random'))
    .filter((c) => !dead.has(c.cards[0]) && !dead.has(c.cards[1]))
    .map((c) => ({ cards: c.cards, w: 1, cls: classOfCards(c.cards[0], c.cards[1]) }));
  history.forEach((a, i) => {
    if (a.seat !== seat) return;
    if (a.street === 0) {
      const kind = preflopKind(history, i, pos);
      if (!kind) return;
      const f = preflopWeights(kind, cfg, pos, oppPos);
      combos.forEach((c) => (c.w *= f(c.cls)));
    } else {
      const streetBoard = board.slice(0, a.street === 1 ? 3 : a.street === 2 ? 4 : 5);
      const pot = a.potBefore ?? 1;
      let key: keyof typeof POSTFLOP_MULT;
      if (a.type === 'check') key = 'check';
      else if (a.type === 'call') key = 'call';
      else if (a.type === 'raise') key = 'raise';
      else if (a.type === 'bet') key = a.amount >= 0.6 * pot ? 'bet-big' : 'bet-small';
      else return;
      combos.forEach((c) => (c.w *= POSTFLOP_MULT[key][strength(c.cards, streetBoard)]));
    }
  });
  combos = combos.filter((c) => c.w > 1e-6);
  return combos;
}

/** Aggregate a weighted combo list into per-class weights normalised to the class's max (for the 13×13 grid). */
export function classWeights(combos: WCombo[]): Map<HandClass, number> {
  const sum = new Map<HandClass, number>();
  for (const c of combos) sum.set(c.cls, (sum.get(c.cls) ?? 0) + c.w);
  const out = new Map<HandClass, number>();
  for (const cls of ALL_CLASSES) {
    const s = sum.get(cls);
    if (s) out.set(cls, Math.min(1, s / classComboCount(cls)));
  }
  return out;
}

export const totalWeight = (combos: WCombo[]) => combos.reduce((s, c) => s + c.w, 0);
