// Promise-based client for the equity Web Worker (keeps heavy enumeration off the UI thread).
import type { EquityResult, EquityOptions } from '../engine/equity';
import type { Card } from '../engine/cards';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: EquityResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: EquityResult; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
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
