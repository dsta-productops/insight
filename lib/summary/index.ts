import Anthropic from "@anthropic-ai/sdk";
import type { TranscriptSegment } from "@/lib/transcribe/types";
import { stripListMarker } from "@/lib/utils";

/**
 * Running conversation summary — the "catch up" aid. As an interview
 * progresses, this maintains a tight set of bullets recapping what has been
 * covered, so the researcher can glance and re-sync if they lose the thread
 * (attention drifts, or they were busy forming the next question).
 *
 * Deliberately a RECAP, not synthesis: it reports what was said, it does not
 * interpret or advise (that is the coach's job). Extractive framing keeps it
 * well inside what the local 8B does reliably.
 *
 * Cost discipline (measured on the bundled 8B, ~24 tok/s): updates are
 * INCREMENTAL — each pass folds only the newest transcript window into the
 * existing bullets, so a pass stays ~bounded (~3.5s) no matter how long the
 * interview runs, instead of re-reading the whole transcript every time. The
 * live scheduler runs this at a low cadence and yields to the coach so it lands
 * in the coach's idle GPU window (see /live).
 *
 * Same provider selection as the coach and speaker-labeling passes
 * (SUGGEST_PROVIDER: local Ollama by default, llama.cpp bundled, Anthropic/Groq
 * optional) so the whole app stays keyless-capable.
 *
 * NOTE: this mirrors the provider machinery in lib/suggest/index.ts and
 * lib/transcribe/label.ts rather than sharing it — consistent with the existing
 * code. Extracting a shared lib/llm helper is a deferred refactor
 * (code-review finding #5); kept self-contained here for a clean revert.
 */

/** Keep the running summary glanceable — a hard ceiling on how much to read. */
const MAX_BULLETS = 6;

// Kept compact on purpose: this prompt runs on the SAME local model as the
// coach, and a big system prompt here evicts the coach's cached prompt from the
// shared llama.cpp KV cache, slowing BOTH. Trim before adding, don't pad.
const SYSTEM = `You keep a running summary of an IN-PROGRESS conversation (an interview, panel, focus group, meeting, or similar) so the person running it can glance for two seconds and catch up if they lose the thread.

Summarize WHAT IS BEING DISCUSSED — the topics, points, facts, examples, and decisions raised — NOT who said what. The transcript is usually NOT labeled by speaker, so do NOT attribute points to a person or role (do not write "the participant said…", "the moderator asked…"); just recap the substance. Only name a speaker if the transcript text itself explicitly and unambiguously identifies them AND it is essential to the point.

You get the CURRENT bullets and the NEWEST transcript since the last update; return the updated bullets folding it in.

- Capture SUBSTANCE: the topic under discussion, key points, concrete facts and examples, and any decisions or takeaways. Skip greetings, logistics, and filler.
- This is a factual RECAP, not analysis or advice.
- At most ${MAX_BULLETS} bullets, oldest first; merge or drop the least important to stay within that. Refine a bullet in place when new detail extends its topic.
- Each bullet: a short declarative phrase under 12 words, no trailing punctuation.
- If nothing substantive was added (small talk, filler, silence), return the current bullets unchanged.

Return JSON: {"bullets": ["...", "..."]}.`;

const SCHEMA = {
  type: "object",
  properties: {
    bullets: {
      type: "array",
      maxItems: MAX_BULLETS,
      items: { type: "string" },
    },
  },
  required: ["bullets"],
  additionalProperties: false,
} as const;

/** Bound each transcript line fed to the model. */
const MAX_LINE_CHARS = 220;
/**
 * Full-regeneration fold window (segments per incremental call). A recap folds
 * the finished transcript in these windows from an empty start, reusing the
 * exact incremental path the live view uses — so regen scales to any length and
 * behaves identically to what the researcher saw live.
 */
const REGEN_WINDOW = 12;

/** One theme of the detailed, post-session recap: a title and its points. */
export interface RecapSection {
  title: string;
  points: string[];
}

export interface SummaryDoc {
  sessionId: string;
  /** ISO timestamp of the last update. */
  updatedAt: string;
  provider: string;
  bullets: string[];
  /**
   * Optional detailed, theme-clustered recap for the session review page.
   * The terse live "active summary" writes only `bullets`; when a detailed
   * recap exists it is rendered instead, with `bullets` as the fallback.
   */
  sections?: RecapSection[];
}

type SummaryProvider = "ollama" | "llamacpp" | "anthropic" | "groq";

function activeSummaryProvider(): SummaryProvider {
  const p = (process.env.SUGGEST_PROVIDER ?? "").toLowerCase();
  if (p === "anthropic" || p === "groq" || p === "ollama" || p === "llamacpp") return p;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "ollama";
}

export function summaryProviderName(): string {
  return activeSummaryProvider();
}

/**
 * One incremental merge: fold `window` (new transcript text since the last
 * update) into `bullets`, returning the updated list. `window` empty → the
 * current bullets are returned untouched with no model call.
 */
export async function updateSummary(
  bullets: string[],
  window: string,
): Promise<string[]> {
  if (!window.trim()) return bullets.slice(0, MAX_BULLETS);

  const provider = activeSummaryProvider();
  const user = `Current bullets:\n${
    bullets.length ? bullets.map((b) => `- ${b}`).join("\n") : "(none yet)"
  }\n\nNewest transcript since last update:\n${window}`;

  let next: string[];
  switch (provider) {
    case "anthropic":
      next = await viaAnthropic(user);
      break;
    case "groq":
      next = await viaGroq(user);
      break;
    case "llamacpp":
      next = await viaLlamaCpp(user);
      break;
    default:
      next = await viaOllama(user);
  }

  // A pass that returned nothing parseable must not wipe the running summary —
  // keep the last good bullets rather than blank the panel mid-interview.
  const cleaned = next.map((b) => stripListMarker(b)).filter(Boolean);
  if (cleaned.length === 0) return bullets.slice(0, MAX_BULLETS);
  return cleaned.slice(0, MAX_BULLETS);
}

/**
 * Rebuild the whole running summary from a finished transcript by folding it in
 * REGEN_WINDOW-segment windows (sequential — the local model shares one GPU, so
 * concurrent calls only contend). Used for the post-session "Regenerate".
 */
export async function summarizeTranscript(
  segments: TranscriptSegment[],
): Promise<string[]> {
  let bullets: string[] = [];
  for (let i = 0; i < segments.length; i += REGEN_WINDOW) {
    const window = segments
      .slice(i, i + REGEN_WINDOW)
      .map((s) => {
        const line = s.text.slice(0, MAX_LINE_CHARS);
        // If the transcript was speaker-labeled, hand the model ground-truth
        // roles; otherwise it infers them from the Q&A flow (live path never
        // has labels). Either way the two roles stay straight.
        return s.speaker
          ? `${s.speaker === "researcher" ? "Researcher" : "Participant"}: ${line}`
          : line;
      })
      .join("\n");
    bullets = await updateSummary(bullets, window);
  }
  return bullets;
}

/* ---------------- Ollama (local, free, default) ---------------- */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

async function viaOllama(user: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: SCHEMA,
        keep_alive: "30m",
        options: { temperature: 0, num_predict: 512 },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_URL}. Install and start it (\`brew install ollama && ollama serve\`), then \`ollama pull ${OLLAMA_MODEL}\`.`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 && body.includes("not found")) {
      throw new Error(`Ollama model "${OLLAMA_MODEL}" not found — run \`ollama pull ${OLLAMA_MODEL}\`.`);
    }
    throw new Error(`Ollama request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  return parseBullets(json.message?.content ?? "");
}

/* ---------------- Anthropic (premium) ---------------- */

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

async function viaAnthropic(user: string): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (required by SUGGEST_PROVIDER=anthropic).");
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") return [];
  const text = response.content.find((b) => b.type === "text");
  return text ? parseBullets(text.text) : [];
}

/* ---------------- llama.cpp (bundled local server) ---------------- */

const LLAMACPP_URL = process.env.LLAMACPP_URL ?? "http://localhost:8080";

async function viaLlamaCpp(user: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${LLAMACPP_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "insight-local",
        temperature: 0,
        max_tokens: 512,
        // Grammar-enforced schema (not bare json_object): otherwise the small
        // model echoes the schema shape instead of an instance. Mirrors the
        // coach and labeling paths.
        response_format: { type: "json_schema", json_schema: { name: "summary", schema: SCHEMA } },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    throw new Error(
      `Could not reach the bundled llama.cpp server at ${LLAMACPP_URL}. It should be started by the app; set LLAMACPP_URL to override.`,
    );
  }
  if (!res.ok) {
    throw new Error(`llama.cpp request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseBullets(json.choices?.[0]?.message?.content ?? "");
}

/* ---------------- Groq (hosted free tier) ---------------- */

async function viaGroq(user: string): Promise<string[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not set (required by SUGGEST_PROVIDER=groq).");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${SYSTEM}\n\nRespond with a single JSON object matching this schema exactly:\n${JSON.stringify(SCHEMA)}`,
        },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseBullets(json.choices?.[0]?.message?.content ?? "");
}

function parseBullets(content: string): string[] {
  if (!content.trim()) return [];
  const tryParse = (s: string): string[] | null => {
    try {
      const parsed = JSON.parse(s) as { bullets?: unknown };
      if (!Array.isArray(parsed.bullets)) return null;
      return parsed.bullets.filter((b): b is string => typeof b === "string");
    } catch {
      return null;
    }
  };
  const direct = tryParse(content);
  if (direct) return direct;
  const m = content.match(/\{[\s\S]*\}/);
  return m ? tryParse(m[0]) ?? [] : [];
}
