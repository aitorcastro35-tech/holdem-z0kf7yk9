import { useEffect, useMemo, useRef, useState } from 'react';
import { type Card, cardsToString, mulberry32 } from '../../engine/cards';
import { describe as describeHand } from '../../engine/evaluator';
import { newMWHand, mwAct, mwLegal, mwTotalPot, mwToCall, currentPots, positionsFor, actingOrder, MW_STREETS, type MWConfig, type MWState, type MWActionType } from '../../engine/multiway';
import { mwBotView, mwBotDecide, STYLES, ACTION_TABLE_WIDEN, valueThreshold, fairShare, type MWBotLog, type MultiEqFn } from '../../bot/mwbot';
import type { BotStyle } from '../../bot/bot';
import { reviewMWDecision } from '../../bot/mwreview';
import type { HeroReview } from '../../bot/review';
import { RANGE_RULES } from '../../bot/ranges';
import { computeMultiEquity, computeHandsEquity } from '../../workers/equityClient';
import { useSettings, fmtAmount } from '../../store/settings';
import { recordAnswer } from '../../store/progress';
import { usePresets } from '../../store/presets';
import { CardPicker } from '../../components/CardPicker';
import { RangeGrid, Legend } from '../../components/RangeGrid';
import { GRADE_UI } from '../train/Explanation';
import { conceptById } from '../../data/concepts';
import { Panel, Button, Chip, Cards, CardText, KindBadge, Stat, pct, cx } from '../../components/ui';
import { go } from '../../router';

type StyleId = BotStyle['id'];
/** "Home-game mix": opponents take styles in this order (documented in SOURCES.md §10). */
export const HOME_MIX: StyleId[] = ['station', 'solid', 'maniac', 'solid', 'solid'];

const botEq: MultiEqFn = (h, r, b, seed) => computeMultiEquity(h, r, b, { iterations: 2500, seed, timeBudgetMs: 250 });
const reviewEq: MultiEqFn = (h, r, b, seed) => computeMultiEquity(h, r, b, { iterations: 20_000, seed });

interface Setup {
  opponents: number; // 1..5
  heroPos: string | 'random';
  rotate: boolean;
  stack: number;
  carryOver: boolean;
  styles: StyleId[]; // per opponent
  heroCards: Card[];
  botCards: Card[][]; // per opponent
  board: Card[];
  seed: number;
  actionTable: boolean;
  autoSkip: boolean;
  autoDeal: boolean;
  delay: number;
}

interface HeroDecision {
  histIndex: number;
  snapIndex: number;
  type: MWActionType;
  to?: number;
}
interface BotRec {
  histIndex: number;
  player: number;
  log: MWBotLog;
}

const VERDICT_UI: Record<string, { icon: string; label: string; color: string }> = { ...GRADE_UI, close: { icon: '⚖️', label: 'Close / depends on reads', color: 'var(--info)' } };
const playerName = (p: number) => (p === 0 ? 'You' : `Bot ${p}`);
const handSeed = (seed: number, hand: number) => (Math.imul(seed ^ 0x9e3779b9, 2654435761) + hand * 40503) >>> 0;

function defaultSetup(stack: number): Setup {
  return { opponents: 3, heroPos: 'random', rotate: true, stack, carryOver: true, styles: ['solid', 'solid', 'solid', 'solid', 'solid'], heroCards: [], botCards: [[], [], [], [], []], board: [], seed: (Math.random() * 1e9) | 0, actionTable: false, autoSkip: true, autoDeal: false, delay: 600 };
}

/** Positions per player for hand number h (players: 0 = you, 1..k = bots). */
function positionsForHand(s: Setup, h: number, heroStart: number): string[] {
  const n = s.opponents + 1;
  const list = positionsFor(n);
  const rot = s.rotate ? h : 0;
  return Array.from({ length: n }, (_, p) => list[(((heroStart + p + rot) % n) + n) % n]);
}

function sizeButtons(st: MWState): { label: string; type: 'bet' | 'raise'; to: number }[] {
  const L = mwLegal(st);
  const out: { label: string; type: 'bet' | 'raise'; to: number }[] = [];
  const add = (label: string, type: 'bet' | 'raise', to: number) => {
    const r = type === 'bet' ? L.bet! : L.raise!;
    const t = Math.round(Math.max(r.min, Math.min(r.max, to)) * 10) / 10;
    if (!out.some((o) => o.to === t)) out.push({ label: t >= r.max ? `All-in ${t}` : label, type, to: t });
  };
  const pot = mwTotalPot(st);
  const s = st.toAct!;
  if (L.bet) {
    for (const f of [0.33, 0.5, 0.75, 1]) add(`${Math.round(f * 100)}% (${Math.round(pot * f * 10) / 10})`, 'bet', pot * f);
    add('All-in', 'bet', L.bet.max);
  } else if (L.raise) {
    const cur = st.currentBet / 100;
    const limpers = st.history.filter((a) => a.street === 0 && a.type === 'call').length;
    if (st.street === 0 && cur <= 1) for (const x of [2.5, 3, 4].map((y) => y + limpers)) add(`Raise to ${x}`, 'raise', x);
    else {
      add(`Min (${L.raise.min})`, 'raise', L.raise.min);
      for (const x of [2.5, 3]) add(`${x}× (${Math.round(cur * x * 10) / 10})`, 'raise', cur * x);
      add(`Pot (${Math.round((cur + pot + mwToCall(st, s)) * 10) / 10})`, 'raise', cur + pot + mwToCall(st, s));
    }
    add('All-in', 'raise', L.raise.max);
  }
  return out;
}

function handHistory(st: MWState, styles: StyleId[], handNo: number, seed: number): string {
  const lines = [`Hold'em Trainer — ${st.n}-handed hand #${handNo + 1} (session seed ${seed}, hand seed ${st.cfg.seed}). Bots are rule-based, not solvers.`];
  for (let p = 0; p < st.n; p++) lines.push(`${playerName(p)} (${st.cfg.positions[p]}${p ? `, ${STYLES[styles[p - 1]].name}` : ''}) ${st.cfg.stacks[p]}bb: ${cardsToString(st.holes[p])}`);
  let street = -1;
  for (const a of st.history) {
    if (a.street !== street) {
      street = a.street;
      lines.push(`*** ${MW_STREETS[street].toUpperCase()}${street ? ` [${cardsToString(st.boardAll.slice(0, street === 1 ? 3 : street === 2 ? 4 : 5))}]` : ''} ***`);
    }
    const what = a.type === 'bet' || a.type === 'raise' ? `${a.type}s to ${a.amount}` : a.type === 'call' ? `calls ${a.amount}` : `${a.type}s`;
    lines.push(`${playerName(a.seat)}: ${what}${a.allIn ? ' (all-in)' : ''}`);
  }
  if (st.result) {
    if (st.result.reason === 'showdown') lines.push(`*** SHOWDOWN [${cardsToString(st.boardAll)}] ***`);
    st.result.pots.forEach((p, i) => lines.push(`${i === 0 ? 'Main pot' : `Side pot ${i}`} ${p.amount}bb → ${p.winners.map(playerName).join(' & ')}`));
    st.result.returned.forEach((r) => lines.push(`Uncalled ${r.amount}bb returned to ${playerName(r.seat)}`));
    lines.push(`Net: ${st.result.net.map((x, p) => `${playerName(p)} ${x >= 0 ? '+' : ''}${x}`).join(', ')}`);
  }
  return lines.join('\n');
}

function Seat({ st, p, styles, reveal, active, s }: { st: MWState; p: number; styles: StyleId[]; reveal: boolean; active: boolean; s: ReturnType<typeof useSettings>[0] }) {
  const pos = st.cfg.positions[p];
  const folded = st.folded[p];
  const allIn = !folded && st.stack[p] === 0;
  const isBtn = pos === 'BTN';
  return (
    <div className={cx('relative min-w-0 rounded-xl px-2 py-1.5 text-white', folded ? 'bg-black/10 opacity-45' : 'bg-black/30', active && 'ring-2 ring-amber-300')}>
      {isBtn && <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">D</span>}
      <div className="flex items-center justify-between gap-1 text-[11px]">
        <span className="truncate font-semibold">{playerName(p)}</span>
        <span className="text-white/80">{pos}</span>
      </div>
      {p > 0 && <div className="truncate text-[10px] text-white/60">{STYLES[styles[p - 1]].name}</div>}
      <div className="mt-1 flex items-center gap-1">
        {p === 0 || reveal ? (
          <Cards cards={st.holes[p]} size="sm" />
        ) : (
          [0, 1].map((i) => <div key={i} className="h-11 w-8 rounded-md border border-white/30" style={{ background: 'repeating-linear-gradient(45deg,#2d5b8a,#2d5b8a 4px,#24496f 4px,#24496f 8px)' }} />)
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="tabular">{fmtAmount(st.stack[p] / 100, s)}</span>
        <span className="tabular text-amber-200">{folded ? 'folded' : allIn ? 'ALL-IN' : st.committed[p] ? `bet ${fmtAmount(st.committed[p] / 100, s)}` : ''}</span>
      </div>
    </div>
  );
}

function TableView({ st, styles, reveal, live }: { st: MWState; styles: StyleId[]; reveal: boolean; live: boolean }) {
  const [s] = useSettings();
  // seats clockwise starting from your left (postflop order rotated to you)
  const order = actingOrder(st.cfg, 1);
  const at = order.indexOf(0);
  const others = [...order.slice(at + 1), ...order.slice(0, at)];
  const pots = currentPots(st);
  return (
    <div className="space-y-2 rounded-3xl border-4 p-2 sm:p-3" style={{ background: 'radial-gradient(ellipse at center, var(--felt) 0%, var(--felt-edge) 100%)', borderColor: 'var(--felt-edge)' }}>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {others.map((p) => (
          <Seat key={p} st={st} p={p} styles={styles} reveal={reveal} active={live && st.toAct === p} s={s} />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1 py-1">
        <div className="text-xs uppercase tracking-wide text-white/70">{MW_STREETS[st.street]}</div>
        <div className="flex flex-wrap justify-center gap-2 text-white">
          {pots.length <= 1 ? (
            <span className="tabular text-lg font-bold">Pot {fmtAmount(mwTotalPot(st), s)}</span>
          ) : (
            pots.map((p, i) => (
              <span key={i} className="rounded-lg bg-black/30 px-2 py-0.5 text-sm">
                {i === 0 ? 'Main' : `Side ${i}`} <b className="tabular">{fmtAmount(p.amount, s)}</b>
              </span>
            ))
          )}
        </div>
        <div className="min-h-12">{st.board.length ? <Cards cards={st.board} size="md" /> : <div className="pt-3 text-sm text-white/60">Preflop</div>}</div>
      </div>
      <div className="mx-auto max-w-[220px]">
        <Seat st={st} p={0} styles={styles} reveal active={live && st.toAct === 0} s={s} />
      </div>
    </div>
  );
}

function CardSetup({ label, value, max, used, onChange }: { label: string; value: Card[]; max: number; used: Card[]; onChange: (c: Card[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
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
  const [setup, setSetup] = useState<Setup>(() => defaultSetup(settings.stackDepth));
  const [phase, setPhase] = useState<'setup' | 'playing' | 'review'>('setup');
  const [snaps, setSnaps] = useState<MWState[]>([]);
  const [heroDecs, setHeroDecs] = useState<HeroDecision[]>([]);
  const [botRecs, setBotRecs] = useState<BotRec[]>([]);
  const [reviews, setReviews] = useState<(HeroReview & { players: number })[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [skip, setSkip] = useState(false);
  const [handNo, setHandNo] = useState(0);
  const [heroStart, setHeroStart] = useState(0);
  const [stacks, setStacks] = useState<number[]>([]);
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState('');
  const token = useRef(0);
  const recorded = useRef('');
  const st = snaps[snaps.length - 1];
  const n = setup.opponents + 1;

  const deal = (s: Setup, h: number, startPos: number, stk: number[]) => {
    try {
      const positions = positionsForHand(s, h, startPos);
      const cfg: MWConfig = { seed: handSeed(s.seed, h), positions, stacks: stk, holes: [s.heroCards.length === 2 ? s.heroCards : undefined, ...s.botCards.slice(0, s.opponents).map((c) => (c.length === 2 ? c : undefined))], board: [0, 1, 2, 3, 4].map((i) => s.board[i]) };
      const first = newMWHand(cfg);
      token.current++;
      setSnaps([first]);
      setHeroDecs([]);
      setBotRecs([]);
      setReviews(null);
      setSkip(false);
      setError('');
      setPhase(first.over ? 'review' : 'playing');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startSession = (s: Setup) => {
    const list = positionsFor(s.opponents + 1);
    const start = s.heroPos === 'random' ? Math.floor(mulberry32(s.seed)() * list.length) : Math.max(0, list.indexOf(s.heroPos));
    const stk = Array(s.opponents + 1).fill(s.stack);
    setSetup(s);
    setHandNo(0);
    setHeroStart(start);
    setStacks(stk);
    deal(s, 0, start, stk);
  };

  const nextHand = () => {
    const h = handNo + 1;
    const stk = setup.carryOver && st?.over ? st.stack.map((c) => (c > 0 ? c / 100 : setup.stack)) : Array(n).fill(setup.stack);
    setHandNo(h);
    setStacks(stk);
    deal(setup, h, heroStart, stk);
  };

  // bot loop
  useEffect(() => {
    if (phase !== 'playing' || !st || st.over || st.toAct === null || st.toAct === 0) return;
    const my = ++token.current;
    const seat = st.toAct;
    setThinking(true);
    const heroOut = st.folded[0] || st.stack[0] === 0;
    const wait = skip || (setup.autoSkip && heroOut) ? 0 : setup.delay;
    const count = botRecs.filter((b) => b.player === seat).length;
    const timer = setTimeout(async () => {
      try {
        const d = await mwBotDecide(mwBotView(st, seat, count), STYLES[setup.styles[seat - 1]], st.cfg.seed, botEq, { actionTable: setup.actionTable });
        if (token.current !== my) return;
        const next = mwAct(st, d.type, d.to);
        setBotRecs((l) => [...l, { histIndex: st.history.length, player: seat, log: d.log }]);
        setSnaps((x) => [...x, next]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (token.current === my) setThinking(false);
      }
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, phase, skip]);

  useEffect(() => {
    if (phase === 'playing' && st?.over) setPhase('review');
  }, [st, phase]);

  // reviews + stats
  useEffect(() => {
    if (phase !== 'review' || !st?.over || reviews) return;
    let cancelled = false;
    (async () => {
      const out: (HeroReview & { players: number })[] = [];
      for (const d of heroDecs) out.push(await reviewMWDecision(snaps[d.snapIndex], 0, d.type, d.to, d.histIndex, reviewEq));
      if (cancelled) return;
      setReviews(out);
      const key = `${st.cfg.seed}-${st.history.length}-${heroDecs.map((d) => d.type + (d.to ?? '')).join(',')}`;
      if (recorded.current !== key) {
        recorded.current = key;
        out.forEach((r) =>
          recordAnswer({
            t: Date.now(),
            kind: 'hand',
            id: `mw-${st.cfg.seed}-${r.index}`,
            mode: 'B',
            street: MW_STREETS[r.street],
            position: st.cfg.positions[0],
            concepts: r.concepts,
            tags: ['play', r.players === 2 ? 'heads-up' : 'multiway', `players-${r.players}`, MW_STREETS[r.street], `chose-${r.action.split(' ')[0]}`],
            grade: r.verdict === 'close' ? 'ok' : r.verdict,
            chosen: r.action,
            summary: `Play a hand (${r.players} players) — ${st.cfg.positions[0]}, ${MW_STREETS[r.street]} (${r.action})`,
          }),
        );
      }
      if (setup.autoDeal) setTimeout(() => !cancelled && nextHand(), 2500);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, st]);

  const heroAct = (type: MWActionType, to?: number) => {
    if (!st || st.toAct !== 0 || phase !== 'playing') return;
    try {
      const next = mwAct(st, type, to);
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
    setBotRecs((b) => b.filter((x) => x.histIndex < d.histIndex));
    setReviews(null);
    setSkip(false);
    setPhase('playing');
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (phase !== 'playing' || !st || st.toAct !== 0 || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const L = mwLegal(st);
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
    const list = positionsFor(setup.opponents + 1);
    const usedBy = (except: string) => [
      ...(except !== 'hero' ? setup.heroCards : []),
      ...setup.botCards.slice(0, setup.opponents).flatMap((c, i) => (except !== `bot${i}` ? c : [])),
      ...(except !== 'board' ? setup.board : []),
    ];
    const setStyle = (i: number, id: StyleId) => setSetup((x) => ({ ...x, styles: x.styles.map((y, j) => (j === i ? id : y)) }));
    return (
      <div className="space-y-3">
        <Panel
          title={
            <span className="flex items-center gap-2">
              Play a hand — you vs 1 to 5 bots <KindBadge kind="theory" />
            </span>
          }
        >
          <p className="text-sm">A 6-max table with up to five opponents. You play your decisions, the bots play theirs, and after each hand you get a review of your decisions.</p>
          <p className="mt-1 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">🤖 Rule-based bot: plays sensibly, not perfectly. Each bot knows only its own cards and the public action. Multiway is where simple rules are weakest.</p>
          <Button variant="primary" className="mt-3 w-full min-h-14 text-lg" onClick={() => startSession({ ...setup, seed: (Math.random() * 1e9) | 0, heroCards: [], botCards: [[], [], [], [], []], board: [] })}>
            🎲 Random hands with these settings
          </Button>
        </Panel>
        <Panel title="Table">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Opponents</span>
              {[1, 2, 3, 4, 5].map((k) => (
                <Chip key={k} active={setup.opponents === k} onClick={() => setSetup({ ...setup, opponents: k, heroPos: 'random' })}>
                  {k}
                </Chip>
              ))}
              <span className="text-xs text-muted">({setup.opponents + 1}-handed: {list.join(', ')})</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Your seat</span>
              <Chip active={setup.heroPos === 'random'} onClick={() => setSetup({ ...setup, heroPos: 'random' })}>
                Random
              </Chip>
              {list.map((p) => (
                <Chip key={p} active={setup.heroPos === p} onClick={() => setSetup({ ...setup, heroPos: p })}>
                  {p}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Stacks</span>
              {[20, 50, 100, 200].map((x) => (
                <Chip key={x} active={setup.stack === x} onClick={() => setSetup({ ...setup, stack: x })}>
                  {x}bb
                </Chip>
              ))}
              <input type="number" min={2} max={1000} value={setup.stack} onChange={(e) => setSetup({ ...setup, stack: Math.max(2, Math.min(1000, +e.target.value || 100)) })} className="w-20 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm" aria-label="Custom stack" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={setup.rotate} onClick={() => setSetup({ ...setup, rotate: !setup.rotate })}>
                {setup.rotate ? '✓ ' : ''}Rotate the button each hand
              </Chip>
              <Chip active={setup.carryOver} onClick={() => setSetup({ ...setup, carryOver: !setup.carryOver })}>
                {setup.carryOver ? '✓ Stacks carry over' : 'Stacks reset each hand'}
              </Chip>
            </div>
          </div>
        </Panel>
        <Panel title="Opponents">
          <div className="mb-2 flex flex-wrap gap-2">
            <Button className="min-h-9" onClick={() => setSetup({ ...setup, styles: HOME_MIX.slice() })}>
              🏠 Home-game mix
            </Button>
            {Object.values(STYLES).map((x) => (
              <Button key={x.id} variant="ghost" className="min-h-9" onClick={() => setSetup({ ...setup, styles: setup.styles.map(() => x.id) })}>
                All {x.name.toLowerCase()}
              </Button>
            ))}
          </div>
          <p className="mb-2 text-xs text-muted">Home-game mix (a guess at a typical home game, not data): one calling station, one aggressive player, the rest solid — seated in that order as opponents are added.</p>
          <div className="space-y-2">
            {Array.from({ length: setup.opponents }, (_, i) => (
              <div key={i} className="rounded-lg bg-surface-2 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 text-sm font-semibold">Bot {i + 1}</span>
                  {Object.values(STYLES).map((x) => (
                    <Chip key={x.id} active={setup.styles[i] === x.id} onClick={() => setStyle(i, x.id)} className="text-xs">
                      {x.name}
                    </Chip>
                  ))}
                </div>
                <div className="mt-1">
                  <CardSetup label="Cards" value={setup.botCards[i]} max={2} used={usedBy(`bot${i}`)} onChange={(c) => setSetup({ ...setup, botCards: setup.botCards.map((y, j) => (j === i ? c : y)) })} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Cards & options">
          <div className="space-y-3">
            <CardSetup label="Your cards" value={setup.heroCards} max={2} used={usedBy('hero')} onChange={(c) => setSetup({ ...setup, heroCards: c })} />
            <CardSetup label="Board" value={setup.board} max={5} used={usedBy('board')} onChange={(c) => setSetup({ ...setup, board: c })} />
            <div className="flex flex-wrap gap-2">
              <Chip active={setup.autoSkip} onClick={() => setSetup({ ...setup, autoSkip: !setup.autoSkip })}>
                {setup.autoSkip ? '✓ ' : ''}Auto-skip when I'm out of the hand
              </Chip>
              <Chip active={setup.autoDeal} onClick={() => setSetup({ ...setup, autoDeal: !setup.autoDeal })}>
                {setup.autoDeal ? '✓ ' : ''}Auto-deal next hand
              </Chip>
              <Chip active={setup.actionTable} onClick={() => setSetup({ ...setup, actionTable: !setup.actionTable })}>
                {setup.actionTable ? '✓ ' : ''}Action table
              </Chip>
            </div>
            {setup.actionTable && <p className="text-xs text-muted">Training convenience, not realistic play: every bot's opening and calling ranges are widened ×{ACTION_TABLE_WIDEN} (by combos) so more hands reach the flop.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Bot delay</span>
              <input type="range" min={0} max={2000} step={100} value={setup.delay} onChange={(e) => setSetup({ ...setup, delay: +e.target.value })} aria-label="Bot delay" />
              <span className="text-xs text-muted">{setup.delay} ms</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted">Session seed</span>
              <input type="number" value={setup.seed} onChange={(e) => setSetup({ ...setup, seed: +e.target.value | 0 })} className="w-32 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm" />
            </div>
            <Button variant="primary" className="w-full" onClick={() => startSession(setup)}>
              ▶ Start this session
            </Button>
            {error && <p className="text-sm text-bad">{error}</p>}
          </div>
        </Panel>
        <Panel title="Saved setups">
          <div className="flex gap-2">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this setup" className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm" />
            <Button
              onClick={() => {
                const name = presetName.trim() || `Setup ${Object.keys(presets.play).length + 1}`;
                setPresets((p) => ({ ...p, play: { ...p.play, [name]: setup } }));
                setPresetName('');
              }}
            >
              Save
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(presets.play).map(([name, p]) => (
              <span key={name} className="flex items-center gap-1 rounded-full border border-line px-1">
                <button className="px-2 py-1 text-sm hover:text-accent" onClick={() => setSetup({ ...defaultSetup(settings.stackDepth), ...(p as Partial<Setup>) })}>
                  {name}
                </button>
                <button
                  className="px-1 text-xs text-muted hover:text-bad"
                  aria-label={`Delete ${name}`}
                  onClick={() =>
                    setPresets((x) => {
                      const play = { ...x.play };
                      delete play[name];
                      return { ...x, play };
                    })
                  }
                >
                  ✕
                </button>
              </span>
            ))}
            {!Object.keys(presets.play).length && <span className="text-xs text-muted">No saved setups yet (included in Settings → Export).</span>}
          </div>
        </Panel>
      </div>
    );
  }

  // ---------------- PLAYING ----------------
  if (phase === 'playing') {
    const L = mwLegal(st);
    const heroTurn = st.toAct === 0 && !thinking;
    const heroOut = st.folded[0] || st.stack[0] === 0;
    const sizes = heroTurn ? sizeButtons(st) : [];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Hand {handNo + 1} · {n}-handed · seed {st.cfg.seed}
          </span>
          <button className="text-info hover:underline" onClick={() => setPhase('setup')}>
            Setup
          </button>
        </div>
        <TableView st={st} styles={setup.styles} reveal={false} live />
        <div className="min-h-6 text-center text-sm text-muted">{st.toAct !== null && st.toAct !== 0 ? `🤖 ${playerName(st.toAct)} is thinking…` : heroTurn ? 'Your turn' : ''}</div>
        {heroOut && !skip && (
          <Button className="w-full" onClick={() => setSkip(true)}>
            ⏩ Skip to result
          </Button>
        )}
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
                  {L.call * 100 >= st.stack[0] ? ' (all-in)' : ''}
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
          <ol className="space-y-0.5 text-sm text-muted">
            {st.history.map((a, i) => (
              <li key={i}>
                {MW_STREETS[a.street]}: {playerName(a.seat)} ({st.cfg.positions[a.seat]}) {a.type === 'bet' || a.type === 'raise' ? `${a.type} to ${a.amount}` : a.type === 'call' ? `call ${a.amount}` : a.type}
                {a.allIn ? ' (all-in)' : ''}
              </li>
            ))}
            {!st.history.length && <li>Blinds posted.</li>}
          </ol>
        </Panel>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    );
  }

  return <Review {...{ snaps, setup, heroDecs, botRecs, reviews, handNo, nextHand, restart: () => deal(setup, handNo, heroStart, stacks), branch, toSetup: () => setPhase('setup') }} />;
}

function Review({
  snaps,
  setup,
  heroDecs,
  botRecs,
  reviews,
  handNo,
  nextHand,
  restart,
  branch,
  toSetup,
}: {
  snaps: MWState[];
  setup: Setup;
  heroDecs: HeroDecision[];
  botRecs: BotRec[];
  reviews: (HeroReview & { players: number })[] | null;
  handNo: number;
  nextHand: () => void;
  restart: () => void;
  branch: (d: HeroDecision) => void;
  toSetup: () => void;
}) {
  const [s] = useSettings();
  const final = snaps[snaps.length - 1];
  const r = final.result!;
  const [viewIdx, setViewIdx] = useState(snaps.length - 1);
  const [reveal, setReveal] = useState(r.reason === 'showdown');
  const [openBot, setOpenBot] = useState<number | null>(null);
  const [oppTab, setOppTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const view = snaps[Math.min(viewIdx, snaps.length - 1)];
  const live = final.folded.map((f, i) => (!f ? i : -1)).filter((i) => i >= 0);
  // all-in runout equities: from the street of the last voluntary action
  const allInStreet = r.reason === 'showdown' && final.history.length ? final.history[final.history.length - 1].street : null;
  const [runout, setRunout] = useState<{ street: number; board: Card[]; eq: number[] | null }[]>([]);
  useEffect(() => {
    if (allInStreet === null || allInStreet >= 3) return;
    const stages = [] as { street: number; board: Card[]; eq: number[] | null }[];
    for (let k2 = allInStreet; k2 <= 3; k2++) stages.push({ street: k2, board: final.boardAll.slice(0, k2 === 0 ? 0 : k2 === 1 ? 3 : k2 === 2 ? 4 : 5), eq: null });
    setRunout(stages);
    stages.forEach((sg, i) =>
      computeHandsEquity(
        live.map((p) => final.holes[p]),
        sg.board,
        11 + i,
      ).then((m) => setRunout((x) => x.map((y, j) => (j === i ? { ...y, eq: m.equity } : y)))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final]);
  const heroNet = r.net[0];
  const hh = useMemo(() => handHistory(final, setup.styles, handNo, setup.seed), [final, setup.styles, handNo, setup.seed]);
  const outcome = r.reason === 'fold' ? (r.pots[0].winners[0] === 0 ? 'Everyone folded — you win the pot' : `${playerName(r.pots[0].winners[0])} wins (everyone else folded)`) : `Showdown — ${r.pots.map((p, i) => `${i === 0 ? 'main' : `side ${i}`}: ${p.winners.map(playerName).join(' & ')}`).join(' · ')}`;

  return (
    <div className="space-y-3">
      <Panel title={`Hand ${handNo + 1} over (${final.n}-handed)`}>
        <div className="text-lg font-bold">{outcome}</div>
        <div className="text-sm">
          You: <b style={{ color: heroNet >= 0 ? 'var(--good)' : 'var(--bad)' }}>{heroNet >= 0 ? '+' : ''}{fmtAmount(heroNet, s)}</b>
          {r.returned.length > 0 && <span className="text-muted"> · uncalled returned: {r.returned.map((x) => `${fmtAmount(x.amount, s)} to ${playerName(x.seat)}`).join(', ')}</span>}
        </div>
        {r.pots.length > 1 && (
          <ul className="mt-1 text-xs text-muted">
            {r.pots.map((p, i) => (
              <li key={i}>
                {i === 0 ? 'Main pot' : `Side pot ${i}`} {fmtAmount(p.amount, s)} — eligible {p.eligible.map(playerName).join(', ')} → {p.winners.map(playerName).join(' & ')}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted">Results are luck in the short run; the grades below judge your decisions by the math available at the time.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={nextHand}>
            ▶ Deal next hand{setup.carryOver ? ' (stacks carry over)' : ''}
          </Button>
          <Button onClick={restart}>↺ Replay this hand</Button>
          <Button onClick={toSetup}>Setup</Button>
          <Button variant="ghost" onClick={() => setReveal(!reveal)}>
            {reveal ? 'Hide' : 'Reveal'} all hands
          </Button>
        </div>
        {setup.autoDeal && <p className="mt-1 text-xs text-muted">Auto-deal is on: the next hand starts in a moment.</p>}
      </Panel>

      {runout.length > 0 && (
        <Panel title="All-in runout — equity before each street" right={<KindBadge kind="math" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-muted">
                <tr>
                  <th className="py-1 pr-2">Street</th>
                  {live.map((p) => (
                    <th key={p} className="py-1 pr-2 text-right">
                      {playerName(p)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runout.map((x) => (
                  <tr key={x.street} className="border-t border-line">
                    <td className="py-1.5 pr-2 capitalize">
                      {MW_STREETS[x.street]} {x.board.length ? <CardText cards={x.board} /> : ''}
                    </td>
                    {live.map((p, i) => (
                      <td key={p} className="tabular py-1.5 pr-2 text-right">
                        {x.eq ? pct(x.eq[i]) : '…'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">All live hands known; exact enumeration of the remaining cards where feasible, otherwise ≈ Monte Carlo.</p>
        </Panel>
      )}

      <Panel title="Step through the hand">
        <TableView st={view} styles={setup.styles} reveal={reveal} live={false} />
        <div className="mt-2 flex items-center gap-2">
          <Button className="min-h-9" onClick={() => setViewIdx(Math.max(0, viewIdx - 1))} disabled={viewIdx === 0}>
            ◀
          </Button>
          <input type="range" min={0} max={snaps.length - 1} value={viewIdx} onChange={(e) => setViewIdx(+e.target.value)} className="flex-1" aria-label="Step" />
          <Button className="min-h-9" onClick={() => setViewIdx(Math.min(snaps.length - 1, viewIdx + 1))} disabled={viewIdx >= snaps.length - 1}>
            ▶
          </Button>
        </div>
      </Panel>

      <Panel title="Your decisions" right={<span className="text-xs text-muted">judged by the math, not the result</span>}>
        {!reviews && heroDecs.length > 0 && <p className="text-sm text-muted">Calculating…</p>}
        {!heroDecs.length && <p className="text-sm text-muted">You made no decisions this hand.</p>}
        <div className="space-y-3">
          {reviews?.map((rv, i) => {
            const v = VERDICT_UI[rv.verdict];
            return (
              <div key={i} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold capitalize">
                    {MW_STREETS[rv.street]}: {rv.action} <span className="text-xs font-normal text-muted">({rv.players}-way)</span>
                  </div>
                  <span style={{ color: v.color }} className="font-semibold">
                    {v.icon} {v.label}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {rv.equity !== undefined && <Stat label="Your equity" value={`≈${pct(rv.equity)}`} sub={rv.players > 2 ? 'vs combined ranges' : 'vs the stated range'} tone="good" />}
                  {rv.required !== undefined && <Stat label="Required" value={pct(rv.required)} sub="call ÷ final pot" tone="ok" />}
                  {rv.hindsight !== undefined && <Stat label="With hindsight" value={pct(rv.hindsight)} sub="vs all actual hands — you couldn't know this" />}
                  {rv.players > 2 && <Stat label="Value threshold" value={pct(valueThreshold(rv.players - 1))} sub={`fair share ${pct(fairShare(rv.players - 1))}`} />}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {rv.bullets.map((b, k) => (
                    <li key={k}>{b}</li>
                  ))}
                </ul>
                <div className="mt-1 text-xs text-muted">
                  Basis: {rv.basis === 'chart' ? `cited chart (${rv.chartTitle})` : rv.basis === 'equity' ? 'equity vs price' : rv.basis === 'value-rule' ? 'value rule' : 'not graded'} · Ranges: {rv.rangeLabel}
                </div>
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

      <Panel title="Bot reasoning log" right={<span className="text-xs text-muted">only after the hand</span>}>
        <div className="space-y-2">
          {botRecs.map((b, i) => (
            <div key={i} className="rounded-xl bg-surface-2">
              <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm" onClick={() => { setOpenBot(openBot === i ? null : i); setOppTab(0); }}>
                <span>
                  <span className="capitalize">{MW_STREETS[b.log.street]}</span>: {playerName(b.player)} ({final.cfg.positions[b.player]}) <b>{b.log.action}</b> {b.log.heuristic && <span className="text-[10px] text-muted">· heuristic</span>}
                </span>
                <span className="text-xs text-muted">{openBot === i ? '▲' : '▼'}</span>
              </button>
              {openBot === i && (
                <div className="space-y-2 px-3 pb-3 text-sm">
                  <div>
                    <b>Rule:</b> {b.log.rule} <span className="text-xs text-muted">({b.log.heuristic ? 'heuristic' : 'chart / pot-odds math'})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {b.log.hand && <Stat label="Its hand" value={<span className="text-sm">{b.log.hand}</span>} />}
                    {b.log.bucket && <Stat label="Bucket" value={b.log.bucket} />}
                    {b.log.equity !== undefined && <Stat label="Its equity" value={`≈${pct(b.log.equity)}`} sub={`vs ${b.log.opponents.length} opponent range${b.log.opponents.length > 1 ? 's' : ''}`} />}
                    {b.log.required !== undefined && <Stat label="Price" value={pct(b.log.required)} />}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {b.log.opponents.map((o, j) => (
                      <Chip key={o.seat} active={oppTab === j} onClick={() => setOppTab(j)} className="text-xs">
                        Its estimate of {playerName(o.seat)} ({o.pos}) · ~{o.combos}
                      </Chip>
                    ))}
                  </div>
                  {b.log.opponents[oppTab] && (
                    <>
                      <RangeGrid
                        compact
                        paint={(cls) => {
                          const w = new Map(b.log.opponents[oppTab].grid).get(cls) ?? 0;
                          return { segments: [{ color: w > 0 ? `color-mix(in srgb, var(--series-1) ${Math.round(15 + w * 85)}%, var(--act-fold))` : 'var(--act-fold)', weight: 1 }], title: `${cls}: ${Math.round(w * 100)}%` };
                        }}
                      />
                      <Legend items={[{ color: 'var(--series-1)', label: 'likely' }, { color: 'var(--act-fold)', label: 'unlikely / impossible' }]} />
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <details className="mt-3 text-xs text-muted">
          <summary className="text-info">How the bots estimate ranges and adjust for multiway pots</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {RANGE_RULES.preflop.map((x) => (
              <li key={x}>{x}</li>
            ))}
            <li>{RANGE_RULES.postflop}</li>
            <li>Multiway: equity vs all remaining ranges together; value threshold = fair share × (1.5 + 0.15 per extra opponent); bluffs × 0.5 per extra opponent; +3 equity points needed per player still to act behind (heuristics).</li>
          </ul>
        </details>
      </Panel>

      <Panel title="Hand history">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs">{hh}</pre>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => navigator.clipboard?.writeText(hh).then(() => setCopied(true), () => setCopied(false))}>{copied ? 'Copied ✓' : 'Copy text'}</Button>
          <Button
            onClick={() => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([hh], { type: 'text/plain' }));
              a.download = `hand-${final.cfg.seed}.txt`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download .txt
          </Button>
        </div>
      </Panel>
      {final.result?.hands && reveal && (
        <p className="px-1 text-xs text-muted">
          Hands: {live.map((p) => `${playerName(p)} ${cardsToString(final.holes[p])} (${describeHand(final.result!.hands![p]!)})`).join(' · ')}
        </p>
      )}
    </div>
  );
}
