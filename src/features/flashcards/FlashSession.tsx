import { useEffect, useMemo, useRef, useState } from 'react';
import { type Flashcard, percentChoices, checkTyped, answerText, TOPIC_LABEL } from './deck';
import { nextCardState, recordAnswer, type FlashState, EMPTY_FLASH } from '../../store/progress';
import { save, load } from '../../store/storage';
import { Panel, Button, Chip, KindBadge, cx } from '../../components/ui';
import { go } from '../../router';
import { conceptById } from '../../data/concepts';

export type AnswerStyle = 'type' | 'choice';

export function FlashSession({ cards, onDone, title }: { cards: Flashcard[]; onDone: (correct: number, total: number) => void; title?: string }) {
  const [i, setI] = useState(0);
  const [style, setStyle] = useState<AnswerStyle>('choice');
  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const card = cards[i];

  const choices = useMemo(() => {
    if (!card) return null;
    if (card.answer.type === 'choice') return { options: card.answer.options, correct: card.answer.correct, shuffle: true };
    if (style === 'choice' && card.answer.type === 'percent') return { ...percentChoices(card), shuffle: false };
    return null;
  }, [card, style]);

  // Shuffle fixed-answer choice cards so the correct one isn't always first.
  const order = useMemo(() => {
    if (!choices) return [];
    const idx = choices.options.map((_, k) => k);
    if (!choices.shuffle) return idx;
    const seed = [...(card?.id ?? '')].reduce((s, ch) => s + ch.charCodeAt(0), i);
    return idx.sort((a, b) => ((a * 7 + seed) % 5) - ((b * 7 + seed) % 5));
  }, [choices, card, i]);

  useEffect(() => {
    if (!choices && result === null) inputRef.current?.focus();
  }, [choices, result, i]);

  const submit = (correct: boolean) => {
    setResult(correct);
    if (correct) setScore((s) => s + 1);
    const fs = load<FlashState>('flashcards', EMPTY_FLASH);
    save<FlashState>('flashcards', { cards: { ...fs.cards, [card.id]: nextCardState(fs.cards[card.id], correct) } });
    recordAnswer({
      t: Date.now(),
      kind: 'card',
      id: card.id,
      concepts: [card.concept],
      tags: [card.topic],
      grade: correct ? 'best' : 'mistake',
      summary: card.prompt,
    });
  };

  const next = () => {
    if (i + 1 >= cards.length) onDone(score, cards.length);
    else {
      setI(i + 1);
      setInput('');
      setPicked(null);
      setResult(null);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && e.key !== 'Enter') return;
      if (result !== null && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        next();
      } else if (result === null && choices && /^[1-4]$/.test(e.key)) {
        const k = order[parseInt(e.key) - 1];
        if (k !== undefined) {
          setPicked(k);
          submit(k === choices.correct);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!card) return null;
  const concept = conceptById(card.concept);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2 text-sm text-muted">
          {title ?? 'Flashcards'} · {i + 1}/{cards.length} · {TOPIC_LABEL[card.topic]}
        </span>
      }
      right={<KindBadge kind="math" />}
    >
      <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2">
        <div className="h-full bg-accent transition-all" style={{ width: `${(i / cards.length) * 100}%` }} />
      </div>
      <p className="mt-4 text-lg font-semibold leading-snug">{card.prompt}</p>

      {card.answer.type === 'percent' && result === null && (
        <div className="mt-3 flex gap-2">
          <Chip active={style === 'choice'} onClick={() => setStyle('choice')}>
            Multiple choice
          </Chip>
          <Chip active={style === 'type'} onClick={() => setStyle('type')}>
            Type the %
          </Chip>
        </div>
      )}

      {choices ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {order.map((k, n) => {
            const isCorrect = k === choices.correct;
            const state = result === null ? '' : isCorrect ? 'border-good bg-good/15' : picked === k ? 'border-bad bg-bad/15' : 'opacity-60';
            return (
              <button
                key={k}
                disabled={result !== null}
                onClick={() => {
                  setPicked(k);
                  submit(isCorrect);
                }}
                className={cx('min-h-12 rounded-xl border border-line bg-surface-2 px-4 py-2 text-left text-sm transition hover:brightness-110', state)}
              >
                <span className="mr-2 hidden text-xs text-muted sm:inline">{n + 1}</span>
                {choices.options[k]}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (result === null && input.trim()) submit(checkTyped(card, input));
            else if (result !== null) next();
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={result !== null}
            inputMode="decimal"
            placeholder={card.answer.type === 'percent' ? 'e.g. 35' : 'number'}
            className="w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-lg"
          />
          {result === null && (
            <Button variant="primary" type="submit">
              Check
            </Button>
          )}
        </form>
      )}

      {result !== null && (
        <div className={cx('mt-4 rounded-xl border p-3', result ? 'border-good bg-good/10' : 'border-bad bg-bad/10')}>
          <div className="font-semibold">{result ? '✅ Correct' : '❌ Not quite'} — answer: {answerText(card)}</div>
          {card.answer.type === 'percent' && <div className="text-xs text-muted">Accepted within ±{card.answer.tol} points.</div>}
          <p className="mt-1 text-sm">{card.explain}</p>
          {concept && (
            <button className="mt-2 text-xs text-info hover:underline" onClick={() => go(`reference/concepts?focus=${concept.id}`)}>
              Concept: {concept.title} →
            </button>
          )}
          <Button variant="primary" className="mt-3 w-full" onClick={next}>
            {i + 1 >= cards.length ? 'Finish' : 'Next'} <span className="ml-1 hidden text-xs opacity-70 sm:inline">(Space)</span>
          </Button>
        </div>
      )}
    </Panel>
  );
}
