// Leak finder: simple, transparent rules over the answer history. Each leak needs a minimum sample
// and an error rate threshold, and says exactly what it counted.
import type { AnswerRecord } from '../../store/progress';

export interface Leak {
  id: string;
  message: string;
  detail: string;
  errors: number;
  n: number;
  concept?: string;
}

export const LEAK_MIN_N = 4;
export const LEAK_RATE = 0.35;

const FAMILY_LABEL: Record<string, string> = {
  'offsuit-broadway': 'offsuit broadways',
  'suited-broadway': 'suited broadways',
  'offsuit-ace': 'offsuit aces',
  'suited-ace': 'suited aces',
  'pocket-pair': 'pocket pairs',
  'suited-connector': 'suited connectors',
  'suited-other': 'other suited hands',
  'offsuit-other': 'weak offsuit hands',
};
const SIZE_TAGS = ['⅓-pot', '½-pot', '¾-pot', 'pot'];
const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;

const has = (r: AnswerRecord, t: string) => r.tags.includes(t);
const pctStr = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

function rule(
  out: Leak[],
  id: string,
  pool: AnswerRecord[],
  isError: (r: AnswerRecord) => boolean,
  message: string,
  what: string,
  concept?: string,
) {
  if (pool.length < LEAK_MIN_N) return;
  const errors = pool.filter(isError).length;
  if (errors / pool.length >= LEAK_RATE) {
    out.push({ id, message, detail: `${errors} of ${pool.length} ${what} (${pctStr(errors, pool.length)}).`, errors, n: pool.length, concept });
  }
}

export function findLeaks(all: AnswerRecord[], recent = 400): Leak[] {
  const hands = all.filter((r) => r.kind === 'hand').slice(-recent);
  const out: Leak[] = [];

  // 1. Folding too much when calling was correct, by street and bet size.
  for (const st of STREETS) {
    const pool = hands.filter((r) => r.street === st && has(r, 'best-call'));
    rule(out, `overfold-${st}`, pool, (r) => has(r, 'chose-fold') && r.grade === 'mistake', `You fold too often facing ${st} bets.`, `${st} spots where calling was best, you folded`, 'pot-odds');
    for (const sz of SIZE_TAGS) {
      const p2 = pool.filter((r) => has(r, sz));
      rule(out, `overfold-${st}-${sz}`, p2, (r) => has(r, 'chose-fold') && r.grade === 'mistake', `You fold too often to ${sz.replace('-', ' ')} ${st} bets.`, `of those spots you folded`, 'mdf');
    }
  }

  // 2. Calling too much when folding was correct, by position and hand family.
  for (const pos of ['oop', 'ip']) {
    const pool = hands.filter((r) => has(r, pos) && has(r, 'best-fold'));
    rule(out, `overcall-${pos}`, pool, (r) => has(r, 'chose-call') && r.grade === 'mistake', `You over-call ${pos === 'oop' ? 'out of position' : 'in position'}.`, `spots where folding was best, you called`, 'pot-odds');
    for (const fam of Object.keys(FAMILY_LABEL)) {
      const p2 = pool.filter((r) => has(r, fam));
      rule(out, `overcall-${pos}-${fam}`, p2, (r) => has(r, 'chose-call') && r.grade === 'mistake', `You over-call ${pos === 'oop' ? 'out of position' : 'in position'} with ${FAMILY_LABEL[fam]}.`, `such spots you called instead of folding`, 'reverse-implied');
    }
  }

  // 3. Preflop opening discipline, by position.
  const rfi = hands.filter((r) => has(r, 'rfi'));
  const positions = [...new Set(rfi.map((r) => r.position ?? ''))];
  for (const pos of positions) {
    const loose = rfi.filter((r) => r.position === pos && has(r, 'fold-range'));
    rule(out, `loose-${pos}`, loose, (r) => r.grade === 'mistake', `You open too many hands from ${pos}.`, `chart folds from ${pos} you played`, 'preflop-ranges');
    const tight = rfi.filter((r) => r.position === pos && has(r, 'open-range'));
    rule(out, `tight-${pos}`, tight, (r) => has(r, 'chose-fold'), `You fold too many playable hands from ${pos}.`, `chart opens from ${pos} you folded`, 'preflop-ranges');
  }
  const limps = rfi.filter((r) => !r.position?.startsWith('SB'));
  rule(out, 'limping', limps, (r) => has(r, 'chose-call'), 'You limp too often when first in.', 'first-in spots outside the SB you limped', 'preflop-ranges');

  // 4. Your-move spots: missing value / bluffing too much.
  const modeA = hands.filter((r) => r.mode === 'A' && r.street !== 'preflop');
  rule(out, 'missed-value', modeA.filter((r) => has(r, 'best-bet')), (r) => has(r, 'chose-check') && r.grade === 'mistake', 'You check strong hands that should bet for value.', 'spots where betting was best, you checked', 'value-bet');
  rule(out, 'overbluff', modeA.filter((r) => has(r, 'best-check')), (r) => has(r, 'chose-bet') && r.grade === 'mistake', 'You bet too often when checking is better.', 'spots where checking was best, you bet', 'cbet');

  // Keep the most specific leaks: drop a general one if a sub-leak with the same prefix exists.
  const ids = new Set(out.map((l) => l.id));
  return out
    .filter((l) => ![...ids].some((other) => other !== l.id && other.startsWith(l.id + '-')))
    .sort((a, b) => b.errors / b.n - a.errors / a.n);
}
