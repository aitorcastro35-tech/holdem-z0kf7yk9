import { useEffect, useMemo, useRef, useState } from 'react';
import { type Card, cardsToString, mulberry32 } from '../../engine/cards';
import { equityVsHand } from '../../engine/equity';
import { describe as describeHand } from '../../engine/evaluator';
import { newHand, act, legalActions, totalPot, STREET_NAMES, type HUConfig, type HUState, type ActionType } from '../../engine/headsup';
import { botView, botDecide, STYLES, type BotStyle, type BotLog, type EqFn } from '../../bot/bot';
import { reviewDecision, type HeroReview } from '../../bot/review';
import { RANGE_RULES } from '../../bot/ranges';
import { computeEquity } from '../../workers/equityClient';
import { useSettings, fmtAmount } from '../../store/settings';
import { recordAnswer } from '../../store/progress';
import { usePresets } from '../../store/presets';
import { CardPicker } from '../../components/CardPicker';
import { RangeGrid, Legend } from '../../components/RangeGrid';
import { GRADE_UI } from '../train/Explanation';
import { conceptById } from '../../data/concepts';
import { Panel, Button, Chip, Cards, CardText, KindBadge, Stat, pct, cx } from '../../components/ui';
import { go } from '../../router';

const ORDER: Record<number, string[]> = {
  2: ['BTN', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};
const HERO = 0 as const;
const BOT = 1 as const;

const eqFn: EqFn = (myCards, combos, board, seed) => computeEquity({ hero: myCards, board, villainCombos: combos, opts: { mode: 'mc', iterations: 6000, seed } });
const reviewEq: EqFn = (myCards, combos, board, seed) => computeEquity({ hero: myCards, board, villainCombos: combos, opts: { iterations: 40_000, seed } });

interface Setup {
  tableSize: 2 | 6 | 9;
  heroPos: string;
  botPos: string;
  stack: number;
  heroCards: Card[];
  botCards: Card[];
  board: Card[]; // preset in order flop(3), turn, river
  style: BotStyle['id'];
  seed: number;
}

interface HeroDecision {
  histIndex: number;
  snapIndex: number; // index into snapshots of the state BEFORE the decision
  type: ActionType;
  to?: number;
}

const VERDICT_UI: Record<string, { icon: string; label: string; color: string }> = {
  ...GRADE_UI,
  close: { icon: '⚖️', label: 'Close / depends on reads', color: 'var(--info)' },
};

function randomSetup(size: 2 | 6 | 9, stack: number): Setup {
  const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  const order = ORDER[size];
  const i = Math.floor(rng() * order.length);
  let j = Math.floor(rng() * (order.length - 1));
  if (j >= i) j++;
  return { tableSize: size, heroPos: order[i], botPos: order[j], stack, heroCards: [], botCards: [], board: [], style: 'solid', seed: (rng() * 1e9) | 0 };
}

function toConfig(s: Setup): HUConfig {
  return {
    seed: s.seed,
    tableSize: s.tableSize,
    positions: [s.heroPos, s.botPos],
    stacks: [s.stack, s.stack],
    holes: [s.heroCards.length === 2 ? s.heroCards : undefined, s.botCards.length === 2 ? s.botCards : undefined],
    board: [0, 1, 2, 3, 4].map((i) => s.board[i]),
  };
}

/** Bet/raise sizes offered to the hero, clamped to the legal range. */
function sizeButtons(st: HUState): { label: string; type: 'bet' | 'raise'; to: number }[] {
  const L = legalActions(st);
  const out: { label: string; type: 'bet' | 'raise'; to: number }[] = [];
  const add = (label: string, type: 'bet' | 'raise', to: number) => {
    const r = type === 'bet' ? L.bet! : L.raise!;
    const t = Math.round(Math.max(r.min, Math.min(r.max, to)) * 10) / 10;
    if (!out.some((o) => o.to === t)) out.push({ label: t >= r.max ? `All-in ${t}` : label, type, to: t });
  };
  const pot = totalPot(st);
  if (L.bet) {
    for (const f of [0.33, 0.5, 0.75, 1]) add(`${Math.round(f * 100)}% (${Math.round(pot * f * 10) / 10})`, 'bet', pot * f);
    add('All-in', 'bet', L.bet.max);
  } else if (L.raise) {
    if (st.street === 0 && st.currentBet <= 1) for (const x of [2.5, 3, 4]) add(`Raise to ${x}`, 'raise', x);
    else {
      add(`Min (${L.raise.min})`, 'raise', L.raise.min);
      for (const x of [2.5, 3]) add(`${x}× (${Math.round(st.currentBet * x * 10) / 10})`, 'raise', st.currentBet * x);
      const toCall = st.currentBet - st.committed[st.toAct!];
      add(`Pot (${Math.round((st.currentBet + pot + toCall) * 10) / 10})`, 'raise', st.currentBet + pot + toCall);
    }
    add('All-in', 'raise', L.raise.max);
  }
  return out;
}

function handHistory(snapshots: HUState[], setup: Setup, botLogs: { histIndex: number; log: BotLog }[]): string {
  const st = snapshots[snapshots.length - 1];
  const names = ['Hero', 'Bot'];
  const lines = [
    `Hold'em Trainer — heads-up hand (seed ${setup.seed}, ${setup.tableSize === 2 ? 'heads-up game' : `${setup.tableSize}-max table, others folded`})`,
    `Bot style: ${STYLES[setup.style].name} (rule-based, not a solver)`,
    `Hero (${setup.heroPos}) ${st.cfg.stacks[0]}bb: ${cardsToString(st.holes[0])}`,
    `Bot (${setup.botPos}) ${st.cfg.stacks[1]}bb: ${cardsToString(st.holes[1])}`,
  ];
  let street = -1;
  st.history.forEach((a) => {
    if (a.street !== street) {
      street = a.street;
      const b = street === 0 ? '' : ` [${cardsToString(st.boardAll.slice(0, street === 1 ? 3 : street === 2 ? 4 : 5))}]`;
      lines.push(`*** ${STREET_NAMES[street].toUpperCase()}${b} ***`);
    }
    const what = a.type === 'bet' || a.type === 'raise' ? `${a.type}s to ${a.amount}` : a.type === 'call' ? `calls ${a.amount}` : `${a.type}s`;
    lines.push(`${names[a.seat]}: ${what}${a.allIn ? ' (all-in)' : ''}`);
  });
  if (st.result) {
    if (st.result.reason === 'showdown') lines.push(`*** SHOWDOWN [${cardsToString(st.boardAll)}] ***`);
    lines.push(`Result: Hero ${st.result.net[0] >= 0 ? '+' : ''}${st.result.net[0]}bb, Bot ${st.result.net[1] >= 0 ? '+' : ''}${st.result.net[1]}bb${st.result.returned ? ` (uncalled ${st.result.returned}bb returned)` : ''}`);
  }
  void botLogs;
  return lines.join('\n');
}

function SeatBox({ name, pos, stack, committed, cards, faceDown, active, s }: { name: string; pos: string; stack: number; committed: number; cards: Card[]; faceDown: boolean; active: boolean; s: ReturnType<typeof useSettings>[0] }) {
  return (
    <div className={cx('flex items-center justify-between gap-2 rounded-xl px-3 py-2', active ? 'bg-black/35 ring-2 ring-white/70' : 'bg-black/20')}>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">{faceDown ? [0, 1].map((i) => <div key={i} className="h-11 w-8 rounded-md border border-white/30" style={{ background: 'repeating-linear-gradient(45deg,#2d5b8a,#2d5b8a 4px,#24496f 4px,#24496f 8px)' }} />) : <Cards cards={cards} size="sm" />}</div>
        <div className="text-xs text-white/90">
          <div className="font-semibold">{name}</div>
          <div>{pos}</div>
        </div>
      </div>
      <div className="text-right text-xs text-white/90">
        <div className="tabular font-semibold">{fmtAmount(stack, s)}</div>
        {committed > 0 && <div className="tabular text-amber-200">bet {fmtAmount(committed, s)}</div>}
      </div>
    </div>
  );
}

function TableView({ st, reveal, active }: { st: HUState; reveal: boolean; active: boolean }) {
  const [s] = useSettings();
  return (
    <div className="space-y-2 rounded-3xl border-4 p-3" style={{ background: 'radial-gradient(ellipse at center, var(--felt) 0%, var(--felt-edge) 100%)', borderColor: 'var(--felt-edge)' }}>
      <SeatBox name="Bot" pos={st.cfg.positions[BOT]} stack={st.stack[BOT]} committed={st.committed[BOT]} cards={st.holes[BOT]} faceDown={!reveal} active={active && st.toAct === BOT} s={s} />
      <div className="flex flex-col items-center gap-1 py-2">
        <div className="text-xs uppercase tracking-wide text-white/70">{STREET_NAMES[st.street]} · pot</div>
        <div className="tabular text-xl font-bold text-white">{fmtAmount(totalPot(st), s)}</div>
        <div className="min-h-12">{st.board.length ? <Cards cards={st.board} size="md" /> : <div className="pt-3 text-sm text-white/60">No board yet</div>}</div>
      </div>
      <SeatBox name="You" pos={st.cfg.positions[HERO]} stack={st.stack[HERO]} committed={st.committed[HERO]} cards={st.holes[HERO]} faceDown={false} active={active && st.toAct === HERO} s={s} />
    </div>
  );
}

function actionText(st: HUState, upTo: number): string[] {
  const names = ['You', 'Bot'];
  return st.history.slice(0, upTo).map((a) => {
    const what = a.type === 'bet' || a.type === 'raise' ? `${a.type} to ${a.amount}` : a.type === 'call' ? `call ${a.amount}` : a.type;
    return `${STREET_NAMES[a.street]}: ${names[a.seat]} ${what}${a.allIn ? ' (all-in)' : ''}`;
  });
}

function CardSetup({ label, value, max, used, onChange }: { label: string; value: Card[]; max: number; used: Card[]; onChange: (c: Card[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-xs text-muted">{label}</span>
        {value.length ? <CardText cards={value} /> : <span className="text-xs text-muted">random</span>}
        <Button variant="ghost" className="min-h-9 px-2" onClick={() => setOpen(!open)}>
          {open ? 'Done' : 'Set'}
        </Button>
        {value.length > 0 && (
          <Button variant="ghost" className="min-h-9 px-2" onClick={() => onChange([])}>
            Random
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2">
          <CardPicker value={value} max={max} used={used} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export default function PlayHand() {
  const [settings] = useSettings();
  const [presets, setPresets] = usePresets();
  const defaultSize = settings.tableSize;
  const [setup, setSetup] = useState<Setup>(() => randomSetup(defaultSize, settings.stackDepth));
  const [phase, setPhase] = useState<'setup' | 'playing' | 'review'>('setup');
  const [snaps, setSnaps] = useState<HUState[]>([]);
  const [heroDecs, setHeroDecs] = useState<HeroDecision[]>([]);
  const [botLogs, setBotLogs] = useState<{ histIndex: number; log: BotLog }[]>([]);
  const [delay, setDelay] = useState(700);
  const [thinking, setThinking] = useState(false);
  const [reviews, setReviews] = useState<HeroReview[] | null>(null);
  const [viewIdx, setViewIdx] = useState(0);
  const [openBot, setOpenBot] = useState<number | null>(null);
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState('');
  const token = useRef(0);
  const recorded = useRef<string>('');

  const st = snaps[snaps.length - 1];
  const style = STYLES[setup.style];

  const start = (s: Setup) => {
    try {
      const cfg = toConfig(s);
      const first = newHand(cfg);
      token.current++;
      setSetup(s);
      setSnaps([first]);
      setHeroDecs([]);
      setBotLogs([]);
      setReviews(null);
      setOpenBot(null);
      setError('');
      setPhase(first.over ? 'review' : 'playing');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // bot loop
  useEffect(() => {
    if (phase !== 'playing' || !st || st.over || st.toAct !== BOT) return;
    const my = ++token.current;
    setThinking(true);
    const botCount = botLogs.length;
    const timer = setTimeout(async () => {
      try {
        const d = await botDecide(botView(st, BOT, botCount), style, setup.seed, eqFn);
        if (token.current !== my) return;
        const next = act(st, d.type, d.to);
        setBotLogs((l) => [...l, { histIndex: st.history.length, log: d.log }]);
        setSnaps((x) => [...x, next]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (token.current === my) setThinking(false);
      }
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, phase]);

  // hand over → review
  useEffect(() => {
    if (phase === 'playing' && st?.over) {
      setPhase('review');
      setViewIdx(snaps.length - 1);
    }
  }, [st, phase, snaps.length]);

  // compute reviews (worker) and record decisions into stats once
  useEffect(() => {
    if (phase !== 'review' || !st?.over || reviews) return;
    let cancelled = false;
    (async () => {
      const out: HeroReview[] = [];
      for (const d of heroDecs) out.push(await reviewDecision(snaps[d.snapIndex], HERO, d.type, d.to, d.histIndex, reviewEq));
      if (cancelled) return;
      setReviews(out);
      const key = `${setup.seed}-${st.history.length}-${heroDecs.map((d) => d.type + (d.to ?? '')).join(',')}`;
      if (recorded.current !== key) {
        recorded.current = key;
        out.forEach((r) =>
          recordAnswer({
            t: Date.now(),
            kind: 'hand',
            id: `hu-${setup.seed}-${r.index}`,
            mode: 'B',
            street: STREET_NAMES[r.street],
            position: setup.heroPos,
            concepts: r.concepts,
            tags: ['heads-up', STREET_NAMES[r.street], `chose-${r.action.split(' ')[0]}`],
            grade: r.verdict === 'close' ? 'ok' : r.verdict,
            chosen: r.action,
            summary: `Play a hand vs bot — ${setup.heroPos} vs ${setup.botPos}, ${STREET_NAMES[r.street]} (${r.action})`,
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, st]);

  const heroAct = (type: ActionType, to?: number) => {
    if (!st || st.toAct !== HERO || phase !== 'playing') return;
    try {
      const next = act(st, type, to);
      setHeroDecs((d) => [...d, { histIndex: st.history.length, snapIndex: snaps.length - 1, type, to }]);
      setSnaps((x) => [...x, next]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const branch = (d: HeroDecision) => {
    token.current++;
    setSnaps((x) => x.slice(0, d.snapIndex + 1));
    setHeroDecs((h) => h.filter((x) => x.histIndex < d.histIndex));
    setBotLogs((b) => b.filter((x) => x.histIndex < d.histIndex));
    setReviews(null);
    setPhase('playing');
  };

  // keyboard: F fold, C check/call, 1-6 sizes
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (phase !== 'playing' || !st || st.toAct !== HERO || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const L = legalActions(st);
      const k = e.key.toLowerCase();
      if (k === 'f' && L.fold) heroAct('fold');
      if (k === 'c') L.check ? heroAct('check') : L.call !== null && heroAct('call');
      const sizes = sizeButtons(st);
      if (/^[1-6]$/.test(k) && sizes[+k - 1]) heroAct(sizes[+k - 1].type, sizes[+k - 1].to);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------------- SETUP ----------------
  if (phase === 'setup' || !st) {
    const order = ORDER[setup.tableSize];
    const used = (except: 'hero' | 'bot' | 'board') => [...(except !== 'hero' ? setup.heroCards : []), ...(except !== 'bot' ? setup.botCards : []), ...(except !== 'board' ? setup.board : [])];
    const savePreset = () => {
      const name = presetName.trim() || `Preset ${Object.keys(presets.play).length + 1}`;
      setPresets((p) => ({ ...p, play: { ...p.play, [name]: setup } }));
      setPresetName('');
    };
    return (
      <div className="space-y-3">
        <Panel
          title={
            <span className="flex items-center gap-2">
              Play a hand — heads-up vs a bot <KindBadge kind="theory" />
            </span>
          }
        >
          <p className="text-sm">Everyone else folded; it's you against one opponent. You play your decisions, the bot plays its own, and afterwards you get a review of each of your decisions.</p>
          <p className="mt-1 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">🤖 Rule-based bot: plays sensibly, not perfectly. It only knows its own cards and the public information.</p>
          <Button variant="primary" className="mt-3 w-full min-h-14 text-lg" onClick={() => start(randomSetup(setup.tableSize, setup.stack))}>
            🎲 Random hand
          </Button>
        </Panel>
        <Panel title="Set up a specific hand">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Table</span>
              {([2, 6, 9] as const).map((n) => (
                <Chip key={n} active={setup.tableSize === n} onClick={() => setSetup({ ...setup, tableSize: n, heroPos: ORDER[n][n === 2 ? 0 : ORDER[n].length - 3], botPos: ORDER[n][ORDER[n].length - 1] })}>
                  {n === 2 ? 'Heads-up game' : `${n}-max`}
                </Chip>
              ))}
            </div>
            {(['heroPos', 'botPos'] as const).map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs text-muted">{k === 'heroPos' ? 'Your seat' : "Bot's seat"}</span>
                {order.map((p) => (
                  <Chip key={p} active={setup[k] === p} onClick={() => setSetup({ ...setup, [k]: p, ...(setup[k === 'heroPos' ? 'botPos' : 'heroPos'] === p ? { [k === 'heroPos' ? 'botPos' : 'heroPos']: setup[k] } : {}) })}>
                    {p}
                  </Chip>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Stacks</span>
              {[20, 50, 100, 200].map((n) => (
                <Chip key={n} active={setup.stack === n} onClick={() => setSetup({ ...setup, stack: n })}>
                  {n}bb
                </Chip>
              ))}
              <input type="number" min={2} max={1000} value={setup.stack} onChange={(e) => setSetup({ ...setup, stack: Math.max(2, Math.min(1000, +e.target.value || 100)) })} className="w-20 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm" aria-label="Custom stack" />
            </div>
            <CardSetup label="Your cards" value={setup.heroCards} max={2} used={used('hero')} onChange={(c) => setSetup({ ...setup, heroCards: c })} />
            <CardSetup label="Bot's cards" value={setup.botCards} max={2} used={used('bot')} onChange={(c) => setSetup({ ...setup, botCards: c })} />
            <CardSetup label="Board (flop, turn, river in order)" value={setup.board} max={5} used={used('board')} onChange={(c) => setSetup({ ...setup, board: c })} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Bot style</span>
              {Object.values(STYLES).map((x) => (
                <Chip key={x.id} active={setup.style === x.id} onClick={() => setSetup({ ...setup, style: x.id })}>
                  {x.name}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-muted">{STYLES[setup.style].description}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Seed</span>
              <input type="number" value={setup.seed} onChange={(e) => setSetup({ ...setup, seed: +e.target.value | 0 })} className="w-32 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm" />
              <Button variant="ghost" className="min-h-9 px-2" onClick={() => setSetup({ ...setup, seed: (Math.random() * 1e9) | 0 })}>
                New seed
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Bot delay</span>
              <input type="range" min={0} max={2000} step={100} value={delay} onChange={(e) => setDelay(+e.target.value)} aria-label="Bot delay" />
              <span className="text-xs text-muted">{delay} ms</span>
            </div>
            <Button variant="primary" className="w-full" onClick={() => start(setup)}>
              ▶ Deal this hand
            </Button>
            {error && <p className="text-sm text-bad">{error}</p>}
          </div>
        </Panel>
        <Panel title="Saved setups">
          <div className="flex gap-2">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this setup" className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm" />
            <Button onClick={savePreset}>Save</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(presets.play).map(([name, p]) => (
              <span key={name} className="flex items-center gap-1 rounded-full border border-line px-1">
                <button className="px-2 py-1 text-sm hover:text-accent" onClick={() => setSetup(p as Setup)}>
                  {name}
                </button>
                <button className="px-1 text-xs text-muted hover:text-bad" aria-label={`Delete ${name}`} onClick={() => setPresets((x) => { const play = { ...x.play }; delete play[name]; return { ...x, play }; })}>
                  ✕
                </button>
              </span>
            ))}
            {!Object.keys(presets.play).length && <span className="text-xs text-muted">No saved setups yet. They're included in Settings → Export.</span>}
          </div>
        </Panel>
      </div>
    );
  }

  // ---------------- PLAYING ----------------
  if (phase === 'playing') {
    const L = legalActions(st);
    const heroTurn = st.toAct === HERO && !thinking;
    const sizes = heroTurn ? sizeButtons(st) : [];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {setup.heroPos} vs {setup.botPos} · {style.name} · seed {setup.seed}
          </span>
          <button className="text-info hover:underline" onClick={() => setPhase('setup')}>
            New setup
          </button>
        </div>
        <TableView st={st} reveal={false} active />
        <div className="min-h-6 text-center text-sm text-muted">{st.toAct === BOT ? '🤖 Bot is thinking…' : heroTurn ? 'Your turn' : ''}</div>
        {heroTurn && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {L.fold && (
                <Button className="min-h-14 border-bad/50 text-base" onClick={() => heroAct('fold')}>
                  Fold <span className="ml-1 hidden text-xs opacity-60 sm:inline">(F)</span>
                </Button>
              )}
              {L.check && (
                <Button variant="primary" className="min-h-14 text-base" onClick={() => heroAct('check')}>
                  Check <span className="ml-1 hidden text-xs opacity-60 sm:inline">(C)</span>
                </Button>
              )}
              {L.call !== null && (
                <Button variant="primary" className="min-h-14 text-base" onClick={() => heroAct('call')}>
                  Call {L.call}
                  {L.call >= st.stack[HERO] ? ' (all-in)' : ''} <span className="ml-1 hidden text-xs opacity-60 sm:inline">(C)</span>
                </Button>
              )}
            </div>
            {sizes.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-muted">{L.bet ? 'Bet' : 'Raise'}</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {sizes.map((b, i) => (
                    <Button key={b.label} className="min-h-12 text-xs" onClick={() => heroAct(b.type, b.to)}>
                      <span className="mr-1 hidden text-muted sm:inline">{i + 1}</span>
                      {b.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <Panel title="Action">
          <ol className="space-y-0.5 text-sm">
            {actionText(st, st.history.length).map((t, i) => (
              <li key={i} className="text-muted">
                {t}
              </li>
            ))}
            {!st.history.length && <li className="text-muted">Blinds posted.</li>}
          </ol>
        </Panel>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    );
  }

  // ---------------- REVIEW ----------------
  return <Review {...{ snaps, setup, heroDecs, botLogs, reviews, viewIdx, setViewIdx, openBot, setOpenBot, start, branch, setPhase }} />;
}

function Review({
  snaps,
  setup,
  heroDecs,
  botLogs,
  reviews,
  viewIdx,
  setViewIdx,
  openBot,
  setOpenBot,
  start,
  branch,
  setPhase,
}: {
  snaps: HUState[];
  setup: Setup;
  heroDecs: HeroDecision[];
  botLogs: { histIndex: number; log: BotLog }[];
  reviews: HeroReview[] | null;
  viewIdx: number;
  setViewIdx: (n: number) => void;
  openBot: number | null;
  setOpenBot: (n: number | null) => void;
  start: (s: Setup) => void;
  branch: (d: HeroDecision) => void;
  setPhase: (p: 'setup' | 'playing' | 'review') => void;
}) {
  const [s] = useSettings();
  const final = snaps[snaps.length - 1];
  const view = snaps[Math.min(viewIdx, snaps.length - 1)];
  const r = final.result!;
  const [copied, setCopied] = useState(false);
  // all-in runout: equities before each street from the street where both stacks went in
  const allInStreet = useMemo(() => {
    const a = final.history.findIndex((x) => x.allIn);
    if (a < 0 || r.reason !== 'showdown') return null;
    const lastAction = final.history[final.history.length - 1];
    return lastAction.street;
  }, [final, r.reason]);
  const runout = useMemo(() => {
    if (allInStreet === null) return [];
    const stages: { label: string; board: Card[] }[] = [];
    for (let k = allInStreet; k <= 3; k++) stages.push({ label: STREET_NAMES[k], board: final.boardAll.slice(0, k === 0 ? 0 : k === 1 ? 3 : k === 2 ? 4 : 5) });
    return stages.map((x) => ({ ...x, eq: x.board.length >= 3 ? equityVsHand(final.holes[0], final.holes[1], x.board).equity : null }));
  }, [allInStreet, final]);
  const [preflopEq, setPreflopEq] = useState<number | null>(null);
  useEffect(() => {
    if (allInStreet === 0) computeEquity({ hero: final.holes[0], villainHand: final.holes[1] }).then((x) => setPreflopEq(x.equity));
  }, [allInStreet, final]);
  const hh = handHistory(snaps, setup, botLogs);
  const outcome = r.reason === 'fold' ? (r.winners[0] === HERO ? 'The bot folded — you win the pot' : 'You folded') : r.winners.length === 2 ? 'Split pot' : r.winners[0] === HERO ? 'You win at showdown' : 'The bot wins at showdown';

  return (
    <div className="space-y-3">
      <Panel title="Hand over">
        <div className="text-lg font-bold">{outcome}</div>
        <div className="text-sm">
          Result: <b style={{ color: r.net[0] >= 0 ? 'var(--good)' : 'var(--bad)' }}>{r.net[0] >= 0 ? '+' : ''}{fmtAmount(r.net[0], s)}</b>
          {r.returned ? <span className="text-muted"> · uncalled {fmtAmount(r.returned, s)} returned</span> : null}
          {r.hands && (
            <span className="text-muted">
              {' '}
              · you: {describeHand(r.hands[0])} · bot: {describeHand(r.hands[1])}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">Results are luck in the short run. Your grades below judge decisions by the math available at the time.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => start({ ...setup, seed: (Math.random() * 1e9) | 0 })}>
            ▶ Next hand (same setup)
          </Button>
          <Button onClick={() => start(setup)}>↺ Replay same hand (seed {setup.seed})</Button>
          <Button onClick={() => setPhase('setup')}>Change setup</Button>
        </div>
      </Panel>

      {allInStreet !== null && (
        <Panel title="All-in runout — equity before each street" right={<KindBadge kind="math" />}>
          <table className="w-full text-sm">
            <tbody>
              {runout.map((x) => {
                const eq = x.eq ?? preflopEq;
                return (
                  <tr key={x.label} className="border-t border-line">
                    <td className="py-1.5 pr-2 capitalize">{x.label}</td>
                    <td className="py-1.5 pr-2">{x.board.length ? <CardText cards={x.board} /> : '—'}</td>
                    <td className="tabular py-1.5 pr-2 text-right">You {eq === null ? '…' : pct(eq)}</td>
                    <td className="tabular py-1.5 text-right">Bot {eq === null ? '…' : pct(1 - eq)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted">Both hands known; exact enumeration of the remaining cards.</p>
        </Panel>
      )}

      <Panel title="Step through the hand">
        <TableView st={view} reveal={viewIdx >= snaps.length - 1} active={false} />
        <div className="mt-2 flex items-center gap-2">
          <Button className="min-h-9" onClick={() => setViewIdx(Math.max(0, viewIdx - 1))} disabled={viewIdx === 0}>
            ◀ Back
          </Button>
          <input type="range" min={0} max={snaps.length - 1} value={viewIdx} onChange={(e) => setViewIdx(+e.target.value)} className="flex-1" aria-label="Step" />
          <Button className="min-h-9" onClick={() => setViewIdx(Math.min(snaps.length - 1, viewIdx + 1))} disabled={viewIdx >= snaps.length - 1}>
            Forward ▶
          </Button>
        </div>
        <div className="mt-1 text-xs text-muted">{viewIdx === 0 ? 'Blinds posted.' : actionText(final, viewIdx).slice(-1)[0]}</div>
      </Panel>

      <Panel title="Your decisions" right={<span className="text-xs text-muted">judged by the math, not the result</span>}>
        {!reviews && <p className="text-sm text-muted">Calculating…</p>}
        {reviews && !reviews.length && <p className="text-sm text-muted">You didn't make a decision this hand.</p>}
        <div className="space-y-3">
          {reviews?.map((rv, i) => {
            const v = VERDICT_UI[rv.verdict];
            return (
              <div key={i} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold capitalize">
                    {STREET_NAMES[rv.street]}: {rv.action}
                  </div>
                  <span style={{ color: v.color }} className="font-semibold">
                    {v.icon} {v.label}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {rv.equity !== undefined && <Stat label="Your equity" value={`${rv.equityApprox ? '≈' : ''}${pct(rv.equity)}`} sub="vs the stated range" tone="good" />}
                  {rv.required !== undefined && <Stat label="Required" value={pct(rv.required)} sub="pot odds" tone="ok" />}
                  {rv.hindsight !== undefined && <Stat label="With hindsight" value={pct(rv.hindsight)} sub="you couldn't know this" />}
                  {rv.rangeCombos !== undefined && <Stat label="Range used" value={`~${rv.rangeCombos} combos`} />}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {rv.bullets.map((b, k) => (
                    <li key={k}>{b}</li>
                  ))}
                </ul>
                <div className="mt-1 text-xs text-muted">
                  Basis: {rv.basis === 'chart' ? `cited chart (${rv.chartTitle})` : rv.basis === 'equity' ? 'equity vs price' : rv.basis === 'value-rule' ? 'value rule' : 'not graded'} · Range: {rv.rangeLabel}
                </div>
                {rv.hindsight !== undefined && <div className="mt-1 text-xs text-muted">With hindsight (you couldn't know this): vs the bot's actual {cardsToString(final.holes[BOT])} you had {pct(rv.hindsight)}.</div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {rv.concepts.map((c) =>
                    conceptById(c) ? (
                      <button key={c} onClick={() => go(`reference/concepts?focus=${c}`)} className="rounded-full border border-info px-2 py-0.5 text-xs text-info">
                        {conceptById(c)!.title}
                      </button>
                    ) : null,
                  )}
                  <button className="rounded-full border border-line px-2 py-0.5 text-xs hover:text-accent" onClick={() => branch(heroDecs[i])}>
                    ↪ Try a different decision from here
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Bot reasoning log" right={<span className="text-xs text-muted">only shown after the hand</span>}>
        <div className="space-y-2">
          {botLogs.map((b, i) => (
            <div key={i} className="rounded-xl bg-surface-2">
              <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpenBot(openBot === i ? null : i)}>
                <span className="capitalize">
                  {STREET_NAMES[b.log.street]}: <b>{b.log.action}</b>
                </span>
                <span className="text-xs text-muted">{openBot === i ? '▲' : '▼'}</span>
              </button>
              {openBot === i && (
                <div className="space-y-2 px-3 pb-3 text-sm">
                  <div>
                    <b>Rule:</b> {b.log.rule}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {b.log.hand && <Stat label="Its hand" value={<span className="text-sm">{b.log.hand}</span>} />}
                    {b.log.bucket && <Stat label="Bucket" value={b.log.bucket} />}
                    {b.log.equity !== undefined && <Stat label="Its equity" value={`≈${pct(b.log.equity)}`} sub="vs your estimated range" />}
                    {b.log.required !== undefined && <Stat label="Price" value={pct(b.log.required)} />}
                  </div>
                  {b.log.oppRange && (
                    <div>
                      <div className="mb-1 text-xs text-muted">Its estimate of your range (~{b.log.oppRangeCombos} combos) — darker = more likely</div>
                      <RangeGrid
                        compact
                        paint={(cls) => {
                          const w = new Map(b.log.oppRange!).get(cls) ?? 0;
                          return { segments: [{ color: w > 0 ? `color-mix(in srgb, var(--series-1) ${Math.round(15 + w * 85)}%, var(--act-fold))` : 'var(--act-fold)', weight: 1 }], title: `${cls}: ${Math.round(w * 100)}%` };
                        }}
                      />
                      <div className="mt-1">
                        <Legend items={[{ color: 'var(--series-1)', label: 'likely' }, { color: 'var(--act-fold)', label: 'unlikely / impossible' }]} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {!botLogs.length && <p className="text-sm text-muted">The bot made no decisions.</p>}
        </div>
        <details className="mt-3 text-xs text-muted">
          <summary className="text-info">How the bot estimates your range</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {RANGE_RULES.preflop.map((x) => (
              <li key={x}>{x}</li>
            ))}
            <li>{RANGE_RULES.postflop}</li>
          </ul>
        </details>
      </Panel>

      <Panel title="Hand history">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs">{hh}</pre>
        <div className="mt-2 flex gap-2">
          <Button
            onClick={() => {
              navigator.clipboard?.writeText(hh).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            {copied ? 'Copied ✓' : 'Copy text'}
          </Button>
          <Button
            onClick={() => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([hh], { type: 'text/plain' }));
              a.download = `hand-${setup.seed}.txt`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download .txt
          </Button>
        </div>
      </Panel>
    </div>
  );
}
