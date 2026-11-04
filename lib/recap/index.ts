import type { TranscriptSegment } from "@/lib/transcribe/types";
import type { ModeId } from "@/lib/modes/registry";
import type { RecapSection } from "@/lib/summary";
import { callJSON, activeLlmProvider } from "@/lib/llm/json";
import { stripListMarker } from "@/lib/utils";

/**
 * Detailed, post-session RECAP generation. Distinct from the terse live "active
 * summary" (lib/summary): this is the richer, mode-shaped artifact the operator
 * reviews/presents/downloads after a session, generated on demand.
 *
 * Approach (validated on the bundled 8B): MAP -> REDUCE.
 *  - MAP: fold the transcript in fixed windows, extracting factual bullets per
 *    window. Extraction is what the small model does reliably.
 *  - REDUCE: organize the pooled bullets into a mode-appropriate set of
 *    sections. The structure is SCAFFOLDING we supply (a fixed section skeleton
 *    per mode); the model only extracts-then-slots, never free-form synthesizes.
 *
 * Invariant across every mode: this is a factual RECAP, never analysis, scoring,
 * diagnosis, or verdicts (that is the coach's / the practitioner's job). Any
 * section that would name WHO said something stays out unless the transcript
 * text itself names them — the model must not guess speaker roles.
 *
 * Untimed + offline (post-session), so cost is spent on more passes rather than
 * a bigger model: sequential calls, output caps kept tight so an 8B decoding
 * loop can't burn the whole budget.
 */

const MAP_WINDOW = 40; // transcript segments per extraction window
const MAX_LINE_CHARS = 220;
const MAP_MAX_TOKENS = 400; // enough for 6 bullets; a runaway is still bounded + salvaged
// The reduce shares the local model's 4096-token context with its prompt, so
// this is near the ceiling for a large pool. When the model still overruns it
// (a long, dense session), the salvage parser recovers the complete sections.
const REDUCE_MAX_TOKENS = 2048;
// Coarse first cap on pooled bullets (avoid building a giant string); the real
// bound is the token budget below.
const MAX_POOL_BULLETS = 120;

// The single reduce call must fit ENTIRELY inside the local model's context
// window: prompt + generated output <= n_ctx, or llama.cpp hard-500s with
// "Context size has been exceeded". n_ctx is 4096 for the bundled model (and we
// pin Ollama to match). We trim the reduce INPUT to leave room for the output,
// then size the output to whatever context actually remains.
const N_CTX = 4096;
// Generous margin: covers chat-template/role tokens AND any undershoot in the
// char/4 estimate, so prompt+output stays safely under n_ctx.
const CTX_SAFETY = 400;
const REDUCE_INPUT_TOKEN_MAX = N_CTX - REDUCE_MAX_TOKENS - CTX_SAFETY;
/** Rough token estimate (~4 chars/token for English); intentionally conservative. */
const estTokens = (s: string) => Math.ceil(s.length / 4);

const MAP_SYSTEM = `Extract the key points from this portion of a conversation transcript. Return factual bullets: the topics raised, the views/opinions expressed, decisions or agreements, and any concrete facts, examples, or anecdotes. Do NOT attribute points to a person or role. Do NOT analyze, judge, or add anything not said. Each bullet a short declarative phrase. Return JSON {"bullets": ["..."]}.`;

const MAP_SCHEMA = {
  type: "object",
  properties: {
    bullets: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
  required: ["bullets"],
  additionalProperties: false,
} as const;

const REDUCE_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          points: { type: "array", items: { type: "string" } },
        },
        required: ["title", "points"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
} as const;

/**
 * Per-mode section skeleton for the REDUCE step. Each entry describes the genre
 * and the exact sections to organize into. Everything stays extractive; a
 * section may be omitted if nothing fits. Modes not listed use DEFAULT.
 *
 * Job-interview stands apart from the theme-clustered default: it organizes the
 * candidate's evidence for review without scoring, ranking, or recommending.
 */
const DEFAULT_REDUCE = `This was an interview or discussion. Group the points into 5-8 THEMES that reflect what was actually covered. Give each theme a short title, then list the substantive points under it (the specific views, reasons, and concrete examples). Keep the detail; do not collapse a theme to a single line.`;

const REDUCE_BY_MODE: Partial<Record<ModeId, string>> = {
  "user-research": `This was a user-research interview. Organize into these sections (omit any with nothing to report): 'Themes discussed' (the topics and views raised, grouped), 'Pain points and frustrations', 'Needs and desired outcomes', 'Notable quotes or moments'.`,

  "job-interview": `This was a job interview. Organize the EVIDENCE the candidate gave, for the interviewer to review. Do NOT score, rank, recommend, or state a hiring conclusion, and never include anything about protected or personal characteristics. Sections (omit any with nothing to report): 'Background and experience', 'Evidence by theme' (the concrete examples/STAR stories the candidate gave), 'Specific outcomes and results mentioned', 'Questions the candidate asked'.`,

  "table-discussion": `This was a small-group discussion or focus group. Organize into 5-8 THEMES reflecting what the group discussed, each with its substantive points, plus a final 'Notable examples' section. Do not label points as agreement or disagreement (the transcript is not speaker-attributed).`,

  "panel-moderation": `This was a moderated panel. Organize the points into 4 to 8 DISTINCT topic threads that were discussed, each as its own section with a short specific title and its key points — do not lump everything into one section. Then, if applicable, add a 'Notable exchanges' section and a 'Questions raised' section. Do not attribute a question to the audience or a specific panelist (the transcript is not speaker-attributed).`,
};

function reduceSystem(mode: ModeId | undefined): string {
  const spec = (mode && REDUCE_BY_MODE[mode]) || DEFAULT_REDUCE;
  return `You are writing a detailed recap of a COMPLETED session for the person who ran it to review afterward. You are given a flat list of points extracted from across the whole session. ${spec}

Rules:
- This is a FACTUAL RECAP, not analysis, advice, scoring, or diagnosis. Report what was said; do not add conclusions.
- Be COMPLETE: include every distinct substantive point from the list. Merge only near-identical duplicates. Do NOT drop a point because it does not fit a section neatly — place it under the closest one. Only skip greetings, logistics, and pure filler.
- Each point a short declarative phrase, no trailing punctuation.
- Do not invent sections beyond those described. A section with nothing to report is omitted entirely.
Return JSON {"sections": [{"title": "...", "points": ["..."]}]}.`;
}

/**
 * Recover the complete top-level items of `content[key]`'s array even when the
 * JSON is TRUNCATED (the local model can hit the token cap mid-recap on a long,
 * dense session). Walks the array tracking string/brace depth and keeps every
 * item that closes cleanly; the incomplete trailing item is dropped. This is
 * what stops a truncated response from yielding an empty recap.
 */
function salvageArrayItems(content: string, key: string): unknown[] {
  const ki = content.indexOf(`"${key}"`);
  if (ki < 0) return [];
  const open = content.indexOf("[", ki);
  if (open < 0) return [];
  const items: unknown[] = [];
  const push = (raw: string) => {
    const t = raw.trim().replace(/^,+/, "").trim();
    if (!t) return;
    try {
      items.push(JSON.parse(t));
    } catch {
      /* incomplete trailing item — drop it */
    }
  };
  let depth = 0;
  let inStr = false;
  let esc = false;
  let buf = "";
  for (let i = open + 1; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      buf += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        inStr = false;
        if (depth === 0) { push(buf); buf = ""; }
      }
      continue;
    }
    if (ch === '"') { inStr = true; buf += ch; continue; }
    if (ch === "{" || ch === "[") { depth++; buf += ch; continue; }
    if (ch === "]" && depth === 0) break;
    if (ch === "}" || ch === "]") {
      depth--;
      buf += ch;
      if (depth === 0) { push(buf); buf = ""; }
      continue;
    }
    if (ch === "," && depth === 0) { buf = ""; continue; }
    buf += ch;
  }
  return items;
}

function parseBullets(content: string): string[] {
  const obj = tryParseObject(content);
  let arr: unknown[] = obj && Array.isArray((obj as { bullets?: unknown }).bullets)
    ? (obj as { bullets: unknown[] }).bullets
    : [];
  if (arr.length === 0) arr = salvageArrayItems(content, "bullets");
  return arr
    .filter((b): b is string => typeof b === "string")
    .map((b) => stripListMarker(b))
    .filter(Boolean);
}

function parseSections(content: string): RecapSection[] {
  const obj = tryParseObject(content);
  let arr: unknown[] = obj && Array.isArray((obj as { sections?: unknown }).sections)
    ? (obj as { sections: unknown[] }).sections
    : [];
  if (arr.length === 0) arr = salvageArrayItems(content, "sections");
  const out: RecapSection[] = [];
  for (const s of arr) {
    if (!s || typeof s !== "object") continue;
    const title = (s as { title?: unknown }).title;
    const points = (s as { points?: unknown }).points;
    if (typeof title !== "string" || !Array.isArray(points)) continue;
    const cleanPoints = points
      .filter((p): p is string => typeof p === "string")
      .map((p) => stripListMarker(p))
      .filter(Boolean);
    if (cleanPoints.length > 0) out.push({ title: title.trim(), points: cleanPoints });
  }
  return out;
}

function tryParseObject(content: string): unknown {
  if (!content.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

export function recapProviderName(): string {
  return activeLlmProvider();
}

/**
 * Generate the detailed recap from a finished transcript. Runs the MAP windows
 * sequentially (the local model shares one GPU — concurrent calls only
 * contend), pools the bullets, then a single REDUCE pass shaped by the mode.
 * Returns [] if the transcript yields nothing usable.
 */
export async function generateRecap(
  segments: TranscriptSegment[],
  mode: ModeId | undefined,
  priorBullets: string[] = [],
  onProgress?: (pct: number) => void,
): Promise<RecapSection[]> {
  // Pre-slice the non-empty windows so we know the denominator for progress.
  // The MAP phase spans 0-90%, the single REDUCE pass covers the last 90-100%.
  const windows: string[] = [];
  for (let i = 0; i < segments.length; i += MAP_WINDOW) {
    const window = segments
      .slice(i, i + MAP_WINDOW)
      .map((s) => {
        const line = s.text.slice(0, MAX_LINE_CHARS);
        return s.speaker
          ? `${s.speaker === "researcher" ? "Researcher" : "Participant"}: ${line}`
          : line;
      })
      .join("\n");
    if (window.trim()) windows.push(window);
  }

  const bullets: string[] = [];
  for (let k = 0; k < windows.length; k++) {
    // A single bad window must not sink the whole recap.
    try {
      const content = await callJSON({
        system: MAP_SYSTEM,
        schema: MAP_SCHEMA,
        user: windows[k],
        maxTokens: MAP_MAX_TOKENS,
        schemaName: "points",
      });
      bullets.push(...parseBullets(content));
    } catch {
      // skip this window
    }
    onProgress?.(Math.round((90 * (k + 1)) / windows.length));
  }
  // Seed the reduce with the curated active-summary bullets too, so the detailed
  // recap is a superset of the summary it is based on and can't come out thinner
  // (matters most on short sessions, where the map yields few points).
  const pool = [
    ...priorBullets.map((b) => stripListMarker(b)).filter(Boolean),
    ...bullets,
  ].slice(0, MAX_POOL_BULLETS);
  if (pool.length === 0) return [];

  onProgress?.(92); // map done; the reduce pass is the last stretch

  // Fit the reduce inside n_ctx (prompt + output). Trim the pooled points by an
  // estimated token budget — dropping transcript-tail points first — then size
  // the output to whatever context remains. Guarantees no context overflow.
  const system = reduceSystem(mode);
  const buildUser = (items: string[]) =>
    "Extracted points:\n" + items.map((b) => `- ${b}`).join("\n");
  let reducePool = pool;
  while (
    reducePool.length > 1 &&
    estTokens(system) + estTokens(buildUser(reducePool)) > REDUCE_INPUT_TOKEN_MAX
  ) {
    reducePool = reducePool.slice(0, -1);
  }
  const user = buildUser(reducePool);
  const maxTokens = Math.max(
    512,
    Math.min(REDUCE_MAX_TOKENS, N_CTX - estTokens(system) - estTokens(user) - CTX_SAFETY),
  );
  const content = await callJSON({
    system,
    schema: REDUCE_SCHEMA,
    user,
    maxTokens,
    schemaName: "recap",
  });
  return parseSections(content);
}
