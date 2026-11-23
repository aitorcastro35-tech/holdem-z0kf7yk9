/// <reference lib="webworker" />
import { equityVsHand, equityVsRange, equityVsCombos, type EquityOptions } from '../engine/equity';
import { parseRange } from '../engine/range';
import { multiEquityHands, multiEquityVsRanges } from '../engine/multiequity';

export interface EquityRequest {
  id: number;
  hero: number[];
  board: number[];
  villainHand?: number[];
  villainRange?: string;
  villainCombos?: { cards: [number, number]; weight: number }[];
  opts?: EquityOptions;
  multiRanges?: { cards: [number, number]; weight: number }[][];
  multiHands?: number[][];
  multiOpts?: { iterations?: number; seed?: number; timeBudgetMs?: number };
}

self.onmessage = (e: MessageEvent<EquityRequest>) => {
  const { id, hero, board, villainHand, villainRange, villainCombos, opts, multiRanges, multiHands, multiOpts } = e.data;
  if (multiHands) {
    try {
      self.postMessage({ id, multi: multiEquityHands(multiHands, board, { iterations: multiOpts?.iterations, seed: multiOpts?.seed }) });
    } catch (err) {
      self.postMessage({ id, error: (err as Error).message });
    }
    return;
  }
  if (multiRanges) {
    try {
      const r = multiEquityVsRanges(hero, multiRanges, board, multiOpts);
      self.postMessage({ id, result: { win: r.equity, tie: 0, lose: 1 - r.equity, equity: r.equity, exact: false, samples: r.samples, combos: 0 } });
    } catch (err) {
      self.postMessage({ id, error: (err as Error).message });
    }
    return;
  }
  try {
    const result = villainHand
      ? equityVsHand(hero, villainHand, board, opts)
      : villainCombos
        ? equityVsCombos(hero, villainCombos.map((c) => ({ ...c, cls: '' })), board, opts)
        : equityVsRange(hero, parseRange(villainRange ?? 'random'), board, opts);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
