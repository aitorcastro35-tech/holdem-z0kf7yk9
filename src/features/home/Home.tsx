import { useMemo, useState } from 'react';
import { useProgress, useFlash, streak, weakConcepts, dayKey } from '../../store/progress';
import { useSettings } from '../../store/settings';
import { HandSession, type SessionResult } from '../train/HandSession';
import { FlashSession } from '../flashcards/FlashSession';
import { pickCards, DECK } from '../flashcards/Flashcards';
import { findLeaks } from '../progress/leaks';
import { conceptById } from '../../data/concepts';
import { Panel, Button, Stat } from '../../components/ui';
import { go } from '../../router';
import type { Flashcard } from '../flashcards/deck';

type Phase = { k: 'idle' } | { k: 'hands'; focus: string[] } | { k: 'cards'; hands: SessionResult; cards: Flashcard[] } | { k: 'done'; hands: SessionResult; cards: [number, number] };

export default function Home(_props: { mode?: string }) {
  const [progress] = useProgress();
  const [flash] = useFlash();
  const [settings] = useSettings();
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const weak = useMemo(() => weakConcepts(progress.answers), [progress.answers]);
  const leaks = useMemo(() => findLeaks(progress.answers), [progress.answers]);
  const s = streak(progress.activeDays);
  const playedToday = progress.activeDays.includes(dayKey(Date.now()));
  const due = DECK.filter((c) => flash.cards[c.id] && flash.cards[c.id].due <= Date.now()).length;

  if (phase.k === 'hands')
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted">Daily drill · part 1 of 2: hands</div>
        <HandSession mode="mixed" count={10} focus={phase.focus} onDone={(r) => setPhase({ k: 'cards', hands: r, cards: pickCards(flash, 10, { concepts: weak }) })} />
      </div>
    );
  if (phase.k === 'cards')
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted">Daily drill · part 2 of 2: flashcards</div>
        <FlashSession cards={phase.cards} title="Daily drill" onDone={(c, n) => setPhase({ k: 'done', hands: phase.hands, cards: [c, n] })} />
      </div>
    );

  return (
    <div className="space-y-3">
      {phase.k === 'done' && (
        <Panel className="border-accent" title="Drill complete 🎉">
          <p className="text-sm">
            Hands: ✅ {phase.hands.best} · 🟡 {phase.hands.ok} · ❌ {phase.hands.mistake} — Flashcards: {phase.cards[0]}/{phase.cards[1]}
          </p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => go('progress')}>See stats</Button>
            {phase.hands.mistake > 0 && <Button onClick={() => go('train/review')}>Review mistakes</Button>}
          </div>
        </Panel>
      )}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">{playedToday ? 'Nice — keep it going' : "Today's drill"}</div>
            <div className="text-sm text-muted">10 hands + 10 flashcards, weighted toward your weak spots. About 10–15 minutes.</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{s} 🔥</div>
            <div className="text-xs text-muted">day streak</div>
          </div>
        </div>
        <Button variant="primary" className="mt-4 w-full min-h-14 text-lg" onClick={() => setPhase({ k: 'hands', focus: weak })}>
          ▶ Start daily drill
        </Button>
        {weak.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Focusing on: {weak.slice(0, 3).map((c) => conceptById(c)?.title ?? c).join(', ')}
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Table" value={settings.tableSize === 6 ? '6-max' : '9-max'} />
        <Stat label="Cards due" value={due} />
        <Stat label="Hands played" value={progress.answers.filter((a) => a.kind === 'hand').length} />
      </div>

      {leaks.length > 0 && (
        <Panel title="Your top leak">
          <div className="font-semibold">⚠️ {leaks[0].message}</div>
          <div className="text-xs text-muted">{leaks[0].detail}</div>
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" className="sm:col-span-2" onClick={() => go('train/hand')}>
          🃏 Play a full hand (flop → river)
        </Button>
        <Button onClick={() => go('play')}>♣ Play a hand vs the bot</Button>
        <Button onClick={() => go('explorer')}>▦ Range Explorer</Button>
        <Button onClick={() => go('train/A')}>♠ Your move</Button>
        <Button onClick={() => go('train/B')}>♥ Facing action</Button>
        <Button onClick={() => go('flashcards')}>▤ Flashcards</Button>
        <Button onClick={() => go('reference/grid')}>☰ Preflop charts</Button>
      </div>
      <p className="px-1 text-xs text-muted">
        Every number in this app is computed by its own tested engine or comes from a cited source (tap "ⓘ Source"). Labels show what kind of information you're looking at:
        math fact, theory baseline, or practical advice.
      </p>
    </div>
  );
}
