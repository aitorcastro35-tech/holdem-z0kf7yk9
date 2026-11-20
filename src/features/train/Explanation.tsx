import type { Spot, SpotNumbers } from '../../scenarios/types';
import type { Grade } from '../../store/progress';
import { conceptById } from '../../data/concepts';
import { bluffBreakEven, mdf } from '../../engine/odds';
import { classOfCards } from '../../engine/range';
import { features, describeFeatures } from '../../engine/handclass';
import vsRandom from '../../data/preflopVsRandom.json';
import { Panel, KindBadge, SourceLink, CardText, Stat, pct, cx } from '../../components/ui';
import { useSettings, fmtAmount } from '../../store/settings';
import { go } from '../../router';

export const GRADE_UI: Record<Grade, { label: string; icon: string; color: string }> = {
  best: { label: 'Best', icon: '✅', color: 'var(--good)' },
  ok: { label: 'Acceptable', icon: '🟡', color: 'var(--ok)' },
  mistake: { label: 'Mistake', icon: '❌', color: 'var(--bad)' },
};

export function fillPlaceholders(line: string, n: SpotNumbers, spot: Spot): string {
  return line.replace(/\{([a-zA-Z]+)(?::(\d+))?\}/g, (_m, k: string, arg?: string) => {
    const approx = n.equityExact === false ? '≈' : '';
    switch (k) {
      case 'equity':
        return n.equity !== undefined ? `${approx}${pct(n.equity)}` : '—';
      case 'required':
        return n.requiredEquity !== undefined ? pct(n.requiredEquity) : '—';
      case 'outs':
        return String(n.outs?.all.length ?? 0);
      case 'clean':
        return String(n.outs?.clean.length ?? 0);
      case 'next':
        return n.outs ? pct(n.outs.next) : '—';
      case 'byRiver':
        return n.outs?.byRiver !== undefined ? pct(n.outs.byRiver) : '—';
      case 'combos':
        return n.villainCombos !== undefined ? n.villainCombos.toFixed(0) : '—';
      case 'ev':
        return n.evCall !== undefined ? `${n.evCall >= 0 ? '+' : ''}${n.evCall.toFixed(2)}bb` : '—';
      case 'spr':
        return n.spr.toFixed(1);
      case 'mdf':
        return spot.toCall > 0 ? pct(mdf(spot.pot - spot.toCall, spot.toCall)) : '—';
      case 'alpha':
        return pct(bluffBreakEven(1, parseInt(arg ?? '50') / 100));
      default:
        return _m;
    }
  });
}

export function Explanation({ spot, numbers, chosen, grade }: { spot: Spot; numbers: SpotNumbers; chosen: string; grade: Grade }) {
  const [settings] = useSettings();
  const g = GRADE_UI[grade];
  const bestOpt = spot.options.find((o) => o.key === spot.best);
  const chosenOpt = spot.options.find((o) => o.key === chosen);
  const acceptable = spot.options.filter((o) => spot.grades[o.key] === 'ok' && o.key !== spot.best);
  const cls = classOfCards(spot.hero[0], spot.hero[1]);
  const f = spot.board.length ? features(spot.hero, spot.board) : null;
  const chosenBet = chosenOpt && (chosenOpt.kind === 'bet' || chosenOpt.kind === 'raise') && chosenOpt.amount ? chosenOpt.amount : null;
  const potBeforeBet = spot.pot - spot.toCall;
  const kindBadge = spot.gradeBasis === 'equity' ? 'math' : 'theory';

  return (
    <div className="space-y-3">
      {/* 1. Verdict */}
      <Panel className={cx('border-2')}>
        <div className="flex flex-wrap items-center justify-between gap-2" style={{ color: g.color }}>
          <div className="text-xl font-bold">
            {g.icon} {g.label}
          </div>
          <KindBadge kind={kindBadge} />
        </div>
        <div className="mt-1 text-sm">
          You chose <b>{chosenOpt?.label}</b>. Recommended: <b>{bestOpt?.label}</b>
          {acceptable.length > 0 && <span className="text-muted"> · also acceptable: {acceptable.map((o) => o.label).join(', ')}</span>}
        </div>
        <div className="mt-1 text-xs text-muted">
          Graded by:{' '}
          {spot.gradeBasis === 'chart'
            ? 'the cited preflop chart (a theory baseline)'
            : spot.gradeBasis === 'equity' && spot.toCall === 0
              ? 'the value rule — bet when you beat more than half of the hands that call (equities vs the stated range)'
              : spot.gradeBasis === 'equity'
              ? 'equity vs the stated villain range compared with the price (±3 points = close)'
              : 'standard theory for this spot (written rationale below)'}
        </div>
      </Panel>

      {/* 2. Numbers */}
      <Panel
        title={
          <span className="flex items-center gap-2">
            The numbers <KindBadge kind="math" />
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {numbers.equity !== undefined && (
            <Stat label="Your equity" value={`${numbers.equityExact === false ? '≈ ' : ''}${pct(numbers.equity)}`} sub={`vs villain range${numbers.equityExact === false ? ' (Monte Carlo)' : ' (exact)'}`} tone="good" />
          )}
          {numbers.requiredEquity !== undefined && <Stat label="Required equity" value={pct(numbers.requiredEquity)} sub={`call ${fmtAmount(spot.toCall, settings)} to win ${fmtAmount(spot.pot, settings)}`} tone="ok" />}
          {numbers.evCall !== undefined && (
            <Stat label="EV of calling" value={`${numbers.evCall >= 0 ? '+' : ''}${numbers.evCall.toFixed(2)}bb`} sub="vs folding, no more betting" tone={numbers.evCall >= 0 ? 'good' : 'bad'} />
          )}
          {numbers.villainCombos !== undefined && <Stat label="Villain combos" value={numbers.villainCombos.toFixed(0)} sub="after blockers" />}
          {spot.street === 'preflop' && (
            <Stat label={`${cls} vs random`} value={`≈ ${pct((vsRandom.equity as Record<string, number>)[cls])}`} sub={`rank #${vsRandom.ranking.indexOf(cls) + 1} of 169`} />
          )}
          {spot.board.length > 0 && <Stat label="SPR" value={numbers.spr.toFixed(1)} sub="stack ÷ pot" />}
          {chosenBet && spot.toCall === 0 && <Stat label="Your bet must work" value={pct(bluffBreakEven(spot.pot, chosenBet))} sub="as a pure bluff" />}
          {spot.mode === 'B' && spot.toCall > 0 && potBeforeBet > 0 && spot.street !== 'preflop' && <Stat label="MDF" value={pct(mdf(potBeforeBet, spot.toCall))} sub="benchmark" />}
        </div>
        {f && (
          <p className="mt-3 text-sm">
            Your hand: <b>{describeFeatures(f)}</b>
          </p>
        )}
        {numbers.outs && (
          <div className="mt-2 space-y-1 text-sm">
            <div>
              Outs to a straight or better: <b>{numbers.outs.all.length}</b> — next card <b>{pct(numbers.outs.next)}</b>
              {numbers.outs.byRiver !== undefined && (
                <>
                  , by the river <b>{pct(numbers.outs.byRiver)}</b>
                </>
              )}
            </div>
            {numbers.outs.clean.length > 0 && (
              <div>
                Clean: <CardText cards={numbers.outs.clean} />
              </div>
            )}
            {numbers.outs.dirty.length > 0 && (
              <div>
                Dirty:{' '}
                {numbers.outs.dirty.map((d) => (
                  <span key={d.card} className="mr-2">
                    <CardText cards={[d.card]} /> <span className="text-xs text-muted">({d.reasons.join('; ')})</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* 3. Why */}
      <Panel title="Why">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {spot.why.map((w, i) => (
            <li key={i}>{fillPlaceholders(w, numbers, spot)}</li>
          ))}
        </ul>
      </Panel>

      {/* 4. Assumptions */}
      <Panel title="Assumptions" right={<SourceLink ids={spot.sources} />}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            {spot.tableSize === 6 ? '6-max' : 'Full ring'}, effective stack {fmtAmount(spot.effStack, settings)}.
          </li>
          {spot.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </Panel>

      {/* 7. Exploit note (separate from the baseline) */}
      {settings.showExploits && spot.exploit && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              Home-game note <KindBadge kind="exploit" />
            </span>
          }
        >
          <p className="text-sm">{spot.exploit}</p>
        </Panel>
      )}

      {/* 5. Concepts */}
      <div className="flex flex-wrap gap-2">
        {spot.concepts.map((c) => {
          const con = conceptById(c);
          return con ? (
            <button key={c} onClick={() => go(`reference/concepts?focus=${c}`)} className="rounded-full border border-info px-3 py-1 text-xs text-info hover:bg-info/10">
              {con.title} →
            </button>
          ) : null;
        })}
      </div>

      {/* 6. Show me the math */}
      <details className="rounded-2xl border border-line bg-surface p-4 text-sm">
        <summary className="font-semibold text-info">Show me the math</summary>
        <div className="mt-3 space-y-2 font-mono text-xs leading-relaxed">
          {spot.toCall > 0 && numbers.requiredEquity !== undefined && (
            <p>
              Required equity = call ÷ (pot after call) = {spot.toCall} ÷ ({spot.pot} + {spot.toCall}) = {spot.toCall} ÷ {(spot.pot + spot.toCall).toFixed(1)} ={' '}
              {pct(numbers.requiredEquity, 2)}
            </p>
          )}
          {numbers.equity !== undefined && (
            <p>
              Equity = win + tie/2 = {pct(numbers.win ?? 0, 2)} + {pct((numbers.tie ?? 0) / 2, 2)} = {pct(numbers.equity, 2)}{' '}
              {numbers.equityExact ? '(every remaining runout × every villain combo enumerated)' : '(Monte Carlo estimate, ±~0.4%)'}
            </p>
          )}
          {numbers.evCall !== undefined && numbers.equity !== undefined && (
            <p>
              EV(call) = equity × final pot − call = {numbers.equity.toFixed(4)} × {(spot.pot + spot.toCall).toFixed(1)} − {spot.toCall} = {numbers.evCall.toFixed(2)}bb
            </p>
          )}
          {numbers.outs && (
            <p>
              P(next card) = {numbers.outs.all.length} ÷ {52 - 2 - spot.board.length} = {pct(numbers.outs.next, 2)}
              {numbers.outs.byRiver !== undefined && (
                <>
                  {' '}
                  · P(by river) = 1 − C({47 - numbers.outs.all.length},2)/C(47,2) = {pct(numbers.outs.byRiver, 2)}
                </>
              )}
            </p>
          )}
          {chosenBet && spot.toCall === 0 && (
            <p>
              Bluff break-even = bet ÷ (pot + bet) = {chosenBet} ÷ ({spot.pot} + {chosenBet}) = {pct(bluffBreakEven(spot.pot, chosenBet), 2)}
            </p>
          )}
          {spot.villain && <p className="font-sans text-muted">Villain range: {spot.villain.label}{spot.villain.parts.map((p) => p.range.startsWith('@') ? '' : ` [${p.range}]`).join('')}</p>}
          {!spot.toCall && !numbers.equity && <p className="font-sans text-muted">This decision is graded against the cited chart; see Reference → Preflop charts for the full range.</p>}
        </div>
      </details>
    </div>
  );
}
