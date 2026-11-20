import { useMemo, useState } from 'react';
import { buildDeck, TOPIC_LABEL, type Flashcard, type Topic } from './deck';
import { FlashSession } from './FlashSession';
import { useFlash, type FlashState } from '../../store/progress';
import { Panel, Button, Stat } from '../../components/ui';
import { go } from '../../router';
import { shuffle } from '../../engine/cards';

export const DECK = buildDeck();

/** Pick n cards: due first (oldest due), then unseen, then lowest box. */
export function pickCards(flash: FlashState, n: number, opts: { topic?: Topic; concepts?: string[]; now?: number } = {}): Flashcard[] {
  const now = opts.now ?? Date.now();
  let pool = DECK.filter((c) => !opts.topic || c.topic === opts.topic);
  if (opts.concepts?.length) {
    const weak = shuffle(pool.filter((c) => opts.concepts!.includes(c.concept)));
    const rest = pool.filter((c) => !opts.concepts!.includes(c.concept));
    pool = [...weak.slice(0, Math.ceil(n / 2)), ...rest];
  }
  const due = pool.filter((c) => flash.cards[c.id] && flash.cards[c.id].due <= now).sort((a, b) => flash.cards[a.id].due - flash.cards[b.id].due);
  const unseen = shuffle(pool.filter((c) => !flash.cards[c.id]));
  const later = shuffle(pool.filter((c) => flash.cards[c.id] && flash.cards[c.id].due > now)).sort((a, b) => flash.cards[a.id].box - flash.cards[b.id].box);
  const out: Flashcard[] = [];
  for (const c of [...due, ...unseen, ...later]) if (!out.includes(c) && out.length < n) out.push(c);
  return shuffle(out);
}

export default function Flashcards(_props: { mode?: string }) {
  const [flash] = useFlash();
  const [session, setSession] = useState<{ cards: Flashcard[]; title: string } | null>(null);
  const [done, setDone] = useState<{ c: number; n: number } | null>(null);
  const stats = useMemo(() => {
    const now = Date.now();
    const seen = DECK.filter((c) => flash.cards[c.id]);
    const due = seen.filter((c) => flash.cards[c.id].due <= now).length;
    const mastered = seen.filter((c) => flash.cards[c.id].box >= 4).length;
    const boxes = [1, 2, 3, 4, 5].map((b) => seen.filter((c) => flash.cards[c.id].box === b).length);
    return { seen: seen.length, due, mastered, boxes };
  }, [flash]);

  if (session)
    return (
      <FlashSession
        key={session.title + session.cards.map((c) => c.id).join()}
        cards={session.cards}
        title={session.title}
        onDone={(c, n) => {
          setSession(null);
          setDone({ c, n });
        }}
      />
    );

  const start = (cards: Flashcard[], title: string) => {
    setDone(null);
    if (cards.length) setSession({ cards, title });
  };

  return (
    <div className="space-y-3">
      {done && (
        <Panel className="border-accent">
          <div className="text-lg font-semibold">
            Session done: {done.c}/{done.n} correct ({Math.round((done.c / done.n) * 100)}%)
          </div>
          <p className="text-sm text-muted">Missed cards come back in a few minutes; correct ones move up a box and return later.</p>
        </Panel>
      )}
      <Panel title="Flashcards: odds & concepts">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Due now" value={stats.due} />
          <Stat label="Seen" value={`${stats.seen}/${DECK.length}`} />
          <Stat label="Mastered" value={stats.mastered} sub="box 4–5" />
        </div>
        <div className="mt-3 flex items-end gap-1" aria-label="Leitner boxes">
          {stats.boxes.map((n, k) => (
            <div key={k} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-accent/70" style={{ height: `${Math.max(4, Math.min(60, n * 4))}px` }} />
              <div className="text-[11px] text-muted">
                Box {k + 1}: {n}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="primary" onClick={() => start(pickCards(flash, 20), 'Quick 20')}>
            ⚡ Quick 20
          </Button>
          <Button onClick={() => start(pickCards(flash, Math.max(1, Math.min(30, stats.due))), 'Due review')} disabled={stats.due === 0}>
            Review due cards ({stats.due})
          </Button>
        </div>
      </Panel>
      <Panel title="Practice a topic">
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TOPIC_LABEL) as Topic[]).map((t) => (
            <Button key={t} onClick={() => start(pickCards(flash, 10, { topic: t }), TOPIC_LABEL[t])} className="flex justify-between text-left">
              {TOPIC_LABEL[t]} <span className="text-xs text-muted">({DECK.filter((c) => c.topic === t).length})</span>
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          Spaced repetition (Leitner): a correct answer moves the card up a box (reviewed after 0/1/3/7/16 days), a miss sends it back to box 1. All answers are computed by the
          app's tested engine.{' '}
          <button className="text-info hover:underline" onClick={() => go('reference/odds')}>
            See the full odds tables →
          </button>
        </p>
      </Panel>
    </div>
  );
}
