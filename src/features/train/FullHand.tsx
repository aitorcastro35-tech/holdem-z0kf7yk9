import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../engine/cards';
import { equityVsHand } from '../../engine/equity';
import { evaluate, describe as describeHand } from '../../engine/evaluator';
import { computeEquity } from '../../workers/equityClient';
import { useSettings } from '../../store/settings';
import type { Spot } from '../../scenarios/types';
import { newRng } from '../../scenarios/generators';
import {
  startHand,
  advance,
  prepareDecision,
  heroAct,
  strength,
  STRENGTH_LABEL,
  TEMPLATE_LABEL,
  P_BET,
  P_CALL,
  P_VS_RAISE,
  FH_STREETS,
  type FullHand,
  type Template,
  type Strength,
} from '../../scenarios/fullhand';
import { SpotPlayer } from './SpotPlayer';
import { GRADE_UI } from './Explanation';
import { EquityTimeline, type TimelinePoint } from '../../components/EquityTimeline';
import { Panel, Button, Chip, Cards, CardText, KindBadge, Stat, pct, cx } from '../../components/ui';

const rng = newRng();
const eqFn = (hero: Card[], combos: { cards: [Card, Card]; weight: number }[], board: Card[]) => computeEquity({ hero, board, villainCombos: combos });

function StrategyTable() {
  const rows: Strength[] = ['strong', 'top', 'draw', 'weak', 'air'];
  const cell = (v: number) => (v === 0 ? '—' : `${Math.round(v * 100)}%`);
  return (
    <details className="text-sm">
      <summary className="text-info">Villain strategy (the model the drill uses)</summary>
      <p className="mt-2 text-xs text-muted">
        The villain is the preflop raiser and acts first each street. His hand is dealt at random from his opening range, and he acts with these probabilities. Every action
        updates the range you're shown (combos are weighted by how likely they were to take that action). This is a simple, stated model — not solver output.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-2">His hand</th>
              {FH_STREETS.map((s) => (
                <th key={s} className="py-1 pr-2 capitalize">
                  Bets {s}
                </th>
              ))}
              <th className="py-1 pr-2">Calls your bet (flop/turn/river)</th>
              <th className="py-1">Calls your raise (f/t/r)</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r} className="border-t border-line">
                <td className="py-1 pr-2">{STRENGTH_LABEL[r]}</td>
                {FH_STREETS.map((s) => (
                  <td key={s} className="py-1 pr-2">
                    {cell(P_BET[s][r])}
                  </td>
                ))}
                <td className="py-1 pr-2">{FH_STREETS.map((s) => cell(P_CALL[s][r])).join(' / ')}</td>
                <td className="py-1">{FH_STREETS.map((s) => cell(P_VS_RAISE[s][r])).join(' / ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted">After you bet or raise and he calls, he checks to you on the next street. He never re-raises.</p>
    </details>
  );
}

function StreetTrack({ h, current }: { h: FullHand; current: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {FH_STREETS.map((s, i) => {
        const recs = h.log.filter((x) => x.street === s);
        const rec = [...recs].reverse().find((x) => x.grade) ?? recs[recs.length - 1];
        const state = i === current ? 'now' : rec ? 'done' : 'todo';
        return (
          <div key={s} className={cx('flex-1 rounded-lg border px-2 py-1.5 text-center capitalize', state === 'now' ? 'border-accent text-accent font-semibold' : 'border-line text-muted')}>
            {s} {rec?.grade ? GRADE_UI[rec.grade].icon : rec?.auto ? '·' : ''}
          </div>
        );
      })}
    </div>
  );
}

export function FullHandTrainer() {
  const [settings] = useSettings();
  const [template, setTemplate] = useState<Template>('random');
  const hand = useRef<FullHand | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [phase, setPhase] = useState<'setup' | 'loading' | 'deciding' | 'done'>('setup');
  const [preflop, setPreflop] = useState<{ vsRange?: number; vsHand?: number }>({});
  const [, force] = useState(0);
  const [error, setError] = useState('');

  const nextDecision = async () => {
    const h = hand.current!;
    setPhase('loading');
    try {
      advance(h, rng);
      force((x) => x + 1);
      if (h.result) {
        setSpot(null);
        setPhase('done');
        return;
      }
      const { spot } = await prepareDecision(h, eqFn);
      setSpot(spot);
      setPhase('deciding');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const start = async () => {
    setError('');
    const h = startHand(rng, settings, template);
    hand.current = h;
    setPreflop({});
    // preflop point for the timeline (worker): vs his opening range (MC) and vs his actual hand (exact)
    computeEquity({ hero: h.hero, villainRange: h.ctx.villainRange }).then((r) => setPreflop((p) => ({ ...p, vsRange: r.equity })));
    computeEquity({ hero: h.hero, villainHand: h.villain }).then((r) => setPreflop((p) => ({ ...p, vsHand: r.equity })));
    window.scrollTo({ top: 0 });
    await nextDecision();
  };

  const onAnswered = async (_g: unknown, key: string) => {
    const h = hand.current!;
    heroAct(h, spot!, key, rng);
    force((x) => x + 1);
    window.scrollTo({ top: 0 });
    if (h.result) {
      setSpot(null);
      setPhase('done');
    } else await nextDecision();
  };

  useEffect(() => {
    // keyboard: Enter/Space starts a new hand from the setup or result screen
    const k = (e: KeyboardEvent) => {
      if ((phase === 'setup' || phase === 'done') && (e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const h = hand.current;
  const points: TimelinePoint[] = [];
  if (h) {
    points.push({ label: 'Preflop', vsRange: preflop.vsRange, vsHand: preflop.vsHand, approx: true });
    FH_STREETS.forEach((s, i) => {
      const rec = [...h.log].reverse().find((x) => x.street === s && !x.auto);
      const board = h.board5.slice(0, 3 + i);
      const reached = i <= h.streetIdx || !!rec;
      points.push({
        label: s[0].toUpperCase() + s.slice(1),
        vsRange: rec?.equity ?? (phase !== 'done' && i === h.streetIdx ? spot?.precomputedEquity?.equity : undefined),
        approx: rec ? rec.equityExact === false : false,
        required: rec?.required ?? (phase !== 'done' && i === h.streetIdx && spot && spot.toCall > 0 ? spot.toCall / (spot.pot + spot.toCall) : undefined),
        vsHand: phase === 'done' && (reached || h.result) ? equityVsHand(h.hero, h.villain, board).equity : undefined,
      });
    });
  }

  if (error)
    return (
      <Panel title="Something went wrong">
        <p className="text-sm text-bad">{error}</p>
        <Button className="mt-2" onClick={start}>
          Deal another hand
        </Button>
      </Panel>
    );

  if (phase === 'setup' || !h)
    return (
      <div className="space-y-3">
        <Panel title="Full hand: flop → turn → river">
          <p className="text-sm">
            Play one hand from the flop to the river. You called a preflop raise; the villain keeps betting or checking according to a fixed strategy, and you decide on every
            street. After each decision you get the full explanation, and the chart tracks how your equity moves as the board and his range change.
          </p>
          <div className="mt-3 text-xs text-muted">Your hand on the flop</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {(Object.keys(TEMPLATE_LABEL) as Template[]).map((t) => (
              <Chip key={t} active={template === t} onClick={() => setTemplate(t)}>
                {TEMPLATE_LABEL[t]}
              </Chip>
            ))}
          </div>
          <Button variant="primary" className="mt-4 w-full min-h-14 text-lg" onClick={start}>
            ▶ Deal a hand
          </Button>
          <p className="mt-2 text-xs text-muted">The cards, the villain's hand and his decisions are random every time; the template only fixes what kind of flop you hit.</p>
        </Panel>
        <Panel>
          <StrategyTable />
        </Panel>
      </div>
    );

  if (phase === 'done' && h.result) {
    const r = h.result;
    const hs = evaluate([...h.hero, ...h.board5]);
    const vs = evaluate([...h.villain, ...h.board5]);
    const decisions = h.log.filter((x) => !x.auto);
    const grades = decisions.map((x) => x.grade!);
    const counts = { best: grades.filter((g) => g === 'best').length, ok: grades.filter((g) => g === 'ok').length, mistake: grades.filter((g) => g === 'mistake').length };
    const outcome =
      r.reason === 'hero-folded' ? 'You folded' : r.reason === 'villain-folded' ? `${h.ctx.villainPos} folded — you win the pot` : r.winner === 'hero' ? 'You win at showdown' : r.winner === 'split' ? 'Split pot' : `${h.ctx.villainPos} wins at showdown`;
    return (
      <div className="space-y-3">
        <Panel
          title={
            <span className="flex items-center gap-2">
              Hand over <KindBadge kind="math" />
            </span>
          }
        >
          <div className="text-lg font-bold">{outcome}</div>
          <div className="mt-1 text-sm">
            Result: <b style={{ color: r.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>{r.net >= 0 ? '+' : ''}{r.net} bb</b> · decisions: ✅ {counts.best} · 🟡 {counts.ok} · ❌ {counts.mistake}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted">You ({h.ctx.heroPos})</div>
              <Cards cards={h.hero} />
              <div className="mt-1 text-xs">{describeHand(hs)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Board{r.reason !== 'showdown' ? ' (the rest of the runout shown)' : ''}</div>
              <Cards cards={h.board5} size="sm" />
            </div>
            <div>
              <div className="text-xs text-muted">{h.ctx.villainPos} had</div>
              <Cards cards={h.villain} />
              <div className="mt-1 text-xs">{describeHand(vs)}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">Results are luck in the short run; the grades judge your decisions with the information you had.</p>
        </Panel>
        <Panel title="Equity, street by street">
          <EquityTimeline points={points} showHand />
          <p className="mt-2 text-xs text-muted">
            Solid line: what you could know — your equity against every hand he could hold given his actions. Dashed: against the hand he actually had. Grey ticks: the price
            of each call.
          </p>
        </Panel>
        <Panel title="Your decisions">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-muted">
                <tr>
                  <th className="py-1 pr-2">Street</th>
                  <th className="py-1 pr-2">Villain</th>
                  <th className="py-1 pr-2">You</th>
                  <th className="py-1 pr-2">Best</th>
                  <th className="py-1 pr-2 text-right">Equity</th>
                  <th className="py-1 pr-2 text-right">Needed</th>
                  <th className="py-1">He had</th>
                </tr>
              </thead>
              <tbody>
                {h.log.map((x, i) => (
                  <tr key={i} className={cx('border-t border-line', x.auto && 'text-muted')}>
                    <td className="py-1.5 pr-2 capitalize">
                      {x.street} <CardText cards={x.board.slice(-1)} />
                    </td>
                    <td className="py-1.5 pr-2">{x.villainAction === 'bet' ? `bet ${x.villainBet}` : x.villainAction === 'none' ? 'waits for you' : x.auto ? 'checks behind' : 'check'}</td>
                    <td className="py-1.5 pr-2">
                      {x.auto ? '— (no decision)' : `${GRADE_UI[x.grade!].icon} ${x.heroLabel}`}
                      {x.response ? <span className="text-xs text-muted"> ({x.response})</span> : null}
                    </td>
                    <td className="py-1.5 pr-2">{x.bestLabel ?? ''}</td>
                    <td className="tabular py-1.5 pr-2 text-right">{x.equity !== undefined ? `${x.equityExact === false ? '≈' : ''}${pct(x.equity)}` : '—'}</td>
                    <td className="tabular py-1.5 pr-2 text-right">{x.required !== undefined ? pct(x.required) : '—'}</td>
                    <td className="py-1.5 text-xs text-muted">{STRENGTH_LABEL[strength(h.villain, x.board)]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Hand history: {h.lines.join(' ')}</p>
        </Panel>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="primary" className="min-h-14 text-base" onClick={start}>
            ▶ Next hand ({TEMPLATE_LABEL[template]})
          </Button>
          <Button className="min-h-14" onClick={() => setPhase('setup')}>
            Change hand type
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StreetTrack h={h} current={h.streetIdx} />
      <Panel className="py-3">
        <EquityTimeline points={points} showHand={false} />
      </Panel>
      {phase === 'loading' || !spot ? (
        <div className="p-10 text-center text-muted">{h.log.length ? 'Dealing the next card…' : 'Dealing…'}</div>
      ) : (
        <SpotPlayer key={spot.id} spot={spot} onNext={onAnswered} nextLabel="Continue →" progressLabel={`Pot ${h.pot}bb · stack ${h.stack}bb`} />
      )}
      <div className="grid grid-cols-3 gap-2 opacity-80">
        <Stat label="You invested" value={`${h.heroIn} bb`} />
        <Stat label="Pot" value={`${h.pot} bb`} />
        <Stat label="Behind" value={`${h.stack} bb`} />
      </div>
    </div>
  );
}
