import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useRoute, go } from './router';
import { useApplySettings } from './store/settings';
import { cx } from './components/ui';
import { Reference } from './features/reference/Reference';

/**
 * Lazy-load a page; if its chunk is missing (a new version was deployed while an old page was open or cached),
 * reload once to pick up the new build instead of showing a blank screen.
 */
function lazyPage<T extends { default: ComponentType<{ mode?: string }> }>(load: () => Promise<T>) {
  return lazy(() =>
    load()
      .then((m) => {
        try {
          sessionStorage.removeItem('chunk-reload');
        } catch {
          /* ignore */
        }
        return m;
      })
      .catch((err) => {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem('chunk-reload') === '1';
        sessionStorage.setItem('chunk-reload', '1');
      } catch {
        /* ignore */
      }
      if (!reloaded) {
        window.location.reload();
        return new Promise<T>(() => {});
      }
      throw err;
    }),
  );
}
const Home = lazyPage(() => import('./features/home/Home'));
const Train = lazyPage(() => import('./features/train/Train'));
const Flashcards = lazyPage(() => import('./features/flashcards/Flashcards'));
const Progress = lazyPage(() => import('./features/progress/Progress'));
const SettingsPage = lazyPage(() => import('./features/settings/SettingsPage'));
const PlayHand = lazyPage(() => import('./features/play/PlayHand'));
const RangeExplorer = lazyPage(() => import('./features/explorer/RangeExplorer'));

const NAV: [string, string, string][] = [
  ['', 'Today', '◉'],
  ['train', 'Train', '♠'],
  ['play', 'Play', '♣'],
  ['explorer', 'Ranges', '▦'],
  ['flashcards', 'Cards', '▤'],
  ['reference', 'Ref', '☰'],
  ['progress', 'Stats', '↗'],
];

function NavLink({ to, label, icon, active }: { to: string; label: string; icon: string; active: boolean }) {
  return (
    <button
      onClick={() => go(to)}
      className={cx(
        'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-[10px] sm:flex-none sm:flex-row sm:gap-2 sm:px-2.5 sm:text-sm',
        active ? 'text-accent font-semibold' : 'text-muted hover:text-fg',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span className="text-lg leading-none sm:text-base">{icon}</span>
      {label}
    </button>
  );
}

export default function App() {
  useApplySettings();
  const { parts, query } = useRoute();
  const top = parts[0] ?? '';
  let page: ReactNode;
  switch (top) {
    case 'train':
      page = <Train mode={parts[1]} />;
      break;
    case 'flashcards':
      page = <Flashcards mode={parts[1]} />;
      break;
    case 'reference':
      page = <Reference tab={parts[1]} focus={query.get('focus') ?? undefined} />;
      break;
    case 'progress':
      page = <Progress />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    case 'play':
      page = <PlayHand />;
      break;
    case 'explorer':
      page = <RangeExplorer />;
      break;
    default:
      page = <Home />;
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2">
          <button onClick={() => go('')} className="flex items-center gap-2 font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">♠</span>
            Hold'em Trainer
          </button>
          <nav className="hidden gap-1 sm:flex">
            {NAV.map(([to, label, icon]) => (
              <NavLink key={label} to={to} label={label} icon={icon} active={top === to} />
            ))}
          </nav>
          <button onClick={() => go('settings')} className={cx('rounded-lg px-2 py-1 text-xl', top === 'settings' ? 'text-accent' : 'text-muted hover:text-fg')} aria-label="Settings">
            ⚙
          </button>
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-4 sm:pb-10">
        <Suspense fallback={<div className="p-8 text-center text-muted">Loading…</div>}>{page}</Suspense>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-bg/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map(([to, label, icon]) => (
          <NavLink key={label} to={to} label={label} icon={icon} active={top === to} />
        ))}
      </nav>
    </div>
  );
}
