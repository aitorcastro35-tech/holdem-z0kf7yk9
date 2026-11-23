/// <reference lib="webworker" />
// Range Explorer worker: exact preflop equities from the precomputed table; postflop equities computed on the
// board (exact on turn/river, Monte Carlo on the flop). Posts progress while computing the 169 cells.
import tableData from '../data/preflopTable.json';
import { loadTable, preflopEquity, type PreflopTable } from '../engine/preflopTable';
import { computeGrid, type ExplorerInput, type PairEquity, type RangeEquity } from '../explorer/core';
import { equityVsCombos } from '../engine/equity';

let table: PreflopTable | null = null;
const cache = new Map<number, number>();
const pairEq: PairEquity = (h, v) => {
  if (!table) table = loadTable(tableData as { k: number[]; v: number[] });
  const key = ((h[0] * 52 + h[1]) * 52 + v[0]) * 52 + v[1];
  let e = cache.get(key);
  if (e === undefined) {
    e = preflopEquity(table, h[0], h[1], v[0], v[1]);
    cache.set(key, e);
  }
  return e;
};

self.onmessage = (e: MessageEvent<{ id: number; input: ExplorerInput }>) => {
  const { id, input } = e.data;
  try {
    let rangeEq: RangeEquity | undefined;
    let exact = true;
    if (input.board.length >= 3) {
      const flop = input.board.length === 3;
      exact = !flop;
      rangeEq = (h, vill) =>
        equityVsCombos(h, vill.map((c) => ({ cards: c.cards, weight: c.w, cls: '' })), input.board, flop ? { mode: 'mc', iterations: 4000, seed: h[0] * 53 + h[1] } : { mode: 'exact' }).equity;
    }
    let last = 0;
    const cells = computeGrid(input, rangeEq ? undefined : pairEq, rangeEq, (p) => {
      if (p - last >= 0.02 || p === 1) {
        last = p;
        self.postMessage({ id, progress: p });
      }
    });
    self.postMessage({ id, cells, exact });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
