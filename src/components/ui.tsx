import { useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { type Card, rankOf, suitOf, RANKS, SUIT_SYMBOLS } from '../engine/cards';
import { SOURCES } from '../data/charts';
import { REFS } from '../data/refs';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Panel({ children, className, title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface p-4', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const v: Record<Variant, string> = {
    primary: 'bg-accent text-accent-fg font-semibold hover:brightness-110',
    secondary: 'bg-surface-2 text-fg border border-line hover:brightness-110',
    ghost: 'text-muted hover:text-fg',
    danger: 'bg-bad text-white font-semibold',
  };
  return <button {...p} className={cx('min-h-11 rounded-xl px-4 py-2 text-sm transition', v[variant], className)} />;
}

export function Chip({ active, children, onClick, className }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'min-h-9 rounded-full border px-3 py-1 text-sm transition',
        active ? 'border-accent bg-accent text-accent-fg font-semibold' : 'border-line bg-surface-2 text-fg hover:brightness-110',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PlayingCard({ card, size = 'md', faceDown }: { card?: Card; size?: 'sm' | 'md' | 'lg'; faceDown?: boolean }) {
  const dims = { sm: 'w-8 h-11 text-base', md: 'w-12 h-16 text-xl', lg: 'w-16 h-22 text-3xl' }[size];
  if (faceDown || card === undefined)
    return (
      <div
        className={cx(dims, 'rounded-lg border border-white/20 shadow')}
        style={{ background: 'repeating-linear-gradient(45deg,#2d5b8a,#2d5b8a 4px,#24496f 4px,#24496f 8px)' }}
        aria-label="face-down card"
      />
    );
  const s = suitOf(card);
  const color = ['var(--suit-s)', 'var(--suit-h)', 'var(--suit-d)', 'var(--suit-c)'][s];
  const rank = RANKS[rankOf(card)] === 'T' ? '10' : RANKS[rankOf(card)];
  return (
    <div
      className={cx(dims, 'flex flex-col items-center justify-center rounded-lg font-bold leading-none shadow-md select-none')}
      style={{ background: 'var(--card-bg)', color, border: '1px solid rgba(0,0,0,.15)' }}
      aria-label={`${rank} of ${['spades', 'hearts', 'diamonds', 'clubs'][s]}`}
    >
      <span>{rank}</span>
      <span className="text-[0.85em]">{SUIT_SYMBOLS[s]}</span>
    </div>
  );
}

export function Cards({ cards, size, placeholders = 0 }: { cards: Card[]; size?: 'sm' | 'md' | 'lg'; placeholders?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} />
      ))}
      {Array.from({ length: Math.max(0, placeholders - cards.length) }).map((_, i) => (
        <div key={'p' + i} className={cx(size === 'sm' ? 'w-8 h-11' : size === 'lg' ? 'w-16 h-22' : 'w-12 h-16', 'rounded-lg border border-dashed border-white/25')} />
      ))}
    </div>
  );
}

/** Inline coloured card text like "A♠ K♥". */
export function CardText({ cards }: { cards: Card[] }) {
  return (
    <span className="whitespace-nowrap font-semibold">
      {cards.map((c, i) => (
        <span key={c}>
          <SuitColored card={c} />
          {i < cards.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

function SuitColored({ card }: { card: Card }) {
  const s = suitOf(card);
  // In dark mode spade/club black would be invisible on dark backgrounds → use fg for spades, deck colour otherwise.
  const color = s === 0 ? 'var(--fg)' : s === 3 ? 'color-mix(in srgb, var(--suit-c) 70%, var(--fg))' : `var(--suit-${'shdc'[s]})`;
  return (
    <span style={{ color }}>
      {RANKS[rankOf(card)]}
      {SUIT_SYMBOLS[s]}
    </span>
  );
}

export type InfoKind = 'math' | 'theory' | 'exploit';
const KIND_LABEL: Record<InfoKind, [string, string]> = {
  math: ['Math fact', 'Computed exactly by this app (enumeration / combinatorics), cross-checked against published values.'],
  theory: ['Theory baseline', 'From published charts or theory. A model with stated assumptions, not a law of nature.'],
  exploit: ['Practical advice', 'Exploitative, experience-based advice for loose low-stakes games. Not math; use judgement.'],
};
export function KindBadge({ kind }: { kind: InfoKind }) {
  const color = { math: 'var(--info)', theory: 'var(--ok)', exploit: 'var(--act-3bet)' }[kind];
  return (
    <span
      title={KIND_LABEL[kind][1]}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color, borderColor: color }}
    >
      {KIND_LABEL[kind][0]}
    </span>
  );
}

/** "ⓘ Source" link with a popover listing the reference(s). */
export function SourceLink({ ids, extra }: { ids: string[]; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const refs = ids.map((id) => SOURCES[id] ?? REFS[id]).filter(Boolean);
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className="text-xs text-info underline-offset-2 hover:underline" aria-expanded={open}>
        ⓘ Source
      </button>
      {open && (
        <span className="absolute right-0 z-30 mt-1 block w-72 max-w-[80vw] rounded-xl border border-line bg-surface-2 p-3 text-left text-xs shadow-xl">
          {refs.map((r) => (
            <span key={r.id} className="mb-2 block">
              <a className="font-semibold text-info hover:underline" href={r.url} target="_blank" rel="noreferrer">
                {r.name}
              </a>
              <span className="block text-muted">Checked {r.checked}</span>
            </span>
          ))}
          {extra && <span className="block text-muted">{extra}</span>}
          <button className="mt-1 text-muted hover:text-fg" onClick={() => setOpen(false)}>
            Close
          </button>
        </span>
      )}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'ok' }) {
  const c = tone ? `var(--${tone})` : undefined;
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular text-lg font-semibold" style={{ color: c }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
