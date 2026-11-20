import { useMemo, useState } from 'react';
import { HandSession, type SessionResult } from './HandSession';
import { useProgress } from '../../store/progress';
import type { Spot } from '../../scenarios/types';
import { LIBRARY } from '../../scenarios/library';
import { Panel, Button, Chip } from '../../components/ui';
import { go } from '../../router';
import { useSettings } from '../../store/settings';
import { shuffle } from '../../engine/cards';

function Done({ r, again }: { r: SessionResult; again: () => void }) {
  const n = r.best + r.ok + r.mistake;
  return (
    <Panel title="Session complete">
      <div className="text-lg">
        ✅ {r.best} · 🟡 {r.ok} · ❌ {r.mistake} <span className="text-muted">({n ? Math.round(((r.best + r.ok) / n) * 100) : 0}% correct)</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={again}>
          Again
        </Button>
        <Button onClick={() => go('progress')}>See stats</Button>
        <Button onClick={() => go('train')}>Back</Button>
      </div>
    </Panel>
  );
}

export default function Train({ mode }: { mode?: string }) {
  const [progress] = useProgress();
  const [settings] = useSettings();
  const [done, setDone] = useState<SessionResult | null>(null);
  const [run, setRun] = useState(0);
  const [libFilter, setLibFilter] = useState<'all' | 'A' | 'B'>('all');

  const mistakes = useMemo(() => {
    const seen = new Set<string>();
    const out: Spot[] = [];
    for (const a of [...progress.answers].reverse()) {
      if (a.kind === 'hand' && a.grade === 'mistake' && a.replay && !seen.has(a.id)) {
        seen.add(a.id);
        out.push(a.replay as Spot);
      }
      if (out.length >= 20) break;
    }
    return out;
  }, [progress.answers]);

  // Shuffle the classic-spot list once per session (not on every render).
  const libraryOrder = useMemo(
    () => shuffle(LIBRARY.filter((s) => libFilter === 'all' || s.mode === libFilter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [libFilter, run],
  );

  if (mode === 'A' || mode === 'B' || mode === 'mixed' || mode === 'review' || mode === 'library') {
    if (done) return <Done r={done} again={() => { setDone(null); setRun(run + 1); }} />;
    if (mode === 'review') {
      if (!mistakes.length)
        return (
          <Panel title="No mistakes to review">
            <p className="text-sm text-muted">Mistakes from training sessions appear here so you can replay them.</p>
            <Button className="mt-3" onClick={() => go('train')}>
              Back
            </Button>
          </Panel>
        );
      return <HandSession key={run} mode="mixed" spots={mistakes} review onDone={setDone} />;
    }
    if (mode === 'library') {
      return (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['all', 'A', 'B'] as const).map((f) => (
              <Chip key={f} active={libFilter === f} onClick={() => { setLibFilter(f); setRun(run + 1); }}>
                {f === 'all' ? 'All classics' : f === 'A' ? 'Your move' : 'Facing action'}
              </Chip>
            ))}
          </div>
          <HandSession key={run + libFilter} mode="mixed" spots={libraryOrder} onDone={setDone} />
        </div>
      );
    }
    return <HandSession key={run + mode} mode={mode} count={10} onDone={setDone} />;
  }

  return (
    <div className="space-y-3">
      <Panel title="Train decisions">
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={() => go('train/A')} className="rounded-2xl border border-line bg-surface-2 p-4 text-left hover:brightness-110">
            <div className="text-lg font-semibold">♠ Your move</div>
            <div className="text-sm text-muted">Nobody has bet yet: open, c-bet, value bet or check. 10 hands.</div>
          </button>
          <button onClick={() => go('train/B')} className="rounded-2xl border border-line bg-surface-2 p-4 text-left hover:brightness-110">
            <div className="text-lg font-semibold">♥ Facing action</div>
            <div className="text-sm text-muted">Opponent opened or bet: fold, call or raise — with the price and your equity. 10 hands.</div>
          </button>
          <button onClick={() => go('train/mixed')} className="rounded-2xl border border-line bg-surface-2 p-4 text-left hover:brightness-110">
            <div className="text-lg font-semibold">♣ Mixed</div>
            <div className="text-sm text-muted">Both modes shuffled together. 10 hands.</div>
          </button>
          <button onClick={() => go('train/library')} className="rounded-2xl border border-line bg-surface-2 p-4 text-left hover:brightness-110">
            <div className="text-lg font-semibold">♦ Classic spots</div>
            <div className="text-sm text-muted">{LIBRARY.length} hand-authored spots with written rationale.</div>
          </button>
        </div>
        <Button className="mt-3 w-full" onClick={() => go('train/review')} disabled={!mistakes.length}>
          Review my mistakes ({mistakes.length})
        </Button>
      </Panel>
      <p className="px-1 text-xs text-muted">
        Table size: {settings.tableSize === 6 ? '6-max' : 'full ring'} · difficulty: {settings.difficulty} (change in ⚙ Settings). Keyboard: F fold · C check/call · B bet · R raise · 1–5 size ·
        Space next.
      </p>
    </div>
  );
}
