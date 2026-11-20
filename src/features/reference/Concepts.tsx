import { useEffect, useRef } from 'react';
import { CONCEPTS } from '../../data/concepts';
import { Panel, KindBadge, SourceLink } from '../../components/ui';

export function Concepts({ focus }: { focus?: string }) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (focus) refs.current[focus]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {CONCEPTS.map((c) => (
        <div key={c.id} ref={(el) => { refs.current[c.id] = el; }} id={`concept-${c.id}`}>
          <Panel
            className={focus === c.id ? 'ring-2 ring-accent' : ''}
            title={
              <span className="flex items-center gap-2">
                {c.title} <KindBadge kind={c.kind} />
              </span>
            }
            right={<SourceLink ids={c.refs} />}
          >
            <p className="text-sm">{c.summary}</p>
            {c.formula && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{c.formula}</p>}
            {c.example && <p className="mt-2 text-sm text-muted">Example: {c.example}</p>}
            {c.pitfalls && <p className="mt-2 text-sm text-muted">Watch out: {c.pitfalls}</p>}
          </Panel>
        </div>
      ))}
    </div>
  );
}
