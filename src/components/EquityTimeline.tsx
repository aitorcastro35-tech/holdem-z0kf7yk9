import { useState } from 'react';

export interface TimelinePoint {
  label: string; // "Preflop", "Flop", ...
  vsRange?: number; // 0..1
  vsHand?: number; // 0..1, revealed at the end
  required?: number; // price at the decision, 0..1
  approx?: boolean; // vsRange is a Monte Carlo estimate
}

const W = 360;
const H = 170;
const PAD = { l: 34, r: 50, t: 12, b: 24 };

/** Line chart of hero equity street by street, with the price of each call as a reference tick. */
export function EquityTimeline({ points, showHand }: { points: TimelinePoint[]; showHand: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(points.length, 4);
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (n - 1);
  const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const path = (key: 'vsRange' | 'vsHand') =>
    points
      .map((p, i) => [i, p[key]] as const)
      .filter(([, v]) => v !== undefined)
      .map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v!).toFixed(1)}`)
      .join(' ');
  const lastIdx = (key: 'vsRange' | 'vsHand') => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i][key] !== undefined) return i;
    return -1;
  };
  const pct = (v?: number) => (v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
  const lr = lastIdx('vsRange');
  const lh = showHand ? lastIdx('vsHand') : -1;
  // keep the two end labels from colliding
  let yR = lr >= 0 ? y(points[lr].vsRange!) : 0;
  let yH = lh >= 0 ? y(points[lh].vsHand!) : 0;
  if (lr >= 0 && lh >= 0 && Math.abs(yR - yH) < 14) {
    if (yR <= yH) yH = yR + 14;
    else yR = yH + 14;
  }
  return (
    <div className="relative mx-auto max-w-md">
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--series-1)' }} /> Your equity vs his range
        </span>
        {showHand && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--series-2)' }} /> vs his actual hand
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded bg-muted" /> Price (equity needed to call)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Equity by street">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} strokeDasharray={v === 0.5 ? '0' : '2 4'} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
              {v * 100}%
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={hover === i ? 'var(--fg)' : 'var(--muted)'}>
            {points[i]?.label ?? ['Preflop', 'Flop', 'Turn', 'River'][i]}
          </text>
        ))}
        {points.map((p, i) =>
          p.required !== undefined ? <line key={'r' + i} x1={x(i) - 9} x2={x(i) + 9} y1={y(p.required)} y2={y(p.required)} stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" /> : null,
        )}
        {showHand && <path d={path('vsHand')} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" />}
        <path d={path('vsRange')} fill="none" stroke="var(--series-1)" strokeWidth={2} />
        {points.map((p, i) => (
          <g key={'p' + i}>
            {showHand && p.vsHand !== undefined && <circle cx={x(i)} cy={y(p.vsHand)} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />}
            {p.vsRange !== undefined && <circle cx={x(i)} cy={y(p.vsRange)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />}
          </g>
        ))}
        {lr >= 0 && (
          <text x={x(lr) + 10} y={yR + 4} fontSize={11} fill="var(--fg)">
            {pct(points[lr].vsRange)}
          </text>
        )}
        {lh >= 0 && (
          <text x={x(lh) + 10} y={yH + 4} fontSize={11} fill="var(--muted)">
            {pct(points[lh].vsHand)}
          </text>
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />}
        {/* hit targets: one column per street, wider than the marks */}
        {Array.from({ length: n }, (_, i) => (
          <rect
            key={'h' + i}
            x={x(i) - (W - PAD.l - PAD.r) / (n - 1) / 2}
            y={0}
            width={(W - PAD.l - PAD.r) / (n - 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}
          />
        ))}
      </svg>
      {hover !== null && points[hover] && (
        <div className="pointer-events-none absolute top-6 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
          <div className="font-semibold">{points[hover].label}</div>
          <div>
            vs range: {points[hover].approx ? '≈' : ''}
            {pct(points[hover].vsRange)}
          </div>
          {showHand && <div>vs his hand: {pct(points[hover].vsHand)}</div>}
          {points[hover].required !== undefined && <div>needed to call: {pct(points[hover].required)}</div>}
        </div>
      )}
    </div>
  );
}
