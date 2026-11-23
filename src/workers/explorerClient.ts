import type { ExplorerInput, CellResult } from '../explorer/core';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: { cells: CellResult[]; exact: boolean }) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();
const cache = new Map<string, { cells: CellResult[]; exact: boolean }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./explorer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; cells?: CellResult[]; exact?: boolean; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.progress !== undefined && !e.data.cells) return p.progress?.(e.data.progress);
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve({ cells: e.data.cells!, exact: e.data.exact! });
    };
  }
  return worker;
}

/** Compute (or return cached) explorer results. Only the newest request is kept; older ones are cancelled. */
export function runExplorer(input: ExplorerInput, progress?: (p: number) => void): Promise<{ cells: CellResult[]; exact: boolean }> {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  // a running computation can't be interrupted cooperatively: restart the worker
  if (pending.size) {
    worker?.terminate();
    worker = null;
    pending.forEach((p) => p.reject(new Error('cancelled')));
    pending.clear();
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (r) => {
        cache.set(key, r);
        if (cache.size > 30) cache.delete(cache.keys().next().value!);
        resolve(r);
      },
      reject,
      progress,
    });
    getWorker().postMessage({ id, input });
  });
}
