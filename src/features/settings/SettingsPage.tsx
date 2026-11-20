import { useRef, useState, type ReactNode } from 'react';
import { useSettings, DEFAULT_SETTINGS, type Settings } from '../../store/settings';
import { exportAll, importAll } from '../../store/storage';
import { Panel, Chip, Button } from '../../components/ui';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Choice<K extends keyof Settings>({ k, options }: { k: K; options: [Settings[K], string][] }) {
  const [s, set] = useSettings();
  return (
    <>
      {options.map(([v, label]) => (
        <Chip key={String(v)} active={s[k] === v} onClick={() => set((p) => ({ ...p, [k]: v }))}>
          {label}
        </Chip>
      ))}
    </>
  );
}

export default function SettingsPage() {
  const [s, set] = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const doExport = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `holdem-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Progress exported.');
  };
  const doImport = async (f: File) => {
    try {
      importAll(await f.text());
      setMsg('Progress imported.');
    } catch (e) {
      setMsg('Import failed: ' + (e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <Panel title="Game">
        <Row label="Table size" hint="Which preflop charts and positions the trainer uses.">
          <Choice k="tableSize" options={[[6, '6-max'], [9, 'Full ring (9)']]} />
        </Row>
        <Row label="Default stack depth" hint="Shown in spots. Preflop charts assume ~100bb; at other depths they are only a rough guide.">
          <Choice k="stackDepth" options={[[50, '50bb'], [100, '100bb'], [200, '200bb']]} />
        </Row>
        <Row label="Amounts" hint="Show amounts in big blinds or in chips.">
          <Choice k="units" options={[['bb', 'Big blinds'], ['chips', 'Chips']]} />
          {s.units === 'chips' && (
            <label className="flex items-center gap-2 text-sm">
              1bb =
              <input
                type="number"
                min={0.01}
                step={0.25}
                value={s.bigBlind}
                onChange={(e) => set((p) => ({ ...p, bigBlind: Math.max(0.01, parseFloat(e.target.value) || 1) }))}
                className="w-20 rounded-lg border border-line bg-surface-2 px-2 py-1"
              />
            </label>
          )}
        </Row>
        <Row label="Difficulty" hint="Easy: clear-cut spots. Hard: more close decisions where the margin is small.">
          <Choice k="difficulty" options={[['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]} />
        </Row>
        <Row label="Home-game exploit notes" hint="Practical advice for loose low-stakes games, clearly labelled and kept separate from the math.">
          <Choice k="showExploits" options={[[true, 'Show'], [false, 'Hide']]} />
        </Row>
      </Panel>
      <Panel title="Display">
        <Row label="Theme">
          <Choice k="theme" options={[['dark', 'Dark'], ['light', 'Light']]} />
        </Row>
        <Row label="Deck colours" hint="Four-colour: ♠ black, ♥ red, ♦ blue, ♣ green.">
          <Choice k="fourColor" options={[[true, 'Four-colour'], [false, 'Two-colour']]} />
        </Row>
      </Panel>
      <Panel title="Your data">
        <p className="text-sm text-muted">Progress is stored only in this browser. Export it now and then so clearing the browser doesn't lose it.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={doExport}>
            Export progress (JSON)
          </Button>
          <Button onClick={() => fileRef.current?.click()}>Import progress</Button>
          <Button variant="ghost" onClick={() => set(DEFAULT_SETTINGS)}>
            Reset settings
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </div>
        {msg && <p className="mt-2 text-sm text-accent">{msg}</p>}
      </Panel>
      <p className="px-1 text-xs text-muted">
        Keyboard (desktop): F fold · C check/call · B bet · R raise · Space next. Every number is computed by the app or cited; see "ⓘ Source" links and SOURCES.md.
      </p>
    </div>
  );
}
