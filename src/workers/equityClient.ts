// Promise-based client for the equity Web Worker (keeps heavy enumeration off the UI thread).
import type { EquityResult, EquityOptions } from '../engine/equity';
import type { Card } from '../engine/cards';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: EquityResult) => void; reject: (e: Error) => void; multi?: (m: { equity: number[]; exact: boolean; samples: number }) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: EquityResult; multi?: { equity: number[]; exact: boolean; samples: number }; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else if (e.data.multi) p.multi?.(e.data.multi);
      else p.resolve(e.data.result!);
    };
  }
  return worker;
}

export function computeEquity(args: {
  hero: Card[];
  board?: Card[];
  villainHand?: Card[];
  villainRange?: string;
  villainCombos?: { cards: [Card, Card]; weight: number }[];
  opts?: EquityOptions;
}): Promise<EquityResult> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, hero: args.hero, board: args.board ?? [], villainHand: args.villainHand, villainRange: args.villainRange, villainCombos: args.villainCombos, opts: args.opts });
  });
}

/** Hero vs several opponents' weighted ranges (Monte Carlo in the worker). */
export function computeMultiEquity(hero: Card[], ranges: { cards: [Card, Card]; weight: number }[][], board: Card[], opts: { iterations?: number; seed?: number; timeBudgetMs?: number }): Promise<EquityResult> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, hero, board, multiRanges: ranges, multiOpts: opts });
  });
}

/** Every known hand's equity (exact when feasible). */
export function computeHandsEquity(hands: Card[][], board: Card[], seed = 1): Promise<{ equity: number[]; exact: boolean; samples: number }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: () => {}, reject, multi: resolve });
    getWorker().postMessage({ id, hero: [], board, multiHands: hands, multiOpts: { seed } });
  });
}
