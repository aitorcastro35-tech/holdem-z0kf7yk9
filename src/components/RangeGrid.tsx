import { gridLabel } from '../engine/range';
import type { Action } from '../data/charts';
import { cx } from './ui';

export const ACTION_COLOR: Record<Action, string> = {
  raise: 'var(--act-raise)',
  threebet: 'var(--act-3bet)',
  call: 'var(--act-call)',
  limp: 'var(--act-limp)',
  fold: 'var(--act-fold)',
};
export const ACTION_LABEL: Record<Action, string> = {
  raise: 'Raise',
  threebet: '3-bet',
  call: 'Call',
  limp: 'Limp / complete',
  fold: 'Fold',
};

export interface CellPaint {
  /** One or more colour segments (split cell for mixed strategies), each with a weight. */
  segments: { color: string; weight: number }[];
  title?: string;
}

export function RangeGrid({
  paint,
  onSelect,
  selected,
  compact,
}: {
  paint: (cls: string) => CellPaint;
  onSelect?: (cls: string) => void;
  selected?: string;
  compact?: boolean;
}) {
  return (
    <div className="mx-auto grid w-full max-w-[560px] select-none gap-px rounded-lg bg-line p-px" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
      {Array.from({ length: 169 }, (_, i) => {
        const row = Math.floor(i / 13);
        const col = i % 13;
        const cls = gridLabel(row, col);
        const p = paint(cls);
        const total = p.segments.reduce((s, x) => s + x.weight, 0) || 1;
        let acc = 0;
        const stops = p.segments
          .map((s) => {
            const a = (acc / total) * 100;
            acc += s.weight;
            const b = (acc / total) * 100;
            return `${s.color} ${a}% ${b}%`;
          })
          .join(', ');
        const lightBg = p.segments.length === 1 && p.segments[0].color === 'var(--act-fold)';
        return (
          <button
            key={cls}
            onClick={() => onSelect?.(cls)}
            title={p.title ?? cls}
            className={cx(
              'relative flex aspect-square items-center justify-center overflow-hidden rounded-[3px] font-semibold leading-none',
              compact ? 'text-[7px] sm:text-[9px]' : 'text-[8px] sm:text-[11px]',
              selected === cls && 'ring-2 ring-fg z-10',
            )}
            style={{ background: `linear-gradient(90deg, ${stops})`, color: lightBg ? 'var(--muted)' : '#fff' }}
          >
            <span className={cx(!lightBg && 'drop-shadow-[0_1px_1px_rgba(0,0,0,.6)]')}>{cls.length === 3 ? cls.slice(0, 2) + cls[2] : cls}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-line" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
