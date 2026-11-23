// Diagnostic: Explorer best response (call/fold) vs the published 10bb BB calling chart.
import data from '../src/data/preflopTable.json';
import { loadTable, preflopEquity } from '../src/engine/preflopTable';
import { computeGrid } from '../src/explorer/core';
import { PUSH_FOLD_REFS } from '../src/data/pushfold';
import { parseRange, expandRange, rangeComboCount } from '../src/engine/range';

const table = loadTable(data as { k: number[]; v: number[] });
const pair = (h: [number, number], v: [number, number]) => preflopEquity(table, h[0], h[1], v[0], v[1]);
const shove = PUSH_FOLD_REFS.find((p) => p.label.startsWith('10bb UTG shove'))!;
const call = parseRange(PUSH_FOLD_REFS.find((p) => p.label.startsWith('10bb BB call'))!.range);
for (const [label, potBefore] of [['no antes, SB dead', 11.5], ['big-blind ante 1bb', 12.5], ['ante 0.125 x 9', 12.625]] as const) {
  const cells = computeGrid({ spot: 'allin-call', villainCombos: expandRange(parseRange(shove.range)).map((c) => ({ cards: c.cards, w: 1 })), board: [], potBefore, heroPosted: 1, toCall: 9, heroBehind: 9, villainBehind: 0, response: { mode: 'fold-pct', foldPct: 0, continuePct: 1, reraisePct: 0 }, realization: 1, raiseRealization: 1 }, pair);
  const ours = new Map(cells.filter((c) => c.best === 'call').map((c) => [c.cls, 1]));
  console.log(label, 'ours', (rangeComboCount(ours) / 1326 * 100).toFixed(1) + '%', 'published', (rangeComboCount(call) / 1326 * 100).toFixed(1) + '%');
  for (const c of cells) if ((c.best === 'call') !== call.has(c.cls)) console.log('  ', c.cls, 'chart', call.has(c.cls) ? 'call' : 'fold', 'EV(call)', (c.ev.call ?? 0).toFixed(3), 'eq', (c.equity * 100).toFixed(2));
  console.log('  required equity', (9 / 20.5 * 100).toFixed(2) + '%');
}
