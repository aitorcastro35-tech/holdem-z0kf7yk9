// Tiny, versioned localStorage wrapper with a React hook. All reads/writes are wrapped in try/catch
// so the app still works (in memory) when storage is blocked.
import { useEffect, useState, useSyncExternalStore } from 'react';

const PREFIX = 'holdem-trainer:';
export const STORAGE_KEYS = ['settings', 'progress', 'flashcards'] as const;
export type StorageKey = (typeof STORAGE_KEYS)[number];

const memory = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

export function load<T>(key: StorageKey, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  let v: T = fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) v = { ...fallback, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  memory.set(key, v);
  return v;
}

export function save<T>(key: StorageKey, value: T) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore quota / blocked storage */
  }
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, cb: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  return () => listeners.get(key)!.delete(cb);
}

/** Shared persisted state; every component using the same key sees the same value. */
export function usePersisted<T>(key: StorageKey, fallback: T): [T, (updater: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => load(key, fallback),
  );
  const set = (u: T | ((prev: T) => T)) => {
    const prev = load(key, fallback);
    save(key, typeof u === 'function' ? (u as (p: T) => T)(prev) : u);
  };
  return [value, set];
}

export function exportAll(): string {
  const data: Record<string, unknown> = { app: 'holdem-trainer', version: 1, exportedAt: new Date().toISOString() };
  for (const k of STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(PREFIX + k);
      data[k] = raw ? JSON.parse(raw) : memory.get(k) ?? null;
    } catch {
      data[k] = memory.get(k) ?? null;
    }
  }
  return JSON.stringify(data, null, 2);
}

export function importAll(json: string) {
  const data = JSON.parse(json);
  if (data?.app !== 'holdem-trainer') throw new Error('This file is not a Hold\'em Trainer export.');
  for (const k of STORAGE_KEYS) {
    if (data[k] != null) {
      memory.delete(k);
      save(k, data[k]);
    }
  }
}

/** Re-render on an interval (e.g. for "today" boundaries). */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
