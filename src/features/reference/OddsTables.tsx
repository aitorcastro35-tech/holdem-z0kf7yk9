import { flopToTurn, flopToRiver, turnToRiver, ruleOf2, ruleOf4, ruleOf4Corrected, requiredEquityForPotFraction, mdf, bluffBreakEven, oddsAgainst } from '../../engine/odds';
import { facts } from '../../engine/probabilities';
import { Panel, KindBadge, SourceLink, pct } from '../../components/ui';

const DRAWS: Record<number, string> = {
  2: 'Pocket pair → set',
  3: 'One overcard (pair it)',
  4: 'Gutshot',
  5: 'Pair → two pair / trips',
  6: 'Two overcards',
  8: 'Open-ended straight draw',
  9: 'Flush draw',
  12: 'Flush draw + gutshot (approx.)',
  15: 'Flush draw + OESD',
};

export function OddsTables() {
  const outs = Array.from({ length: 20 }, (_, i) => i + 1);
  const sizes = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2];
  const f = [
    ['Dealt a pocket pair', facts.pocketPair()],
    ['Dealt a specific pair (e.g. AA)', facts.specificPair()],
    ['Dealt suited (non-pair)', facts.suited()],
    ['Pocket pair flops a set or quads (a card of its rank hits)', facts.pairFlopsSetOrBetter()],
    ['Unpaired hand pairs a hole card on the flop', facts.unpairedFlopsPair()],
    ['Suited hand flops a flush draw (exactly 2 of suit)', facts.suitedFlopsFlushDraw()],
    ['Suited hand flops a made flush', facts.suitedFlopsFlush()],
  ] as const;
  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Outs → probability <KindBadge kind="math" />
          </span>
        }
        right={<SourceLink ids={['woo', 'engine']} extra="Exact values from combinatorics (47 unseen cards on the flop, 46 on the turn). Matches Wizard of Odds' pot-odds table for 9/8/4 outs." />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-muted">
              <tr>
                <th className="py-1 pr-2">Outs</th>
                <th className="py-1 pr-2">Typical draw</th>
                <th className="py-1 pr-2 text-right">Turn (flop→turn)</th>
                <th className="py-1 pr-2 text-right">River (turn→river)</th>
                <th className="py-1 pr-2 text-right">Rule of 2</th>
                <th className="py-1 pr-2 text-right">Flop→river</th>
                <th className="py-1 pr-2 text-right">Rule of 4</th>
                <th className="py-1 text-right">Corrected ×4</th>
              </tr>
            </thead>
            <tbody>
              {outs.map((o) => (
                <tr key={o} className="border-t border-line tabular">
                  <td className="py-1.5 pr-2 font-semibold">{o}</td>
                  <td className="py-1.5 pr-2 text-xs text-muted">{DRAWS[o] ?? ''}</td>
                  <td className="py-1.5 pr-2 text-right">{pct(flopToTurn(o))}</td>
                  <td className="py-1.5 pr-2 text-right">{pct(turnToRiver(o))}</td>
                  <td className="py-1.5 pr-2 text-right text-muted">{ruleOf2(o)}%</td>
                  <td className="py-1.5 pr-2 text-right font-semibold">{pct(flopToRiver(o))}</td>
                  <td className="py-1.5 pr-2 text-right text-muted" style={{ color: Math.abs(ruleOf4(o) - flopToRiver(o) * 100) > 3 ? 'var(--bad)' : undefined }}>
                    {ruleOf4(o)}%
                  </td>
                  <td className="py-1.5 text-right text-muted">{ruleOf4Corrected(o)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
          <li>"Flop→river" assumes you see both cards (e.g. you are all-in). If you face another bet on the turn, use the one-card numbers.</li>
          <li>Rule of 4 overstates big draws (red = off by more than 3 points). The common correction — 4×outs − (outs − 8) above 8 outs — is shown next to it; it is a rule of thumb, not exact.</li>
          <li>"Typical draw" out counts assume all outs are live and clean; 12 outs for flush draw + gutshot assumes no overlap.</li>
        </ul>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            Bet size → price <KindBadge kind="math" />
          </span>
        }
        right={<SourceLink ids={['wiki-potodds', 'gtow-mdf']} />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-muted">
              <tr>
                <th className="py-1 pr-2">Bet (× pot)</th>
                <th className="py-1 pr-2 text-right">Caller needs equity</th>
                <th className="py-1 pr-2 text-right">MDF</th>
                <th className="py-1 text-right">Bluff must work</th>
              </tr>
            </thead>
            <tbody>
              {sizes.map((s) => (
                <tr key={s} className="border-t border-line tabular">
                  <td className="py-1.5 pr-2 font-semibold">{s === 1 / 3 ? '⅓' : s === 2 / 3 ? '⅔' : s}</td>
                  <td className="py-1.5 pr-2 text-right">{pct(requiredEquityForPotFraction(s))}</td>
                  <td className="py-1.5 pr-2 text-right">{pct(mdf(1, s))}</td>
                  <td className="py-1.5 text-right">{pct(bluffBreakEven(1, s))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Required equity = B / (P + 2B); MDF = P / (P + B); bluff break-even = B / (P + B), with P the pot before the bet.</p>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            Preflop & flop facts <KindBadge kind="math" />
          </span>
        }
        right={<SourceLink ids={['wiki-start', 'engine']} extra="Each value is enumerated over all 1,326 starting hands or all 19,600 flops for a representative hand." />}
      >
        <table className="w-full text-sm">
          <tbody>
            {f.map(([label, fr]) => (
              <tr key={label} className="border-t border-line tabular">
                <td className="py-1.5 pr-2">{label}</td>
                <td className="py-1.5 pr-2 text-right font-semibold">{pct(fr.p, 2)}</td>
                <td className="py-1.5 pr-2 text-right text-muted">
                  {fr.hits.toLocaleString('en-US')} / {fr.total.toLocaleString('en-US')}
                </td>
                <td className="py-1.5 text-right text-muted">{oddsAgainst(fr.p).toFixed(1)} : 1</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
