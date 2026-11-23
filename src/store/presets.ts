// Named presets for the heads-up simulator and the Range Explorer (stored with the rest of the data, so they're
// included in export/import).
import { usePersisted } from './storage';

export interface PresetsState {
  play: Record<string, unknown>;
  explorer: Record<string, unknown>;
}
export const EMPTY_PRESETS: PresetsState = { play: {}, explorer: {} };

export function usePresets() {
  return usePersisted<PresetsState>('presets', EMPTY_PRESETS);
}
