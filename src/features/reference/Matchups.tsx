import data from '../../data/matchups.json';
import { parseCards } from '../../engine/cards';
import { Panel, KindBadge, SourceLink, CardText, pct } from '../../components/ui';

/** Classic preflop all-in matchups, enumerated exactly over all 1,712,304 boards. */
export function Matchups() {
  const groups = [...new Set(data.matchups.map((m) => m.group))];
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Common preflop matchups <KindBadge kind="math" />
        </span>
      }
      right={<SourceLink ids={['engine', 'dc-equity']} extra="Exact enumeration of all 1,712,304 boards by this app's evaluator. Matchups that also appear in DeucesCracked's exact table agree to two decimals (tests/equity.test.ts)." />}
    >
      <p className="mb-3 text-xs text-muted">All-in before the flop, five cards to come. Exact suits matter slightly; the cards shown are the ones calculated.</p>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g}</div>
            <div className="space-y-2">
              {data.matchups
                .filter((m) => m.group === g)
                .map((m) => {
                  const eqA = m.win + m.tie / 2;
                  return (
                    <div key={m.a + m.b} className="rounded-xl bg-surface-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          <CardText cards={parseCards(m.a)} /> <span className="text-muted">vs</span> <CardText cards={parseCards(m.b)} />
                        </span>
                        <span className="tabular text-xs text-muted">
                          win {pct(m.win)} · tie {pct(m.tie)} · lose {pct(m.lose)}
                        </span>
                      </div>
                      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" aria-label={`${pct(eqA)} equity`}>
                        <div style={{ width: `${m.win * 100}%`, background: 'var(--series-1)' }} />
                        <div style={{ width: `${m.tie * 100}%`, background: 'var(--muted)' }} />
                        <div style={{ width: `${m.lose * 100}%`, background: 'var(--series-2)' }} />
                      </div>
                      <div className="mt-1 flex justify-between text-xs">
                        <span className="tabular font-semibold">{pct(eqA)} equity</span>
                        <span className="tabular text-muted">{pct(1 - eqA)}</span>
                      </div>
                      {m.note && <div className="mt-1 text-xs text-muted">{m.note}</div>}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
