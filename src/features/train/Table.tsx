import type { Spot } from '../../scenarios/types';
import { Cards, Stat, pct } from '../../components/ui';
import { useSettings, fmtAmount } from '../../store/settings';
import { requiredEquity } from '../../engine/odds';

export function Table({ spot }: { spot: Spot }) {
  const [s] = useSettings();
  const req = spot.toCall > 0 ? requiredEquity(spot.toCall, spot.pot + spot.toCall) : null;
  const showPrice = spot.mode === 'B' && spot.toCall > 0;
  return (
    <div className="space-y-3">
      <div
        className="relative overflow-hidden rounded-3xl border-4 p-4 sm:p-6"
        style={{ background: 'radial-gradient(ellipse at center, var(--felt) 0%, var(--felt-edge) 100%)', borderColor: 'var(--felt-edge)' }}
      >
        <div className="flex items-center justify-between text-xs text-white/80">
          <span className="rounded-full bg-black/30 px-2 py-0.5">{spot.tableSize === 6 ? '6-max' : 'Full ring'}</span>
          <span className="rounded-full bg-black/30 px-2 py-0.5 capitalize">{spot.street}</span>
          {spot.villainPos && <span className="rounded-full bg-black/30 px-2 py-0.5">Villain: {spot.villainPos}</span>}
        </div>
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="text-xs uppercase tracking-wide text-white/70">Pot</div>
          <div className="tabular text-xl font-bold text-white">{fmtAmount(spot.pot, s)}</div>
          <div className="mt-1 min-h-16">
            {spot.board.length > 0 ? <Cards cards={spot.board} size="md" /> : <div className="pt-4 text-sm text-white/60">Preflop</div>}
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="mb-1 text-xs text-white/80">
              You · <b>{spot.heroPos}</b>
            </div>
            <Cards cards={spot.hero} size="lg" />
          </div>
          <div className="text-right text-xs text-white/80">
            <div>Effective stack</div>
            <div className="tabular text-base font-semibold text-white">{fmtAmount(spot.effStack, s)}</div>
            {spot.pot > 0 && spot.board.length > 0 && <div className="mt-1">SPR {(spot.effStack / spot.pot).toFixed(1)}</div>}
          </div>
        </div>
      </div>
      <p className="text-sm text-muted">{spot.history}</p>
      {showPrice && req !== null && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="To call" value={fmtAmount(spot.toCall, s)} />
          <Stat label="Pot after call" value={fmtAmount(spot.pot + spot.toCall, s)} />
          <Stat label="Need equity" value={pct(req)} tone="ok" />
        </div>
      )}
    </div>
  );
}
