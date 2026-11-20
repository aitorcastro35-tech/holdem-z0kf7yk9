import { useCallback, useEffect, useRef, useState } from 'react';
import type { Spot } from '../../scenarios/types';
import type { Grade } from '../../store/progress';
import { useSettings } from '../../store/settings';
import { nextSpot, finalizeSpot, type SessionMode } from './spotSource';
import { SpotPlayer } from './SpotPlayer';
import { Panel, Button } from '../../components/ui';

export interface SessionResult {
  best: number;
  ok: number;
  mistake: number;
}

/** Plays `count` spots (or the provided list) and reports the tally. count = Infinity → endless. */
export function HandSession({
  mode,
  count = Infinity,
  spots,
  onDone,
  review,
  focus,
}: {
  mode: SessionMode;
  focus?: string[];
  count?: number;
  spots?: Spot[];
  onDone?: (r: SessionResult) => void;
  review?: boolean;
}) {
  const [settings] = useSettings();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [error, setError] = useState('');
  const [i, setI] = useState(0);
  const tally = useRef<SessionResult>({ best: 0, ok: 0, mistake: 0 });
  const total = spots ? spots.length : count;

  const load = useCallback(
    async (idx: number) => {
      setSpot(null);
      setError('');
      try {
        const s = spots ? await finalizeSpot(spots[idx]) : await nextSpot(mode, settings, focus);
        setSpot(s);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [mode, settings, spots, focus],
  );

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = (g: Grade) => {
    tally.current[g]++;
    const n = i + 1;
    if (n >= total) {
      onDone?.({ ...tally.current });
      return;
    }
    setI(n);
    window.scrollTo({ top: 0 });
    load(n);
  };

  if (error)
    return (
      <Panel title="Something went wrong">
        <p className="text-sm text-bad">{error}</p>
        <Button className="mt-2" onClick={() => load(i)}>
          Try another spot
        </Button>
      </Panel>
    );
  if (!spot) return <div className="p-10 text-center text-muted">Dealing…</div>;
  return (
    <SpotPlayer
      key={spot.id + i}
      spot={spot}
      onNext={next}
      review={review}
      progressLabel={Number.isFinite(total) ? `${i + 1} / ${total}` : `Hand ${i + 1} · ✅ ${tally.current.best} 🟡 ${tally.current.ok} ❌ ${tally.current.mistake}`}
    />
  );
}
