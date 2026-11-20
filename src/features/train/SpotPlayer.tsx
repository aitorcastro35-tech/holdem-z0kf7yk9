import { useEffect, useMemo, useState } from 'react';
import type { Spot, OptKind } from '../../scenarios/types';
import { staticNumbers, withEquity } from '../../scenarios/compute';
import { recordAnswer, type Grade } from '../../store/progress';
import { Table } from './Table';
import { Explanation, GRADE_UI } from './Explanation';
import { Button, cx } from '../../components/ui';

const KEY_FOR: Record<OptKind, string> = { fold: 'F', check: 'C', call: 'C', bet: 'B', raise: 'R' };
const KIND_ORDER: OptKind[] = ['fold', 'check', 'call', 'bet', 'raise'];

export function SpotPlayer({ spot, onNext, progressLabel, review }: { spot: Spot; onNext: (grade: Grade) => void; progressLabel?: string; review?: boolean }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<OptKind | null>(null);

  const numbers = useMemo(() => {
    const base = staticNumbers(spot);
    return spot.precomputedEquity ? withEquity(base, spot, spot.precomputedEquity) : base;
  }, [spot]);

  const grade: Grade | null = chosen ? (spot.grades[chosen] ?? 'mistake') : null;

  const answer = (key: string) => {
    if (chosen) return;
    setChosen(key);
    setPendingKind(null);
    const g = spot.grades[key] ?? 'mistake';
    const opt = spot.options.find((o) => o.key === key)!;
    recordAnswer({
      t: Date.now(),
      kind: 'hand',
      id: spot.id,
      mode: spot.mode,
      street: spot.street,
      position: spot.heroPos,
      concepts: spot.concepts,
      tags: [...spot.tags, `chose-${opt.kind}`, `best-${spot.options.find((o) => o.key === spot.best)?.kind ?? ''}`],
      grade: g,
      chosen: opt.label,
      best: spot.options.find((o) => o.key === spot.best)?.label,
      summary: `${spot.title ?? (spot.mode === 'A' ? 'Your move' : 'Facing action')} — ${spot.heroPos}, ${spot.street}`,
      replay: g === 'mistake' && !review ? spot : undefined,
    });
  };

  const byKind = (k: OptKind) => spot.options.filter((o) => o.kind === k);
  const pressKind = (k: OptKind) => {
    const opts = byKind(k);
    if (opts.length === 1) answer(opts[0].key);
    else if (opts.length > 1) setPendingKind(k);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if (chosen) {
        if (key === ' ' || key === 'enter') {
          e.preventDefault();
          onNext(grade!);
        }
        return;
      }
      if (pendingKind && /^[1-9]$/.test(key)) {
        const o = byKind(pendingKind)[parseInt(key) - 1];
        if (o) answer(o.key);
        return;
      }
      if (key === 'escape') setPendingKind(null);
      if (key === 'f') pressKind('fold');
      if (key === 'c') pressKind(byKind('check').length ? 'check' : 'call');
      if (key === 'b') pressKind('bet');
      if (key === 'r') pressKind('raise');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const kinds = KIND_ORDER.filter((k) => byKind(k).length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {spot.mode === 'A' ? 'Your move' : 'Facing action'}
          {spot.title ? ` · ${spot.title}` : ''}
        </span>
        {progressLabel && <span>{progressLabel}</span>}
      </div>
      <Table spot={spot} />

      {!chosen && (
        <div className="space-y-2">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
            {kinds.map((k) => {
              const opts = byKind(k);
              const single = opts.length === 1;
              return (
                <Button
                  key={k}
                  variant={k === 'fold' ? 'secondary' : 'primary'}
                  className={cx('min-h-14 text-base capitalize', pendingKind === k && 'ring-2 ring-fg', k === 'fold' && 'border-bad/50')}
                  onClick={() => (single ? answer(opts[0].key) : setPendingKind(pendingKind === k ? null : k))}
                >
                  {single ? opts[0].label : k === 'bet' ? 'Bet…' : 'Raise…'}
                  <span className="ml-1 hidden text-xs opacity-60 sm:inline">({KEY_FOR[k]})</span>
                </Button>
              );
            })}
          </div>
          {pendingKind && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {byKind(pendingKind).map((o, i) => (
                <Button key={o.key} onClick={() => answer(o.key)} className="min-h-12">
                  <span className="mr-1 hidden text-xs text-muted sm:inline">{i + 1}</span>
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {chosen && grade && (
        <>
          <Explanation spot={spot} numbers={numbers} chosen={chosen} grade={grade} />
          <div className="sticky bottom-20 z-30 sm:bottom-4">
            <Button variant="primary" className="w-full min-h-14 text-base shadow-xl" onClick={() => onNext(grade)}>
              Next hand <span className="ml-1 hidden text-xs opacity-70 sm:inline">(Space)</span>
              <span className="ml-2">{GRADE_UI[grade].icon}</span>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
