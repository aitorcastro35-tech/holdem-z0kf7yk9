/// <reference lib="webworker" />
import { equityVsHand, equityVsRange, equityVsCombos, type EquityOptions } from '../engine/equity';
import { parseRange } from '../engine/range';

export interface EquityRequest {
  id: number;
  hero: number[];
  board: number[];
  villainHand?: number[];
  villainRange?: string;
  villainCombos?: { cards: [number, number]; weight: number }[];
  opts?: EquityOptions;
}

self.onmessage = (e: MessageEvent<EquityRequest>) => {
  const { id, hero, board, villainHand, villainRange, villainCombos, opts } = e.data;
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
