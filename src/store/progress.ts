// Answer history, streaks, and spaced-repetition state. Pure functions are exported for tests.
import { usePersisted, load, save } from './storage';

export type Grade = 'best' | 'ok' | 'mistake';

export interface AnswerRecord {
  t: number; // timestamp
  kind: 'hand' | 'card';
  id: string; // scenario/card id (procedural spots get a generated id)
  mode?: 'A' | 'B';
  street?: 'preflop' | 'flop' | 'turn' | 'river';
  position?: string;
  concepts: string[];
  tags: string[]; // e.g. 'facing-bet', 'river', 'half-pot', 'oop', 'offsuit-broadway'
  grade: Grade;
  chosen?: string;
  best?: string;
  summary?: string; // short human description for the mistakes list
  replay?: unknown; // enough data to replay the spot in "review my mistakes"
}

export interface ProgressState {
  answers: AnswerRecord[];
  activeDays: string[]; // YYYY-MM-DD (local) on which the user answered at least once
}

export const EMPTY_PROGRESS: ProgressState = { answers: [], activeDays: [] };
const MAX_ANSWERS = 3000;

export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function recordAnswer(rec: AnswerRecord) {
  const p = load<ProgressState>('progress', EMPTY_PROGRESS);
  const day = dayKey(rec.t);
  save<ProgressState>('progress', {
    answers: [...p.answers, rec].slice(-MAX_ANSWERS),
    activeDays: p.activeDays.includes(day) ? p.activeDays : [...p.activeDays, day].slice(-400),
  });
}

export function useProgress() {
  return usePersisted<ProgressState>('progress', EMPTY_PROGRESS);
}

/** Consecutive active days ending today (or yesterday, so the streak isn't lost before you play today). */
export function streak(activeDays: string[], now = Date.now()): number {
  const set = new Set(activeDays);
  let n = 0;
  let t = now;
  if (!set.has(dayKey(t))) t -= 86_400_000;
  while (set.has(dayKey(t))) {
    n++;
    t -= 86_400_000;
  }
  return n;
}

// ---------------- Leitner spaced repetition ----------------

export interface CardState {
  box: number; // 1..5
  due: number; // timestamp
  seen: number;
  correct: number;
}
export interface FlashState {
  cards: Record<string, CardState>;
}
export const EMPTY_FLASH: FlashState = { cards: {} };

/** Days until next review for each box (box 1 = again soon). */
export const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 16];

export function nextCardState(prev: CardState | undefined, correct: boolean, now = Date.now()): CardState {
  const p = prev ?? { box: 1, due: now, seen: 0, correct: 0 };
  const box = correct ? Math.min(5, p.box + 1) : 1;
  const due = correct ? now + BOX_INTERVAL_DAYS[box] * 86_400_000 : now + 5 * 60_000;
  return { box, due, seen: p.seen + 1, correct: p.correct + (correct ? 1 : 0) };
}

export function useFlash() {
  return usePersisted<FlashState>('flashcards', EMPTY_FLASH);
}

// ---------------- aggregation helpers ----------------

export interface Acc {
  n: number;
  best: number;
  ok: number;
  mistake: number;
}
export const accOf = (rs: AnswerRecord[]): Acc => ({
  n: rs.length,
  best: rs.filter((r) => r.grade === 'best').length,
  ok: rs.filter((r) => r.grade === 'ok').length,
  mistake: rs.filter((r) => r.grade === 'mistake').length,
});
/** Accuracy counts "acceptable" as correct. */
export const accuracy = (a: Acc) => (a.n ? (a.best + a.ok) / a.n : 0);

export function groupBy(rs: AnswerRecord[], key: (r: AnswerRecord) => string | string[] | undefined): Map<string, Acc> {
  const m = new Map<string, AnswerRecord[]>();
  for (const r of rs) {
    const k = key(r);
    for (const kk of Array.isArray(k) ? k : k ? [k] : []) {
      if (!m.has(kk)) m.set(kk, []);
      m.get(kk)!.push(r);
    }
  }
  return new Map([...m].map(([k, v]) => [k, accOf(v)]));
}

/** Concepts with the worst recent accuracy (min samples), used to weight the daily drill. */
export function weakConcepts(rs: AnswerRecord[], minN = 3, recent = 300): string[] {
  const g = groupBy(rs.slice(-recent), (r) => r.concepts);
  return [...g]
    .filter(([, a]) => a.n >= minN)
    .sort((a, b) => accuracy(a[1]) - accuracy(b[1]))
    .filter(([, a]) => accuracy(a) < 0.8)
    .map(([k]) => k);
}
