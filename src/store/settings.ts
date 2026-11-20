import { useEffect } from 'react';
import { usePersisted } from './storage';
import type { TableSize } from '../data/charts';

export interface Settings {
  tableSize: TableSize;
  stackDepth: 50 | 100 | 200;
  units: 'bb' | 'chips';
  bigBlind: number; // chip value of 1bb when units = chips
  difficulty: 'easy' | 'normal' | 'hard';
  showExploits: boolean;
  fourColor: boolean;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: Settings = {
  tableSize: 9,
  stackDepth: 100,
  units: 'bb',
  bigBlind: 2,
  difficulty: 'normal',
  showExploits: true,
  fourColor: true,
  theme: 'dark',
};

export function useSettings() {
  return usePersisted<Settings>('settings', DEFAULT_SETTINGS);
}

/** Apply theme + deck colours to <html>. */
export function useApplySettings() {
  const [s] = useSettings();
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = s.theme;
    el.dataset.deck = s.fourColor ? 'four' : 'two';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.theme === 'dark' ? '#0f1418' : '#f3f5f7');
  }, [s.theme, s.fourColor]);
}

/** Format an amount given in big blinds according to the unit setting. */
export function fmtAmount(bb: number, s: Settings): string {
  const r = (x: number) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(1));
  if (s.units === 'chips') return `$${r(bb * s.bigBlind)}`;
  return `${r(bb)} bb`;
}
