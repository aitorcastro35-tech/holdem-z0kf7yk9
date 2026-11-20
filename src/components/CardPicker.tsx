import { type Card, makeCard, RANKS, SUIT_SYMBOLS } from '../engine/cards';
import { cx } from './ui';

/** Compact 4×13 deck picker. Cards in `used` (other slots) are disabled. */
export function CardPicker({ value, max, used, onChange }: { value: Card[]; max: number; used: Card[]; onChange: (c: Card[]) => void }) {
  const toggle = (c: Card) => {
    if (value.includes(c)) onChange(value.filter((x) => x !== c));
    else if (value.length < max) onChange([...value, c]);
  };
  return (
    <div className="space-y-1">
      {[0, 1, 2, 3].map((s) => (
        <div key={s} className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(13, minmax(0,1fr))' }}>
          {Array.from({ length: 13 }, (_, i) => 12 - i).map((r) => {
            const c = makeCard(r, s);
            const sel = value.includes(c);
            const dis = !sel && (used.includes(c) || value.length >= max);
            return (
              <button
                key={c}
                disabled={used.includes(c) && !sel}
                onClick={() => toggle(c)}
                className={cx(
                  'h-8 rounded text-[11px] font-bold sm:text-xs',
                  sel ? 'ring-2 ring-accent' : '',
                  dis ? 'opacity-30' : '',
                )}
                style={{ background: sel ? 'var(--card-bg)' : 'var(--surface-2)', color: s === 0 ? (sel ? '#111' : 'var(--fg)') : `var(--suit-${'shdc'[s]})` }}
              >
                {RANKS[r]}
                {SUIT_SYMBOLS[s]}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
