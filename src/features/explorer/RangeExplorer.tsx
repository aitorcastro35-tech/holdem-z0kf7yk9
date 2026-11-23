import { useEffect, useMemo, useState } from 'react';
import type { Card } from '../../engine/cards';
import { parseRange, expandRange, formatRange, rangeComboCount, classComboCount, type Range } from '../../engine/range';
import { CHARTS, POSITIONS, SOURCES } from '../../data/charts';
import { PUSH_FOLD_REFS } from '../../data/pushfold';
import { runExplorer } from '../../workers/explorerClient';
import { summarize, CLOSE_BB, type CellResult, type ExAction, type ExplorerInput, type SpotType, type ResponseModel } from '../../explorer/core';
import { RangeGrid, Legend, type CellPaint } from '../../components/RangeGrid';
import { CardPicker } from '../../components/CardPicker';
import { Panel, Button, Chip, CardText, KindBadge, SourceLink, Stat, pct, cx } from '../../components/ui';
import { useSettings } from '../../store/settings';
import { usePresets } from '../../store/presets';

const SPOTS: [SpotType, string][] = [
  ['allin-call', 'Facing an all-in'],
  ['vs-raise', 'Facing a raise'],
  ['postflop', 'Postflop, facing a bet'],
  ['push-fold', 'Push or fold'],
];
const ACTION_COLOR: Record<ExAction, string> = { fold: 'var(--act-fold)', call: 'var(--act-call)', raise: 'var(--act-3bet)', shove: 'var(--act-raise)' };
const ACTION_NAME: Record<ExAction, string> = { fold: 'Fold', call: 'Call', raise: 'Raise / 3-bet', shove: 'Shove' };

export interface ExState {
  spot: SpotType;
  tableSize: 6 | 9;
  heroPos: string;
  villainPos: string;
  stack: number; // effective, total incl. blinds
  ante: number;
  villainMode: 'range' | 'hand';
  rangeText: string;
  villainHand: Card[];
  shove: number; // allin-call: villain's total
  openTo: number; // vs-raise
  raiseTo: number; // vs-raise 3-bet size / postflop raise-to
  board: Card[];
  pot: number; // postflop pot before the bet
  bet: number;
  callText: string; // push-fold: villain calling range
  response: ResponseModel;
  realization: number;
  raiseRealization: number;
}

export const DEFAULT_EX: ExState = {
  spot: 'allin-call',
  tableSize: 9,
  heroPos: 'BB',
  villainPos: 'UTG',
  stack: 10,
  ante: 0,
  villainMode: 'range',
  rangeText: '22+, A4s+, ATo+, K9s+, KJo+, Q9s+, J9s+, T8s+, 98s',
  villainHand: [],
  shove: 10,
  openTo: 2.5,
  raiseTo: 8,
  board: [],
  pot: 6,
  bet: 3,
  callText: '33+, A2s+, A7o+, KTs+, KJo+, QTs+, JTs',
  response: { mode: 'top-n', foldPct: 0.45, continuePct: 0.55, reraisePct: 0.2 },
  realization: 0.8,
  raiseRealization: 1,
};

const posted = (pos: string) => (pos === 'SB' ? 0.5 : pos === 'BB' ? 1 : 0);

/** Dead money from folded players: blinds not posted by either of you + every seat's ante. */
function deadOthers(s: ExState) {
  let d = s.ante * s.tableSize;
  if (s.heroPos !== 'SB' && s.villainPos !== 'SB') d += 0.5;
  if (s.heroPos !== 'BB' && s.villainPos !== 'BB') d += 1;
  return Math.round(d * 100) / 100;
}

function safeRange(text: string): Range | null {
  try {
    return parseRange(text);
  } catch {
    return null;
  }
}

export function buildInput(s: ExState): ExplorerInput | string {
  const villainCombos =
    s.villainMode === 'hand'
      ? s.villainHand.length === 2
        ? [{ cards: [s.villainHand[0], s.villainHand[1]] as [Card, Card], w: 1 }]
        : null
      : (() => {
          const r = safeRange(s.rangeText);
          return r && r.size ? expandRange(r).map((c) => ({ cards: c.cards, w: c.weight })) : null;
        })();
  const hp = posted(s.heroPos);
  const vp = posted(s.villainPos);
  const dead = deadOthers(s);
  const base = { board: [] as Card[], response: s.response, realization: s.realization, raiseRealization: s.raiseRealization, heroPosted: hp };
  switch (s.spot) {
    case 'allin-call': {
      if (!villainCombos) return 'Enter the villain’s range or hand.';
      const X = Math.max(s.shove, vp);
      return { ...base, spot: 'allin-call', villainCombos, potBefore: X + hp + dead, toCall: X - hp, heroBehind: s.stack - hp - s.ante, villainBehind: 0 };
    }
    case 'vs-raise': {
      if (!villainCombos) return 'Enter the villain’s range or hand.';
      return {
        ...base,
        spot: 'vs-raise',
        villainCombos,
        potBefore: s.openTo + hp + dead,
        toCall: s.openTo - hp,
        heroBehind: s.stack - hp - s.ante,
        villainBehind: s.stack - s.openTo - s.ante,
        raiseTo: s.raiseTo,
        heroCommitted: hp,
        villainCommitted: s.openTo,
      };
    }
    case 'postflop': {
      if (!villainCombos) return 'Enter the villain’s range or hand.';
      if (s.board.length < 3) return 'Pick at least the flop (3 board cards).';
      return { ...base, spot: 'postflop', villainCombos, board: s.board, potBefore: s.pot + s.bet, toCall: s.bet, heroBehind: s.stack, villainBehind: Math.max(0, s.stack - s.bet), raiseTo: s.raiseTo, heroCommitted: 0, villainCommitted: s.bet };
    }
    case 'push-fold': {
      const call = safeRange(s.callText);
      if (!call) return 'Enter the villain’s calling range.';
      const any = expandRange(parseRange('random')).map((c) => ({ cards: c.cards, w: 1 }));
      return {
        ...base,
        spot: 'push-fold',
        villainCombos: any,
        callCombos: expandRange(call).map((c) => ({ cards: c.cards, w: c.weight })),
        potBefore: hp + vp + dead,
        toCall: 0,
        heroBehind: s.stack - hp - s.ante,
        villainBehind: s.stack - vp - s.ante,
        villainPosted: vp,
      };
    }
  }
}

function presetsFor(tableSize: 6 | 9): { label: string; range: string }[] {
  const out: { label: string; range: string }[] = [];
  for (const c of CHARTS) {
    if (c.tableSize !== tableSize && c.kind === 'rfi') continue;
    for (const p of c.parts) out.push({ label: `${c.title}${c.parts.length > 1 ? ` — ${p.action === 'threebet' ? '3-bet' : p.action}` : ''} (${SOURCES[c.source].name.split(' —')[0]})`, range: p.range });
  }
  for (const p of PUSH_FOLD_REFS) out.push({ label: `${p.label} (Poker Skill push/fold)`, range: p.range });
  out.push({ label: 'Any two cards', range: 'random' });
  return out;
}

function NumberField({ label, value, onChange, step = 0.5, min = 0 }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input type="number" step={step} min={min} value={value} onChange={(e) => onChange(Math.max(min, parseFloat(e.target.value) || 0))} className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2" />
    </label>
  );
}

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05, fmt = (v: number) => pct(v, 0) }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; fmt?: (v: number) => string }) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular text-fg">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full" />
    </label>
  );
}

function RangeInput({ text, onChange, tableSize, label }: { text: string; onChange: (t: string) => void; tableSize: 6 | 9; label: string }) {
  const r = safeRange(text);
  const set = new Set(r ? [...r.keys()] : []);
  const presets = presetsFor(tableSize);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">{label}</div>
      <input value={text} onChange={(e) => onChange(e.target.value)} spellCheck={false} className={cx('w-full rounded-lg border bg-surface-2 px-3 py-2 font-mono text-sm', r ? 'border-line' : 'border-bad')} placeholder="e.g. 22+, A2s+, KTo+" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select className="max-w-full rounded-lg border border-line bg-surface-2 px-2 py-1" value="" onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Load a preset range">
          <option value="">Load a preset…</option>
          {presets.map((p) => (
            <option key={p.label} value={p.range}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="text-muted">{r ? `${rangeComboCount(r)} combos (${pct(rangeComboCount(r) / 1326)})` : 'cannot parse'}</span>
      </div>
      <details>
        <summary className="text-xs text-info">Edit by clicking cells</summary>
        <div className="mt-2">
          <RangeGrid
            compact
            paint={(cls): CellPaint => ({ segments: [{ color: set.has(cls) ? 'var(--act-call)' : 'var(--act-fold)', weight: 1 }] })}
            onSelect={(cls) => {
              const next = new Map(r ?? []);
              if (next.has(cls)) next.delete(cls);
              else next.set(cls, 1);
              onChange(formatRange(next));
            }}
          />
        </div>
      </details>
    </div>
  );
}

export default function RangeExplorer() {
  const [settings] = useSettings();
  const [presets, setPresets] = usePresets();
  const [s, setS] = useState<ExState>(() => ({ ...DEFAULT_EX, tableSize: settings.tableSize }));
  const [cells, setCells] = useState<CellResult[] | null>(null);
  const [exact, setExact] = useState(true);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'best' | 'equity'>('best');
  const [sel, setSel] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const set = (patch: Partial<ExState>) => setS((x) => ({ ...x, ...patch }));

  const input = useMemo(() => buildInput(s), [s]);
  useEffect(() => {
    if (typeof input === 'string') {
      setErr(input);
      return;
    }
    setErr('');
    setBusy(true);
    setProgress(0);
    const t = setTimeout(() => {
      runExplorer(input, setProgress)
        .then((r) => {
          setCells(r.cells);
          setExact(r.exact);
          setBusy(false);
        })
        .catch((e) => {
          if ((e as Error).message !== 'cancelled') {
            setErr((e as Error).message);
            setBusy(false);
          }
        });
    }, 250);
    return () => clearTimeout(t);
  }, [input]);

  const byCls = useMemo(() => new Map((cells ?? []).map((c) => [c.cls, c])), [cells]);
  const summary = cells ? summarize(cells) : null;
  const selCell = sel ? byCls.get(sel) : undefined;
  const actions: ExAction[] = s.spot === 'push-fold' ? ['shove', 'fold'] : s.spot === 'allin-call' ? ['call', 'fold'] : ['raise', 'call', 'fold'];
  const modelBased = s.spot === 'vs-raise' || (s.spot === 'postflop' && s.board.length < 5);
  const positions = POSITIONS[s.tableSize];

  const paint = (cls: string): CellPaint => {
    const c = byCls.get(cls);
    if (!c || !c.combos) return { segments: [{ color: 'var(--act-fold)', weight: 1 }], title: `${cls}: blocked` };
    if (view === 'equity') {
      const p = Math.round(c.equity * 100);
      return { segments: [{ color: `color-mix(in srgb, var(--series-2) ${p}%, var(--act-fold))`, weight: 1 }], title: `${cls}: ${p}% equity` };
    }
    // intensity by how much better the best action is (marginal hands look marginal)
    const strength = c.best === 'fold' ? 100 : Math.round(35 + Math.min(1, c.margin / 1.5) * 65);
    return { segments: [{ color: c.best === 'fold' ? 'var(--act-fold)' : `color-mix(in srgb, ${ACTION_COLOR[c.best]} ${strength}%, var(--act-fold))`, weight: 1 }], title: `${cls}: ${ACTION_NAME[c.best]} (+${c.margin.toFixed(2)}bb vs next)` };
  };

  const savePreset = () => {
    const name = presetName.trim() || `Explorer ${Object.keys(presets.explorer).length + 1}`;
    setPresets((p) => ({ ...p, explorer: { ...p.explorer, [name]: s } }));
    setPresetName('');
  };

  const switchSpot = (k: SpotType) =>
    set({
      spot: k,
      ...(k === 'push-fold'
        ? { heroPos: 'SB', villainPos: 'BB', stack: 10 }
        : k === 'allin-call'
          ? { heroPos: 'BB', villainPos: 'UTG', stack: 10, rangeText: DEFAULT_EX.rangeText }
          : k === 'vs-raise'
            ? { heroPos: 'BTN', villainPos: 'CO', tableSize: 6 as const, stack: 100, rangeText: CHARTS.find((c) => c.id === '6-rfi-CO')!.parts[0].range, response: { mode: 'top-n' as const, foldPct: 0.45, continuePct: 0.55, reraisePct: 0.2 }, realization: 0.8 }
            : {
                stack: 97.5,
                rangeText: CHARTS.find((c) => c.id === '6-rfi-BTN')!.parts[0].range,
                // facing a raise on a later street, betting ranges continue more often than vs a preflop 3-bet
                response: { mode: 'top-n' as const, foldPct: 0.35, continuePct: 0.65, reraisePct: 0.2 },
                realization: 0.9,
              }),
    });

  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Range Explorer <KindBadge kind={modelBased ? 'theory' : 'math'} />
          </span>
        }
      >
        <div className="flex flex-wrap gap-2">
          {SPOTS.map(([k, label]) => (
            <Chip key={k} active={s.spot === k} onClick={() => switchSpot(k)}>
              {label}
            </Chip>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-muted">
          ⓘ This shows which option is <b>profitable under these assumptions</b> for each hand — not solver mixed-strategy frequencies. A solver balances a whole strategy against an
          opponent who adapts; this tool answers "given this villain range, which option makes the most chips with this hand?".{' '}
          {modelBased ? 'This spot is model-based: the response and realization inputs below are assumptions.' : 'This spot is exact chip EV (no ICM).'}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Panel title="Inputs">
          <div className="space-y-3">
            {s.spot !== 'postflop' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">Table</span>
                  {([6, 9] as const).map((n) => (
                    <Chip
                      key={n}
                      active={s.tableSize === n}
                      onClick={() => set({ tableSize: n, heroPos: (POSITIONS[n] as string[]).includes(s.heroPos) ? s.heroPos : 'BB', villainPos: (POSITIONS[n] as string[]).includes(s.villainPos) ? s.villainPos : 'BTN' })}
                    >
                      {n}-max
                    </Chip>
                  ))}
                </div>
                {(['heroPos', 'villainPos'] as const).map((k) => (
                  <div key={k} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-16 text-xs text-muted">{k === 'heroPos' ? 'You' : 'Villain'}</span>
                    {positions.map((p) => (
                      <Chip key={p} active={s[k] === p} onClick={() => p !== s[k === 'heroPos' ? 'villainPos' : 'heroPos'] && set({ [k]: p })} className="px-2 text-xs">
                        {p}
                      </Chip>
                    ))}
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Effective stack (bb)" value={s.stack} onChange={(n) => set({ stack: Math.max(1, n) })} />
                  <NumberField label="Ante per player (bb)" value={s.ante} onChange={(n) => set({ ante: n })} step={0.05} />
                </div>
              </>
            )}
            {s.spot === 'allin-call' && <NumberField label="Villain shoves to (bb, total)" value={s.shove} onChange={(n) => set({ shove: n })} />}
            {s.spot === 'vs-raise' && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Villain opens to (bb)" value={s.openTo} onChange={(n) => set({ openTo: n })} />
                <NumberField label="Your 3-bet to (bb)" value={s.raiseTo} onChange={(n) => set({ raiseTo: n })} />
              </div>
            )}
            {s.spot === 'postflop' && (
              <>
                <div className="text-xs text-muted">Board ({s.board.length}/5)</div>
                <CardPicker value={s.board} max={5} used={s.villainMode === 'hand' ? s.villainHand : []} onChange={(b) => set({ board: b })} />
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Pot before the bet" value={s.pot} onChange={(n) => set({ pot: n })} />
                  <NumberField label="Villain bets" value={s.bet} onChange={(n) => set({ bet: n })} />
                  <NumberField label="Effective stack behind" value={s.stack} onChange={(n) => set({ stack: Math.max(0.5, n) })} />
                  <NumberField label="Your raise to" value={s.raiseTo} onChange={(n) => set({ raiseTo: n })} />
                </div>
              </>
            )}
            {s.spot === 'push-fold' ? (
              <RangeInput text={s.callText} onChange={(t) => set({ callText: t })} tableSize={s.tableSize} label="Villain calls your shove with" />
            ) : (
              <>
                <div className="flex gap-2">
                  <Chip active={s.villainMode === 'range'} onClick={() => set({ villainMode: 'range' })}>
                    Villain range
                  </Chip>
                  <Chip active={s.villainMode === 'hand'} onClick={() => set({ villainMode: 'hand' })}>
                    Exact hand
                  </Chip>
                </div>
                {s.villainMode === 'range' ? (
                  <RangeInput text={s.rangeText} onChange={(t) => set({ rangeText: t })} tableSize={s.tableSize} label={s.spot === 'allin-call' ? 'Villain shoves with' : s.spot === 'vs-raise' ? 'Villain opens with' : 'Villain bets with'} />
                ) : (
                  <div>
                    <div className="mb-1 text-xs text-muted">Villain's hand {s.villainHand.length ? <CardText cards={s.villainHand} /> : ''}</div>
                    <CardPicker value={s.villainHand} max={2} used={s.board} onChange={(h) => set({ villainHand: h })} />
                  </div>
                )}
              </>
            )}
            {(s.spot === 'vs-raise' || s.spot === 'postflop') && (
              <details open className="rounded-lg border border-line p-2">
                <summary className="text-xs font-semibold">Assumptions (model)</summary>
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Chip active={s.response.mode === 'top-n'} onClick={() => set({ response: { ...s.response, mode: 'top-n' } })} className="text-xs">
                      Continues with top N%
                    </Chip>
                    <Chip active={s.response.mode === 'fold-pct'} onClick={() => set({ response: { ...s.response, mode: 'fold-pct' } })} className="text-xs">
                      Simple fold %
                    </Chip>
                  </div>
                  {s.response.mode === 'top-n' ? (
                    <Slider label="Villain continues vs your raise with his top" value={s.response.continuePct} onChange={(v) => set({ response: { ...s.response, continuePct: v } })} />
                  ) : (
                    <Slider label="Villain folds to your raise" value={s.response.foldPct} onChange={(v) => set({ response: { ...s.response, foldPct: v } })} />
                  )}
                  <Slider label="…of which he re-raises (you then fold)" value={s.response.reraisePct} onChange={(v) => set({ response: { ...s.response, reraisePct: v } })} />
                  <Slider label="Equity realization when you call" value={s.realization} onChange={(v) => set({ realization: v })} min={0.5} max={1.2} fmt={(v) => v.toFixed(2)} />
                  <Slider label="Equity realization after your raise is called" value={s.raiseRealization} onChange={(v) => set({ raiseRealization: v })} min={0.5} max={1.2} fmt={(v) => v.toFixed(2)} />
                  <p className="text-[11px] text-muted">
                    Defaults are rough assumptions, not sourced numbers: preflop, villain continues vs a 3-bet with his top 55% (20% of that 4-bets) and you realize 0.8 of your equity when calling; postflop, his betting range continues vs a raise 65% of the time (20% of that re-raises) and you realize 0.9; 1.0 after your raise is called (initiative).
                    "Top N%" ranks his hands by the preflop strength order (or by made-hand strength on the board). River calls ignore realization (no cards to come).
                  </p>
                </div>
              </details>
            )}
            {err && <p className="text-sm text-bad">{err}</p>}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel
            title={s.spot === 'push-fold' ? 'Shove or fold, per hand' : 'Best action, per hand'}
            right={
              <div className="flex gap-1">
                <Chip active={view === 'best'} onClick={() => setView('best')} className="text-xs">
                  Best action
                </Chip>
                <Chip active={view === 'equity'} onClick={() => setView('equity')} className="text-xs">
                  Equity
                </Chip>
              </div>
            }
          >
            {busy && (
              <div className="mb-2 h-1.5 overflow-hidden rounded bg-surface-2" aria-label="progress">
                <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            <div className={cx(busy && 'opacity-60')}>
              <RangeGrid paint={paint} onSelect={setSel} selected={sel ?? undefined} />
            </div>
            <div className="mt-2">
              {view === 'best' ? (
                <Legend items={[...actions.map((a) => ({ color: ACTION_COLOR[a], label: ACTION_NAME[a] })), { color: `color-mix(in srgb, var(--act-call) 40%, var(--act-fold))`, label: 'paler = marginal' }]} />
              ) : (
                <Legend items={[{ color: 'var(--series-2)', label: 'higher equity' }, { color: 'var(--act-fold)', label: 'lower equity' }]} />
              )}
            </div>
            <p className="mt-1 text-xs text-muted">{exact ? 'Equities exact (exact preflop table / full enumeration).' : 'Flop equities are Monte Carlo estimates (≈ ±1%).'} Tap a hand for details.</p>
          </Panel>

          {summary && (
            <Panel title="Summary" right={<SourceLink ids={['engine']} extra="Exact preflop equities come from a table enumerating all 1,712,304 boards for each of the 47,008 distinct heads-up matchups." />}>
              <div className="flex flex-wrap gap-2 text-sm">
                {actions.map((a) => (
                  <span key={a} className="rounded-lg bg-surface-2 px-3 py-1.5">
                    <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ACTION_COLOR[a] }} />
                    {ACTION_NAME[a]} <b className="tabular">{pct(summary.pct[a] ?? 0)}</b>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Share of all available combos ({summary.totalCombos} of 1,326 after blockers) whose most profitable option is each action.</p>
              {summary.close.length > 0 && (
                <p className="mt-2 text-xs">
                  <b>Close</b> (within ±{CLOSE_BB}bb of the next option): {summary.close.join(', ')}
                </p>
              )}
            </Panel>
          )}

          <Panel title="Saved explorer setups">
            <div className="flex gap-2">
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this setup" className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm" />
              <Button onClick={savePreset}>Save</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(presets.explorer).map(([name, p]) => (
                <span key={name} className="flex items-center gap-1 rounded-full border border-line px-1">
                  <button className="px-2 py-1 text-sm hover:text-accent" onClick={() => setS({ ...DEFAULT_EX, ...(p as ExState) })}>
                    {name}
                  </button>
                  <button
                    className="px-1 text-xs text-muted hover:text-bad"
                    aria-label={`Delete ${name}`}
                    onClick={() =>
                      setPresets((x) => {
                        const explorer = { ...x.explorer };
                        delete explorer[name];
                        return { ...x, explorer };
                      })
                    }
                  >
                    ✕
                  </button>
                </span>
              ))}
              {!Object.keys(presets.explorer).length && <span className="text-xs text-muted">None yet. Included in Settings → Export.</span>}
            </div>
          </Panel>
        </div>
      </div>

      {selCell && (
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96 sm:rounded-2xl sm:border">
          <div className="flex items-center justify-between">
            <div className="text-lg font-bold">{selCell.cls}</div>
            <button className="px-2 text-muted hover:text-fg" onClick={() => setSel(null)} aria-label="Close">
              ✕
            </button>
          </div>
          {selCell.combos === 0 ? (
            <p className="text-sm text-muted">All combos are blocked by the board or the villain's hand.</p>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Stat label={s.spot === 'push-fold' ? 'Equity when called' : 'Equity vs range'} value={`${exact ? '' : '≈'}${pct(selCell.equity)}`} />
                <Stat label="Your combos" value={`${selCell.combos} / ${classComboCount(selCell.cls)}`} sub="after card removal" />
                {actions.map((a) => (
                  <Stat key={a} label={`EV ${ACTION_NAME[a]}`} value={`${(selCell.ev[a] ?? 0) >= 0 ? '+' : ''}${(selCell.ev[a] ?? 0).toFixed(2)} bb`} tone={a === selCell.best ? 'good' : undefined} />
                ))}
                {selCell.foldPct !== undefined && <Stat label="Villain folds" value={pct(selCell.foldPct)} sub="given your cards" />}
                {selCell.breakEvenFold !== undefined && <Stat label="Break-even fold %" value={pct(selCell.breakEvenFold)} sub="for a pure bluff" />}
                {selCell.eqVsContinue !== undefined && <Stat label="Equity when he continues" value={pct(selCell.eqVsContinue)} />}
              </div>
              <p className="mt-2 text-xs text-muted">
                Best: <b>{ACTION_NAME[selCell.best]}</b> by {selCell.margin.toFixed(2)}bb. EVs are measured from this decision (folding = 0) and averaged over your available combos of this
                hand.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
