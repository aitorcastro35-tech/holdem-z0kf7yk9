// Preflop charts. Every range string below is copied verbatim from a free, publicly readable page
// (no paywall, no email gate) and checked on the date in SOURCES.md. Percentages are the source's own
// numbers; tests/charts.test.ts verifies our parser reproduces them.
import { parseRange, type Range, type HandClass } from '../engine/range';

export type TableSize = 6 | 9;
export type Position = 'UTG' | 'UTG+1' | 'MP' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type ChartKind = 'rfi' | 'vsOpen' | 'vs3bet';
export type Action = 'raise' | 'call' | 'limp' | 'threebet' | 'fold';

export interface SourceRef {
  id: string;
  name: string;
  url: string;
  checked: string; // ISO date
}

export const SOURCES: Record<string, SourceRef> = {
  pokercoaching: {
    id: 'pokercoaching',
    name: 'PokerCoaching.com (Jonathan Little) — Free Preflop Charts',
    url: 'https://pokercoaching.com/preflop-charts/',
    checked: '2026-11-19',
  },
  pokerskillPreflop: {
    id: 'pokerskillPreflop',
    name: 'Poker Skill — Free preflop charts (6-max & full ring)',
    url: 'https://www.pokerskill.com/charts/preflop/',
    checked: '2026-11-19',
  },
  pokerskillOpening: {
    id: 'pokerskillOpening',
    name: 'Poker Skill — Opening ranges by position (incl. BB defense)',
    url: 'https://www.pokerskill.com/charts/opening-ranges/',
    checked: '2026-11-19',
  },
};

export interface ChartPart {
  action: Action;
  range: string; // verbatim
  publishedPercent: number; // as printed by the source
}

export interface Chart {
  id: string;
  kind: ChartKind;
  tableSize: TableSize;
  hero: Position;
  villain?: Position; // opener for vsOpen
  title: string;
  parts: ChartPart[]; // hands not listed = fold
  /** When several actions are allowed for the same hands (e.g. "Raise or Call"), grade any of them as acceptable. */
  mixedActions?: Action[];
  source: string; // key in SOURCES
  assumptions: string;
  note?: string;
}

const PC_6MAX =
  '6-max cash, 100bb effective. Raise to 2.5bb first in, 3bb from the SB. "Implementable" charts: solver mixes simplified to one action per hand. Rake not stated by the source.';
const PC_FR =
  'Full-ring cash chart published for 8 players, 100bb assumed (stack depth not restated for this table by the source). Raise to 2.5bb first in, 3bb from the SB. Rake not stated.';
const PC_FR_9 =
  ' Adapted for 9-handed: the source has no 9th seat, so this app uses the UTG chart for both UTG and UTG+1 and the source\'s UTG+1 chart for MP (the extra early seat gets the tighter range).';

export const CHARTS: Chart[] = [
  // ---------- 6-max RFI (PokerCoaching) ----------
  {
    id: '6-rfi-UTG', kind: 'rfi', tableSize: 6, hero: 'UTG', title: 'UTG (LJ) open — 6-max',
    parts: [{ action: 'raise', range: '66+,A3s+,K8s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo', publishedPercent: 17.6 }],
    source: 'pokercoaching', assumptions: PC_6MAX,
    note: 'The source labels the first 6-max seat "LJ"; at a 6-handed table that seat is under the gun.',
  },
  {
    id: '6-rfi-HJ', kind: 'rfi', tableSize: 6, hero: 'HJ', title: 'HJ open — 6-max',
    parts: [{ action: 'raise', range: '55+,A2s+,K6s+,Q9s+,J9s+,T9s,98s,87s,76s,ATo+,KTo+,QTo+', publishedPercent: 21.4 }],
    source: 'pokercoaching', assumptions: PC_6MAX,
  },
  {
    id: '6-rfi-CO', kind: 'rfi', tableSize: 6, hero: 'CO', title: 'CO open — 6-max',
    parts: [{ action: 'raise', range: '33+,A2s+,K3s+,Q6s+,J8s+,T7s+,97s+,87s,76s,A8o+,KTo+,QTo+,JTo', publishedPercent: 27.8 }],
    source: 'pokercoaching', assumptions: PC_6MAX,
  },
  {
    id: '6-rfi-BTN', kind: 'rfi', tableSize: 6, hero: 'BTN', title: 'BTN open — 6-max',
    parts: [{ action: 'raise', range: '33+,A2s+,K2s+,Q3s+,J4s+,T6s+,96s+,85s+,75s+,64s+,53s+,A4o+,K8o+,Q9o+,J9o+,T8o+,98o', publishedPercent: 43.5 }],
    source: 'pokercoaching', assumptions: PC_6MAX,
  },
  {
    id: '6-rfi-SB', kind: 'rfi', tableSize: 6, hero: 'SB', title: 'SB first in — 6-max',
    parts: [{ action: 'raise', range: '22+,A2s+,K2s+,Q2s+,J2s+,T3s+,94s+,84s+,74s+,63s+,53s+,43s,A2o+,K4o+,Q5o+,J7o+,T7o+,96o+,86o+,76o', publishedPercent: 62.3 }],
    mixedActions: ['raise', 'limp'],
    source: 'pokercoaching', assumptions: PC_6MAX,
    note: 'Source says "Raise or Call": the free text does not say which hands raise and which complete, so either action is graded acceptable for these hands.',
  },
  // ---------- Full ring RFI (PokerCoaching 8-max, adapted to 9 seats) ----------
  ...(
    [
      ['UTG', 'UTG', '77+,A3s+,K9s+,QTs+,JTs,T9s,AQo+,KQo', 11.4],
      ['UTG+1', 'UTG', '77+,A3s+,K9s+,QTs+,JTs,T9s,AQo+,KQo', 11.4],
      ['MP', 'UTG+1', '77+,A3s+,K8s+,QTs+,JTs,T9s,AJo+,KQo', 13.2],
      ['LJ', 'LJ', '66+,A2s+,K7s+,QTs+,JTs,T9s,ATo+,KJo+', 15.7],
      ['HJ', 'HJ', '55+,A2s+,K5s+,Q9s+,J9s+,T9s,ATo+,KTo+,QJo', 19.6],
      ['CO', 'CO', '44+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,54s,A8o+,KTo+,QTo+,JTo', 26.1],
      ['BTN', 'BTN', '22+,A2s+,K2s+,Q3s+,J5s+,T6s+,96s+,86s+,76s,65s,54s,A3o+,K8o+,Q9o+,J9o+,T9o', 40.3],
    ] as [Position, string, string, number][]
  ).map(([pos, srcPos, range, pct]): Chart => ({
    id: `9-rfi-${pos}`, kind: 'rfi', tableSize: 9, hero: pos, title: `${pos} open — full ring`,
    parts: [{ action: 'raise', range, publishedPercent: pct }],
    source: 'pokercoaching',
    assumptions: PC_FR + (pos === 'UTG' || pos === 'UTG+1' || pos === 'MP' ? PC_FR_9 : ''),
    note: srcPos !== pos ? `Uses the source's ${srcPos} chart (see assumptions).` : undefined,
  })),
  {
    id: '9-rfi-SB', kind: 'rfi', tableSize: 9, hero: 'SB', title: 'SB first in — full ring',
    parts: [{ action: 'raise', range: '22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,84s+,73s+,63s+,52s+,42s+,A2o+,K2o+,Q3o+,J5o+,T6o+,96o+,86o+,75o+,65o,54o', publishedPercent: 73.9 }],
    mixedActions: ['raise', 'limp'],
    source: 'pokercoaching', assumptions: PC_FR,
    note: 'Source says "Call or Raise": either is graded acceptable for these hands.',
  },
  // ---------- Facing an open (Poker Skill simplified teaching ranges) ----------
  {
    id: '6-vs-BTN-CO', kind: 'vsOpen', tableSize: 6, hero: 'BTN', villain: 'CO', title: 'BTN vs CO open — 6-max',
    parts: [
      { action: 'threebet', range: 'JJ+, AKs, AKo, A5s-A2s, KQs, KJs, 76s, 65s, 54s', publishedPercent: 5.7 },
      { action: 'call', range: '22-TT, A9s-A6s, AQs, AJs, ATs, KTs, K9s, QJs, QTs, Q9s, JTs, J9s, T9s, T8s, 98s, 87s, AQo, AJo, KQo, KJo, QJo', publishedPercent: 14.0 },
    ],
    source: 'pokerskillPreflop',
    assumptions: '6-max cash, ~100bb. Cutoff opened to 2.5bb, folded to you on the button. 3-bet to ~3x in position. A simplified teaching range (one action per hand), not solver output.',
  },
  {
    id: '6-vs-BB-BTN', kind: 'vsOpen', tableSize: 6, hero: 'BB', villain: 'BTN', title: 'BB vs BTN open — 6-max',
    parts: [
      { action: 'call', range: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o+, K5o+, Q8o+, J8o+, T8o+, 97o+, 87o', publishedPercent: 52.3 },
    ],
    mixedActions: ['call', 'threebet'],
    source: 'pokerskillOpening',
    assumptions: '6-max cash, ~100bb, button opened ~2.5bb, folded to you in the big blind. The source gives one "defend" range and does not split 3-bets from calls, so calling or 3-betting these hands is graded acceptable; folding them is a mistake. Simplified teaching range, not solver output.',
  },
];

// TODO(verify): no free, openly readable source found for "vs 3-bet" (4-bet / call / fold) charts or for
// a full set of vs-open charts by position. Upswing's Preflop Prodigy and PokerCoaching's downloadable
// charts include them but are email-gated. Not included until a verifiable source is found.

export function parsedChart(chart: Chart): { action: Action; range: Range }[] {
  return chart.parts.map((p) => ({ action: p.action, range: parseRange(p.range) }));
}

/** Chart action for a hand class (fold if not listed). */
export function chartAction(chart: Chart, cls: HandClass): Action {
  for (const p of parsedChart(chart)) if ((p.range.get(cls) ?? 0) > 0) return p.action;
  return 'fold';
}

export function findChart(kind: ChartKind, tableSize: TableSize, hero: Position, villain?: Position): Chart | undefined {
  return CHARTS.find((c) => c.kind === kind && c.tableSize === tableSize && c.hero === hero && (!villain || c.villain === villain));
}

export const POSITIONS: Record<TableSize, Position[]> = {
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

/** Resolve "@chartId" or "@chartId:action" references to the chart's verbatim range text. */
export function resolveRange(text: string): string {
  if (!text.startsWith('@')) return text;
  const [id, action] = text.slice(1).split(':');
  const chart = CHARTS.find((c) => c.id === id);
  if (!chart) throw new Error(`Unknown chart reference ${text}`);
  const part = action ? chart.parts.find((p) => p.action === action) : chart.parts[0];
  if (!part) throw new Error(`Chart ${id} has no ${action} part`);
  return part.range;
}
