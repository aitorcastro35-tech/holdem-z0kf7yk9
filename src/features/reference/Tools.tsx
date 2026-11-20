import { useState } from 'react';
import { type Card } from '../../engine/cards';
import { requiredEquityFacingBet, mdf, bluffBreakEven, evCall } from '../../engine/odds';
import { parseRange, rangeComboCount, formatRange } from '../../engine/range';
import { drawOuts } from '../../engine/outs';
import { evaluate, describe as describeHand } from '../../engine/evaluator';
import type { EquityResult } from '../../engine/equity';
import { computeEquity } from '../../workers/equityClient';
import { CardPicker } from '../../components/CardPicker';
import { Panel, Button, Chip, Cards, CardText, KindBadge, Stat, pct } from '../../components/ui';

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-base"
      />
    </label>
  );
}

export function PotOddsCalc() {
  const [pot, setPot] = useState(100);
  const [bet, setBet] = useState(50);
  const [eq, setEq] = useState(30);
  const ok = pot > 0 && bet > 0;
  const req = ok ? requiredEquityFacingBet(pot, bet) : 0;
  const ev = ok ? evCall(eq / 100, pot + 2 * bet, bet) : 0;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Pot-odds calculator <KindBadge kind="math" />
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <NumberInput label="Pot before bet" value={pot} onChange={setPot} />
        <NumberInput label="Villain bets" value={bet} onChange={setBet} />
        <NumberInput label="Your equity %" value={eq} onChange={setEq} />
      </div>
      {ok && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="You need" value={pct(req)} sub={`call ${bet} to win ${pot + bet}`} />
          <Stat label="Pot odds" value={`${((pot + bet) / bet).toFixed(2)} : 1`} />
          <Stat label="MDF" value={pct(mdf(pot, bet))} />
          <Stat label="EV(call)" value={`${ev >= 0 ? '+' : ''}${ev.toFixed(1)}`} tone={ev >= 0 ? 'good' : 'bad'} sub="no further betting" />
        </div>
      )}
      {ok && <p className="mt-2 text-xs text-muted">A pure bluff of this size must work {pct(bluffBreakEven(pot, bet))} of the time.</p>}
    </Panel>
  );
}

const PRESETS = ['random', '22+, A2s+, K9s+, QTs+, JTs, ATo+, KJo+', 'TT+, AKs, AKo, AQs', 'JJ+, AK'];

export function EquityCalc() {
  const [hero, setHero] = useState<Card[]>([]);
  const [board, setBoard] = useState<Card[]>([]);
  const [villainHand, setVillainHand] = useState<Card[]>([]);
  const [mode, setMode] = useState<'range' | 'hand'>('range');
  const [rangeText, setRangeText] = useState('random');
  const [slot, setSlot] = useState<'hero' | 'board' | 'villain'>('hero');
  const [res, setRes] = useState<EquityResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  let rangeInfo = '';
  try {
    const r = parseRange(rangeText);
    rangeInfo = `${rangeComboCount(r, [...hero, ...board]).toFixed(0)} combos after blockers`;
  } catch (e) {
    rangeInfo = (e as Error).message;
  }

  const run = async () => {
    setErr('');
    setRes(null);
    if (hero.length !== 2) return setErr('Pick two hole cards for yourself.');
    if (board.length === 1 || board.length === 2) return setErr('Board must have 0, 3, 4 or 5 cards.');
    if (mode === 'hand' && villainHand.length !== 2) return setErr("Pick two cards for the villain's hand.");
    setBusy(true);
    try {
      const r = await computeEquity({ hero, board, villainHand: mode === 'hand' ? villainHand : undefined, villainRange: mode === 'range' ? rangeText : undefined });
      setRes(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const used = (s: string) => [...(s !== 'hero' ? hero : []), ...(s !== 'board' ? board : []), ...(s !== 'villain' && mode === 'hand' ? villainHand : [])];
  const outs = hero.length === 2 && (board.length === 3 || board.length === 4) ? drawOuts(hero, board) : null;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Equity calculator <KindBadge kind="math" />
        </span>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Chip active={slot === 'hero'} onClick={() => setSlot('hero')}>
          Your hand ({hero.length}/2)
        </Chip>
        <Chip active={slot === 'board'} onClick={() => setSlot('board')}>
          Board ({board.length}/5)
        </Chip>
        {mode === 'hand' && (
          <Chip active={slot === 'villain'} onClick={() => setSlot('villain')}>
            Villain ({villainHand.length}/2)
          </Chip>
        )}
        <Button variant="ghost" className="min-h-9 px-2" onClick={() => { setHero([]); setBoard([]); setVillainHand([]); setRes(null); }}>
          Clear
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs text-muted">You</div>
          <Cards cards={hero} placeholders={2} />
        </div>
        <div>
          <div className="text-xs text-muted">Board</div>
          <Cards cards={board} placeholders={5} size="sm" />
        </div>
        {mode === 'hand' && (
          <div>
            <div className="text-xs text-muted">Villain</div>
            <Cards cards={villainHand} placeholders={2} />
          </div>
        )}
      </div>
      <div className="mt-3">
        {slot === 'hero' && <CardPicker value={hero} max={2} used={used('hero')} onChange={setHero} />}
        {slot === 'board' && <CardPicker value={board} max={5} used={used('board')} onChange={setBoard} />}
        {slot === 'villain' && <CardPicker value={villainHand} max={2} used={used('villain')} onChange={setVillainHand} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={mode === 'range'} onClick={() => { setMode('range'); if (slot === 'villain') setSlot('hero'); }}>
          vs range
        </Chip>
        <Chip active={mode === 'hand'} onClick={() => setMode('hand')}>
          vs hand
        </Chip>
      </div>
      {mode === 'range' && (
        <div className="mt-2">
          <input
            value={rangeText}
            onChange={(e) => setRangeText(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm"
            placeholder="e.g. 22+, A2s+, KTo+, 76s"
            spellCheck={false}
          />
          <div className="mt-1 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p} className="text-xs text-info hover:underline" onClick={() => setRangeText(p)}>
                {p === 'random' ? 'Any two cards' : p}
              </button>
            ))}
          </div>
          <div className="mt-1 text-xs text-muted">{rangeInfo}</div>
        </div>
      )}
      <Button variant="primary" className="mt-3 w-full" onClick={run} disabled={busy}>
        {busy ? 'Calculating…' : 'Calculate equity'}
      </Button>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
      {res && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Your equity" value={`${res.exact ? '' : '≈ '}${pct(res.equity, 2)}`} tone="good" />
          <Stat label="Win" value={pct(res.win, 2)} />
          <Stat label="Tie" value={pct(res.tie, 2)} />
          <Stat label="Method" value={res.exact ? 'Exact' : 'Monte Carlo'} sub={`${res.samples.toLocaleString('en-US')} ${res.exact ? 'outcomes' : 'trials (±~0.4%)'}`} />
        </div>
      )}
      {res && mode === 'range' && <p className="mt-2 text-xs text-muted">Villain range: {parseRange(rangeText).size === 169 ? 'any two cards' : formatRange(parseRange(rangeText)) || rangeText}</p>}
      {hero.length === 2 && board.length >= 3 && (
        <p className="mt-2 text-sm">
          You have: <b>{describeHand(evaluate([...hero, ...board]))}</b>
        </p>
      )}
      {outs && outs.outs.length > 0 && (
        <div className="mt-2 text-sm">
          Draw outs to a straight or better: <b>{outs.outs.length}</b> — clean <CardText cards={outs.clean} />
          {outs.dirty.length > 0 && (
            <>
              {' '}
              · dirty <CardText cards={outs.dirty} />
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export function Tools() {
  return (
    <div className="space-y-3">
      <PotOddsCalc />
      <EquityCalc />
    </div>
  );
}
