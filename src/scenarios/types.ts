import type { Card } from '../engine/cards';
import type { RangeFilter } from '../engine/handclass';
import type { Grade } from '../store/progress';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type OptKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface Option {
  key: string; // unique within the spot, e.g. "fold", "call", "bet-50", "raise-2.5"
  kind: OptKind;
  amount?: number; // total bet / raise-to, in bb
  label: string;
}

/** A villain range is a union of parts; each part is a preflop-style range string optionally filtered on the board. */
export interface VillainPart {
  range: string;
  filter?: RangeFilter;
  weight?: number; // default 1
}
export interface VillainSpec {
  label: string; // human description shown in "Assumptions"
  parts: VillainPart[];
}

export interface Spot {
  id: string;
  origin: 'chart' | 'math' | 'library';
  title?: string;
  mode: 'A' | 'B';
  street: Street;
  tableSize: 6 | 9;
  heroPos: string;
  villainPos?: string;
  hero: Card[];
  board: Card[];
  pot: number; // bb in the middle when hero acts (includes any bet hero is facing)
  toCall: number; // bb hero must add to call (0 = no bet)
  effStack: number; // bb behind for hero before this decision
  history: string;
  villain?: VillainSpec;
  options: Option[];
  grades: Record<string, Grade>; // option key → grade (missing = mistake)
  best: string; // recommended option key
  gradeBasis: 'chart' | 'equity' | 'authored';
  why: string[];
  concepts: string[];
  assumptions: string[];
  sources: string[]; // ids from REFS / SOURCES
  exploit?: string; // home-game note (practical advice, not math)
  tags: string[];
  chartId?: string;
  /** Equity computed at generation time (math spots), so the UI doesn't recompute it. */
  precomputedEquity?: { equity: number; win: number; tie: number; exact: boolean; samples: number; combos: number; lose: number };
}

export interface SpotNumbers {
  requiredEquity?: number;
  equity?: number;
  equityExact?: boolean;
  win?: number;
  tie?: number;
  villainCombos?: number;
  evCall?: number;
  spr: number;
  outs?: { all: Card[]; clean: Card[]; dirty: { card: Card; reasons: string[] }[]; next: number; byRiver?: number };
}
