import Anthropic from "@anthropic-ai/sdk";
import type { Speaker, TranscriptSegment } from "./types";

/**
 * Post-session speaker labeling — the deferred "diarization" answer. Whisper
 * can't diarize live without downgrading the model, and the live coach reasons
 * about content, not identity, so speaker labels only matter in the finished
 * record. This is a single LLM pass over the whole transcript: the question ↔
 * answer structure of an interview is strong signal for who is talking.
 *
 * Runs on the same provider selection as the coach (SUGGEST_PROVIDER: local
 * Ollama by default, Anthropic/Groq as optional swaps) so the whole app stays
 * keyless-capable.
 */

const SYSTEM = `You label who is speaking in each line of a user-interview transcript.

There are exactly two speakers:
- "researcher" — the interviewer. Asks questions, prompts, probes, thanks, introduces topics, stays neutral.
- "participant" — the interviewee. Describes their experience, answers questions, tells stories, expresses opinions and problems.

You are given the transcript as numbered lines. Whisper split it by pauses, so one speaker's turn can span several consecutive lines, and a line may be a fragment. Use the flow of the conversation — a question is the researcher, the answer that follows is the participant — and keep a speaker consistent across their run of lines until the role clearly changes.

Return a label for EVERY line number, using the exact strings "researcher" or "participant".`;

const SCHEMA = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "number" },
          speaker: { type: "string", enum: ["researcher", "participant"] },
        },
        required: ["line", "speaker"],
        additionalProperties: false,
      },
    },
  },
  required: ["labels"],
  additionalProperties: false,
} as const;

/** Keep the prompt bounded — the cue for who's talking is in the first words. */
const MAX_LINE_CHARS = 220;

/**
 * Label in fixed-size line windows rather than one pass over the whole
 * transcript. A single pass caps its output (`num_predict`/`max_tokens`) and a
 * normal 30–60 min interview (>~130 lines) overruns it — the JSON truncates
 * mid-array, nothing parses, and the pass silently yields zero labels. 40 lines
 * per batch keeps every call's output well inside every provider's budget, so
 * labeling scales to any transcript length. A turn that spans a batch boundary
 * can mislabel one line — a negligible cost next to labeling nothing at all.
 */
const BATCH_SIZE = 40;

interface RawLabel {
  line: number;
  speaker: Speaker;
}

type LabelProvider = "ollama" | "llamacpp" | "anthropic" | "groq";

function activeLabelProvider(): LabelProvider {
  const p = (process.env.SUGGEST_PROVIDER ?? "").toLowerCase();
  if (p === "anthropic" || p === "groq" || p === "ollama" || p === "llamacpp") return p;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "ollama";
}

/**
 * Returns a copy of the segments with `speaker` filled in. Segments the model
 * failed to label are left as-is (undefined) rather than guessed.
 */
export async function labelSpeakers(
  segments: TranscriptSegment[],
  onProgress?: (pct: number) => void,
): Promise<TranscriptSegment[]> {
  if (segments.length === 0) return segments;

  const provider = activeLabelProvider();
  const label = (user: string): Promise<RawLabel[]> => {
    switch (provider) {
      case "anthropic":
        return viaAnthropic(user);
      case "groq":
        return viaGroq(user);
      case "llamacpp":
        return viaLlamaCpp(user);
      default:
        return viaOllama(user);
    }
  };

  const byLine = new Map<number, Speaker>();
  let batchesFailed = 0;
  const batchCount = Math.ceil(segments.length / BATCH_SIZE);

  // Sequential, not parallel: the local model shares one GPU, so concurrent
  // calls contend without going faster. Lines keep their global numbers so the
  // model's returned line indices map straight back with no renumbering.
  for (let start = 0; start < segments.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, segments.length);
    const numbered = segments
      .slice(start, end)
      .map((s, j) => `${start + j + 1}. ${s.text.slice(0, MAX_LINE_CHARS)}`)
      .join("\n");
    const user = `Transcript lines ${start + 1}-${end} of ${segments.length}:\n${numbered}`;

    let raw: RawLabel[];
    try {
      raw = await label(user);
    } catch (e) {
      // A reachability/config error (Ollama down, missing key) will fail every
      // batch — surface it immediately rather than after N retries.
      if (start === 0) throw e;
      raw = [];
    }

    let parsedAny = false;
    for (const r of raw) {
      if (
        Number.isInteger(r?.line) &&
        r.line >= start + 1 &&
        r.line <= end &&
        (r.speaker === "researcher" || r.speaker === "participant")
      ) {
        byLine.set(r.line, r.speaker);
        parsedAny = true;
      }
    }
    if (!parsedAny) batchesFailed++;
    onProgress?.(Math.round((100 * end) / segments.length));
  }

  // Fail loudly: a pass that labeled nothing must not report success and let
  // the route stamp `labeledAt` over an unlabeled transcript.
  if (byLine.size === 0) {
    throw new Error(
      `Speaker labeling produced no labels across ${batchCount} batch(es) — the model returned unparseable output.`,
    );
  }

  return segments.map((s, i) => {
    const speaker = byLine.get(i + 1);
    return speaker ? { ...s, speaker } : s;
  });
}

/* ---------------- Ollama (local, free, default) ---------------- */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

async function viaOllama(user: string): Promise<RawLabel[]> {
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
        options: { temperature: 0, num_predict: 2048 },
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
  return parseLabels(json.message?.content ?? "");
}

/* ---------------- Anthropic (premium) ---------------- */

// Env-configurable so any available frontier model can be swapped in without a
// code change; matches the coach path (see lib/suggest/index.ts). Base URL is
// overridable via ANTHROPIC_BASE_URL (read natively by the SDK).
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

async function viaAnthropic(user: string): Promise<RawLabel[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (required by SUGGEST_PROVIDER=anthropic).");
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") return [];
  const text = response.content.find((b) => b.type === "text");
  return text ? parseLabels(text.text) : [];
}

/* ---------------- llama.cpp (bundled local server) ---------------- */

// OpenAI-compatible local server bundled with the packaged app; mirrors the
// coach path in lib/suggest/index.ts. The Tauri sidecar sets LLAMACPP_URL.
const LLAMACPP_URL = process.env.LLAMACPP_URL ?? "http://localhost:8080";

async function viaLlamaCpp(user: string): Promise<RawLabel[]> {
  let res: Response;
  try {
    res = await fetch(`${LLAMACPP_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "insight-local",
        temperature: 0,
        // Grammar-enforced schema (not bare json_object): otherwise the small
        // model echoes the schema shape instead of an instance and parseLabels
        // returns []. Mirrors the coach path in lib/suggest/index.ts.
        response_format: { type: "json_schema", json_schema: { name: "labels", schema: SCHEMA } },
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
  return parseLabels(json.choices?.[0]?.message?.content ?? "");
}

/* ---------------- Groq (hosted free tier) ---------------- */

async function viaGroq(user: string): Promise<RawLabel[]> {
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
  return parseLabels(json.choices?.[0]?.message?.content ?? "");
}

function parseLabels(content: string): RawLabel[] {
  if (!content.trim()) return [];
  const tryParse = (s: string): RawLabel[] | null => {
    try {
      const parsed = JSON.parse(s) as { labels?: RawLabel[] };
      return Array.isArray(parsed.labels) ? parsed.labels : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(content);
  if (direct) return direct;
  const m = content.match(/\{[\s\S]*\}/);
  return m ? tryParse(m[0]) ?? [] : [];
}
