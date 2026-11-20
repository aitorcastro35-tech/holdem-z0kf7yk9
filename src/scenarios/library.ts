// Loads the hand-authored scenario library (JSON) into Spot objects.
import raw from '../data/scenarios/library.json';
import { parseCards } from '../engine/cards';
import type { RangeFilter } from '../engine/handclass';
import type { Grade } from '../store/progress';
import { CHARTS } from '../data/charts';
import { handFamily } from './compute';
import type { Option, Spot, Street, VillainSpec } from './types';

export interface LibSpot {
  id: string;
  title: string;
  mode: 'A' | 'B';
  street: Street;
  tableSize: 6 | 9;
  heroPos: string;
  villainPos: string;
  hero: string;
  board: string;
  pot: number;
  toCall: number;
  betFacing?: number;
  effStack: number;
  history: string;
  villain?: { label: string; parts: { range: string; filter?: RangeFilter; weight?: number }[] };
  options: string[];
  best?: string;
  ok?: string[];
  basis: 'authored' | 'equity' | 'chart';
  chart?: string;
  impliedOdds?: boolean;
  why: string[];
  concepts: string[];
  sources: string[];
  assumptions: string[];
  exploit?: string;
  claims?: { equity?: number; required?: number; outs?: number; villainCombos?: number };
}

export const LIBRARY_RAW: LibSpot[] = (raw as { spots: LibSpot[] }).spots;

const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildOption(code: string, s: LibSpot): Option {
  const [kind, arg] = code.split(':');
  if (kind === 'fold') return { key: code, kind: 'fold', label: 'Fold' };
  if (kind === 'check') return { key: code, kind: 'check', label: 'Check' };
  if (kind === 'call') {
    if (s.street === 'preflop' && s.toCall > 0 && s.mode === 'A') return { key: code, kind: 'call', label: s.heroPos === 'SB' ? `Complete (${s.toCall})` : `Limp (${s.toCall})` };
    return { key: code, kind: 'call', label: `Call ${s.toCall}` };
  }
  if (kind === 'bet') {
    const amt = r1((s.pot * parseFloat(arg)) / 100);
    return { key: code, kind: 'bet', amount: amt, label: `Bet ${arg}% (${amt})` };
  }
  if (kind === 'raise') {
    const x = parseFloat(arg);
    if (s.street === 'preflop') {
      // preflop raise arg = raise-to size in bb
      return { key: code, kind: 'raise', amount: x, label: s.mode === 'B' ? `3-bet to ${x}` : `Raise ${x}bb` };
    }
    const facing = s.betFacing ?? s.toCall;
    const amt = r1(facing * x);
    return { key: code, kind: 'raise', amount: amt, label: `Raise to ${amt}` };
  }
  if (kind === 'allin') return { key: code, kind: 'raise', amount: s.effStack, label: `All-in (${s.effStack})` };
  throw new Error(`Bad option code ${code}`);
}

export function toSpot(s: LibSpot): Spot {
  const options = s.options.map((o) => buildOption(o, s));
  const grades: Record<string, Grade> = {};
  if (s.best) {
    for (const k of s.ok ?? []) grades[k] = 'ok';
    grades[s.best] = 'best';
  }
  const villain: VillainSpec | undefined = s.villain ? { label: s.villain.label, parts: s.villain.parts } : undefined;
  const hero = parseCards(s.hero);
  const chart = s.chart ? CHARTS.find((c) => c.id === s.chart) : undefined;
  return {
    id: s.id,
    origin: 'library',
    title: s.title,
    mode: s.mode,
    street: s.street,
    tableSize: s.tableSize,
    heroPos: s.heroPos,
    villainPos: s.villainPos || undefined,
    hero,
    board: s.board ? parseCards(s.board) : [],
    pot: s.pot,
    toCall: s.toCall,
    effStack: s.effStack,
    history: s.history,
    villain,
    options,
    grades,
    best: s.best ?? '',
    gradeBasis: s.basis === 'equity' ? 'equity' : s.basis === 'chart' ? 'chart' : 'authored',
    why: s.why,
    concepts: s.concepts,
    assumptions: [...(s.villain ? [`Villain range: ${s.villain.label}.`] : []), ...s.assumptions, ...(chart ? [chart.assumptions] : [])],
    sources: s.sources,
    exploit: s.exploit,
    tags: [s.street, s.mode === 'B' ? 'facing-bet' : 'your-move', handFamily(hero), ...s.concepts],
    chartId: s.chart,
  };
}

export const LIBRARY: Spot[] = LIBRARY_RAW.map(toSpot);
