/**
 * Mode registry — the single source of truth for INSIGHT's conversation modes.
 *
 * A "mode" is not a code path: it's a declarative profile that dials the fixed
 * engine (transcription, retrieval, the additive coach, the running summary,
 * export). This registry enumerates the modes, groups them into families, and
 * carries the operator-facing copy for the session-start picker. Adding a mode
 * later is a matter of adding a profile here plus its coach content, not new
 * architecture.
 *
 * Families are an internal grouping for build-sequencing and reuse; the operator
 * only ever picks a single mode. The four product invariants (purely additive,
 * untrained operator, offline/local, low cognitive load) are NOT axes here —
 * a profile can't override them.
 */

export type ModeFamily = "research" | "consequential" | "facilitation";

export type ModeStatus = "available" | "coming-soon";

export type ModeId =
  | "user-research"
  | "job-interview"
  | "staff-dialogue"
  | "counselling"
  | "meeting"
  | "table-discussion"
  | "panel-moderation"
  | "defence-psych";

export interface ModeProfile {
  id: ModeId;
  label: string;
  family: ModeFamily;
  status: ModeStatus;
  /** One-line card description. Kept short for the low-cognitive-load hero. */
  blurb: string;
}

export interface ModeFamilyInfo {
  id: ModeFamily;
  label: string;
}

/** Display order of the families in the picker. */
export const MODE_FAMILIES: ModeFamilyInfo[] = [
  { id: "research", label: "Research interviews" },
  { id: "consequential", label: "Workplace 1:1s" },
  { id: "facilitation", label: "Group facilitation" },
];

/**
 * All modes. `status: "available"` = built and selectable; `"coming-soon"` =
 * on the roadmap, shown disabled in the picker so operators can see what's
 * coming. Flip a mode to "available" when its coach content lands.
 */
export const MODES: ModeProfile[] = [
  {
    id: "user-research",
    label: "User research interview",
    family: "research",
    status: "available",
    blurb: "Interview users about a product or experience.",
  },
  {
    id: "defence-psych",
    label: "Research or assessment interview",
    family: "research",
    status: "coming-soon",
    blurb: "Structured research or assessment interviews of subjects.",
  },
  {
    id: "job-interview",
    label: "Job interview",
    family: "consequential",
    status: "available",
    blurb: "Assess a candidate with fair, structured questions.",
  },
  {
    id: "staff-dialogue",
    label: "Staff dialogue",
    family: "consequential",
    status: "coming-soon",
    blurb: "Performance and development conversations with a team member.",
  },
  {
    id: "counselling",
    label: "Staff counselling",
    family: "consequential",
    status: "coming-soon",
    blurb: "Supportive one-to-one wellbeing conversations.",
  },
  {
    id: "meeting",
    label: "Meeting",
    family: "facilitation",
    status: "coming-soon",
    blurb: "Keep a meeting on track and capture decisions and actions.",
  },
  {
    id: "table-discussion",
    label: "Table discussion",
    family: "facilitation",
    status: "available",
    blurb: "Facilitate a small-group or focus-group discussion.",
  },
  {
    id: "panel-moderation",
    label: "Panel moderation",
    family: "facilitation",
    status: "available",
    blurb: "Moderate a panel: draw out guests and connect their points.",
  },
];

/** The mode a session falls back to when none is set (preserves existing behavior). */
export const DEFAULT_MODE: ModeId = "user-research";

const MODE_BY_ID = new Map<ModeId, ModeProfile>(MODES.map((m) => [m.id, m]));

/** Resolve a (possibly stored/legacy/undefined) mode id to a profile, defaulting safely. */
export function getMode(id: string | undefined | null): ModeProfile {
  return (id && MODE_BY_ID.get(id as ModeId)) || MODE_BY_ID.get(DEFAULT_MODE)!;
}

/** True when the id names a built, selectable mode. */
export function isAvailableMode(id: string | undefined | null): boolean {
  return !!id && MODE_BY_ID.get(id as ModeId)?.status === "available";
}

/** Modes grouped by family, in family display order — drives the picker. */
export function modesByFamily(): { family: ModeFamilyInfo; modes: ModeProfile[] }[] {
  return MODE_FAMILIES.map((family) => ({
    family,
    modes: MODES.filter((m) => m.family === family.id),
  }));
}
