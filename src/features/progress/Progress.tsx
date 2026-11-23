import { useMemo } from 'react';
import { useProgress, accOf, accuracy, groupBy, streak, type Acc } from '../../store/progress';
import { findLeaks } from './leaks';
import { conceptById } from '../../data/concepts';
import { Panel, Stat, Button, pct } from '../../components/ui';
import { go } from '../../router';

function AccTable({ title, rows }: { title: string; rows: [string, Acc][] }) {
  if (!rows.length) return null;
  return (
    <Panel title={title}>
      <div className="space-y-1.5">
        {rows.map(([k, a]) => {
          const p = accuracy(a);
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <div className="w-32 shrink-0 truncate capitalize sm:w-40">{k}</div>
              <div className="h-2.5 flex-1 overflow-hidden rounded bg-surface-2">
                <div className="h-full rounded" style={{ width: `${p * 100}%`, background: p >= 0.8 ? 'var(--good)' : p >= 0.6 ? 'var(--ok)' : 'var(--bad)' }} />
              </div>
              <div className="tabular w-24 shrink-0 text-right text-xs text-muted">
                {pct(p, 0)} · {a.n}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export default function Progress(_props: { mode?: string }) {
  const [progress] = useProgress();
  const answers = progress.answers;
  const hands = useMemo(() => answers.filter((a) => a.kind === 'hand'), [answers]);
  const cards = useMemo(() => answers.filter((a) => a.kind === 'card'), [answers]);
  const leaks = useMemo(() => findLeaks(answers), [answers]);
  const sorted = (m: Map<string, Acc>, min = 1) => [...m].filter(([, a]) => a.n >= min).sort((a, b) => accuracy(a[1]) - accuracy(b[1]));
  const byMode = groupBy(hands, (r) => (r.mode === 'A' ? 'Your move' : r.mode === 'B' ? 'Facing action' : undefined));
  const byStreet = groupBy(hands, (r) => r.street);
  const byPos = groupBy(hands, (r) => r.position);
  const byConcept = groupBy(answers, (r) => r.concepts.map((c) => conceptById(c)?.title ?? c));
  const byPlayers = groupBy(hands, (r) => r.tags.filter((t) => t.startsWith('players-')).map((t) => `${t.slice(8)} players`));
  const mistakes = [...hands].reverse().filter((a) => a.grade === 'mistake').slice(0, 15);
  const today = answers.filter((a) => new Date(a.t).toDateString() === new Date().toDateString()).length;

  if (!answers.length)
    return (
      <Panel title="No answers yet">
        <p className="text-sm text-muted">Play a few hands or flashcards and your stats, streak and leaks will show up here.</p>
        <Button variant="primary" className="mt-3" onClick={() => go('')}>
          Start today's drill
        </Button>
      </Panel>
    );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Streak" value={`${streak(progress.activeDays)} 🔥`} sub="days in a row" />
        <Stat label="Today" value={today} sub="answers" />
        <Stat label="Hands" value={hands.length} sub={`${pct(accuracy(accOf(hands)), 0)} correct`} />
        <Stat label="Flashcards" value={cards.length} sub={`${pct(accuracy(accOf(cards)), 0)} correct`} />
      </div>

      <Panel title="Leak finder" right={<span className="text-xs text-muted">last 400 hands</span>}>
        {leaks.length ? (
          <ul className="space-y-2">
            {leaks.slice(0, 6).map((l) => (
              <li key={l.id} className="rounded-xl bg-surface-2 p-3">
                <div className="font-semibold">⚠️ {l.message}</div>
                <div className="text-xs text-muted">{l.detail}</div>
                {l.concept && (
                  <button className="mt-1 text-xs text-info hover:underline" onClick={() => go(`reference/concepts?focus=${l.concept}`)}>
                    Study: {conceptById(l.concept)?.title} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No consistent leak yet. A leak is flagged when at least 4 similar spots show an error rate of 35% or more.</p>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <AccTable title="Accuracy by mode" rows={sorted(byMode)} />
        <AccTable title="Accuracy by street" rows={sorted(byStreet)} />
        <AccTable title="Accuracy by position" rows={sorted(byPos)} />
        <AccTable title="Accuracy by number of players (Play a hand)" rows={[...byPlayers].sort((a, b) => parseInt(a[0]) - parseInt(b[0]))} />
        <AccTable title="Weakest concepts" rows={sorted(byConcept, 3).slice(0, 8)} />
      </div>

      <Panel title="Recent mistakes" right={<Button className="min-h-9" onClick={() => go('train/review')} disabled={!mistakes.some((m) => m.replay)}>Review my mistakes</Button>}>
        {mistakes.length ? (
          <ul className="divide-y divide-line text-sm">
            {mistakes.map((m, i) => (
              <li key={i} className="py-2">
                <div>{m.summary}</div>
                <div className="text-xs text-muted">
                  You: {m.chosen} · Best: {m.best} · {new Date(m.t).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No mistakes recorded. 👏</p>
        )}
      </Panel>
      <p className="px-1 text-xs text-muted">Accuracy counts "Acceptable" answers as correct. Export your data from ⚙ Settings.</p>
    </div>
  );
}
