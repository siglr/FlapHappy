import type { WsgOverrideMap } from './wsg-overrides';

import type { PanelDestination } from './panel-install';
export const PROFILE_SCHEMA = 'flaphappy.profile/3';
export const SETTINGS_SCHEMA = 'flaphappy.settings/1';

export interface Speed {
  no_ballast_kt: number | null;
  max_ballast_kt: number | null;
}

export interface FlapPosition {
  label: string;
  handle_index: number | null;
}

export type CurrentFlapSource = 'index' | 'percent' | 'lvar';

export interface BallastConfig {
  source: 'manual';
  default_fraction: number;
  drag_snap: number;
  max_ballast_litres: number | null;
  dump_minutes: number;
  auto: { enabled: boolean; [k: string]: unknown };
}

export interface CurrentFlapConfig {
  source: CurrentFlapSource;
  lvar_name: string | null;
  manual_fallback: boolean;
}

export interface Profile {
  schema: typeof PROFILE_SCHEMA;
  /** Filename stem in the profile folder. The title is this plus `.json`. */
  id: string;
  match: { title_contains: string[] };
  /** Working speeds in this object are knots. Saved files use metres per second. */
  units: 'kt';
  flaps: FlapPosition[];
  handle_count: number | null;
  vs_min: Speed;
  transitions: Array<Speed & { exclude_from_display?: boolean }>;
  /** Knots. Saved files store this as a single `vne_ms`, with no ballast split. */
  vne: number | null;
  /** Loaded flying weights for the existing light/heavy speed columns (kg). */
  weight_kg: { light: number | null; heavy: number | null };
  /** Manual ballast settings used only when either loaded-weight anchor is missing. */
  ballast: BallastConfig;
  current_flap: CurrentFlapConfig;
  marker_smoothing_ms: number;
  bank_scaling: 'off';
  source: 'user' | 'preset';
  notes: string;
  /** Ephemeral public-profile metadata. Never persisted as a standalone profile file. */
  wsg?: { variantKey:string; hiddenTransitions:boolean[]; visualMaxKt:number|null; ballastMode:'manual'|'live' };
}

export type IssueLevel = 'error' | 'warning';
export type IssueCategory = 'structure' | 'speeds' | 'other';

export interface Issue {
  level: IssueLevel;
  category: IssueCategory;
  code: string;
  message: string;
  /** Dotted field path for per-field highlighting, e.g. `transitions[2].no_ballast_kt`. */
  path?: string;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
  issues: Issue[];
  /** No errors at all: the profile may be applied to the live display. */
  ok: boolean;
  /** Rows and handle indices are usable, so the current-flap indication can work. */
  structureOk: boolean;
}

export interface ProfileMeta {
  id: string;
  /** File name in the profile folder, including `.json`. */
  filename: string;
  incomplete: boolean;
  match: string[];
  source: 'user' | 'preset';
  /** True only for in-memory examples, never for a file on disk. */
  virtual?: boolean;
  error?: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  schema: typeof SETTINGS_SCHEMA;
  last_profile_id: string | null;
  active_by_title: Record<string, string>;
  profile_selection: { mode: 'auto' | 'manual'; manualId: string | null; fallbackId: string | null };
  ballast_by_profile: Record<string, number>;
  /** How speeds are shown. Profile files are stored in metres per second. */
  units: import('./units').SpeedUnit;
  /** How height above ground is shown. */
  height: 'ft' | 'm';
  weight_unit: import('./units').WeightUnit;
  wind_unit: import('./units').WindUnit;
  /** AGL bar ends and the green band, in feet. */
  agl: { bottom_m: number; top_m: number; low_m: number; high_m: number };
  ui: {
    compact: boolean;
    always_on_top: boolean;
    opacity: number;
    zoom: number;
    demo_mode: boolean;
    external_panel_on_launch: boolean;
    /** The ballast slider on the display. */
    show_ballast: boolean;
    /** The height bar on the display. */
    show_agl: boolean;
    /** Optional large current/suggested flap indicator instead of IAS and flap rows. */
    simple_flap: boolean;
    /** Hide only the in-sim toolbar panel in recognized external camera views. */
    auto_hide_external: boolean;
    /** The transition speeds under the flap row. */
    show_transitions: boolean;
    group_hidden_flap_labels: boolean;
    highlight_recommended: boolean;
    /** The wind speed drawn on the AGL bar. */
    show_wind: boolean;
    /** Cylinder shading on the IAS and AGL fills, including the white end line. */
    bar_shading: boolean;
  };
  /** Optional anonymous WSG profile browsing; off by default. */
  wsg_profiles_enabled: boolean;
  wsg_profile_overrides: WsgOverrideMap;
  /** Original ribbon bounds retained for the optional external panel. */
  panel_destination:PanelDestination;
  window: WindowBounds | null;
  main_window: WindowBounds | null;
}
