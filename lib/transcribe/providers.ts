import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { ASSETS_DIR } from "@/lib/paths";
import type { TranscriptSegment, TranscriptionProvider } from "./types";

const run = promisify(execFile);

export function activeProvider(): TranscriptionProvider {
  const p = (process.env.TRANSCRIBE_PROVIDER ?? "local").toLowerCase();
  if (p === "groq" || p === "openai" || p === "local") return p;
  return "local";
}

export async function transcribe(
  audioPath: string,
  /**
   * Conditioning prompt: domain vocabulary + the tail of the transcript so
   * far. Whisper uses it to keep continuity across chunks and to spell
   * domain terms/acronyms correctly.
   */
  prompt?: string,
): Promise<TranscriptSegment[]> {
  let segments: TranscriptSegment[];
  switch (activeProvider()) {
    case "groq":
      segments = await transcribeHosted(audioPath, {
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        key: requiredEnv("GROQ_API_KEY"),
        model: "whisper-large-v3",
        prompt,
      });
      break;
    case "openai":
      segments = await transcribeHosted(audioPath, {
        url: "https://api.openai.com/v1/audio/transcriptions",
        key: requiredEnv("OPENAI_API_KEY"),
        model: "whisper-1",
        prompt,
      });
      break;
    default:
      segments = await transcribeLocal(audioPath, prompt);
  }
  // Whisper (especially the quantized local model) can lock into a decoding
  // loop and emit the same sentence many times. Collapse those repeats before
  // anything is stored — see collapseRepetition. Applied to EVERY provider:
  // hosted Whisper loops too.
  return collapseRepetition(segments);
}

/* ---------------- repetition-hallucination guard ---------------- */

/**
 * A repeated unit of at least this many words is a loop as soon as it repeats
 * (a multi-word phrase said back-to-back is never natural). SHORTER units — a
 * single word or a two-word pair — occur naturally ("no, no, no", "yeah yeah"),
 * so they are only a loop past SHORT_RUN_MAX consecutive copies. Both the long
 * "Dr. Chang is an urban professor…" ×50 loop and the "True. True. True…" ×hundreds
 * single-word loop are decoder hallucinations; distinguishing them from natural
 * speech is the REPEAT COUNT, not the phrase length.
 */
const MIN_PHRASE_WORDS = 3;
/** Consecutive copies of a short (< MIN_PHRASE_WORDS) unit that natural speech
 * can plausibly produce; beyond this it is treated as a decoder loop. */
const SHORT_RUN_MAX = 3;
/** Longest phrase length (words) scanned for immediate repetition. */
const MAX_REPEAT_WORDS = 16;

/** Per-token normalization for comparison: lowercase, drop non-alphanumerics
 * (so "Dr." matches "Dr" and "London." matches "London"). */
function normToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Comparison key for whole segments: normalized tokens with articles dropped,
 * so drifting variants ("at the University of London" / "at University of
 * London") a loop emits still match. Used only for dedup, never for stored text. */
const DEDUP_ARTICLES = new Set(["the", "a", "an"]);
function dedupKey(s: string): string {
  return s
    .split(/\s+/)
    .map(normToken)
    .filter((w) => w && !DEDUP_ARTICLES.has(w))
    .join(" ");
}

/**
 * Collapse an immediately-repeated word block inside one text block to a single
 * occurrence. Token-based (not sentence-based) so it is robust to abbreviation
 * periods ("Dr.") that would otherwise fragment sentence splitting. Repetition
 * is detected over an ARTICLE-STRIPPED token stream (mapped back to raw indices)
 * so a loop that drifts on articles — "is an urban professor" vs "is a urban
 * professor", "at the University" vs "at University" — still collapses fully.
 * Scans the SHORTEST period first so the fundamental repeating unit is found
 * (a single-word "True." loop is period 1, not a long coincidental block), then
 * collapses only when the run is long enough to be a loop rather than natural
 * emphasis — see MIN_PHRASE_WORDS / SHORT_RUN_MAX.
 */
function collapseWithinText(text: string): string {
  const raw = text.split(/\s+/).filter(Boolean);
  if (raw.length < 2) return text;
  // Comparison stream: normalized, article-free tokens, each remembering the raw
  // index it came from.
  const cmp: string[] = [];
  const idx: number[] = [];
  raw.forEach((w, r) => {
    const n = normToken(w);
    if (n && !DEDUP_ARTICLES.has(n)) {
      cmp.push(n);
      idx.push(r);
    }
  });
  const drop = new Set<number>(); // raw indices to drop (the extra copies)
  let c = 0;
  while (c < cmp.length) {
    let collapsed = false;
    const maxL = Math.min(MAX_REPEAT_WORDS, Math.floor((cmp.length - c) / 2));
    for (let L = 1; L <= maxL; L++) {
      let eq = true;
      for (let k = 0; k < L; k++) {
        if (cmp[c + k] !== cmp[c + L + k]) {
          eq = false;
          break;
        }
      }
      if (!eq) continue;
      // Found the fundamental period L. Count how many copies run.
      let j = c + L;
      skip: while (j + L <= cmp.length) {
        for (let k = 0; k < L; k++) {
          if (cmp[j + k] !== cmp[c + k]) break skip;
        }
        j += L;
      }
      const copies = (j - c) / L;
      // A loop if the unit is a phrase (>= MIN_PHRASE_WORDS, any repeat) or a
      // short unit repeated beyond what natural emphasis produces.
      if (L >= MIN_PHRASE_WORDS || copies > SHORT_RUN_MAX) {
        const dropStart = idx[c + L];
        const dropEnd = j < cmp.length ? idx[j] : raw.length;
        for (let r = dropStart; r < dropEnd; r++) drop.add(r);
        c = j;
        collapsed = true;
      }
      break; // shortest period found; do not test longer L at this position
    }
    if (!collapsed) c++;
  }
  return raw.filter((_, r) => !drop.has(r)).join(" ");
}

/**
 * Collapse Whisper repetition hallucinations: first within each segment, then
 * across consecutive segments (the loop spans several). Left in, the repeats not
 * only garble the transcript but poison the conditioning prompt — the transcript
 * tail fed to the next chunk (see buildWhisperPrompt) — which drives the NEXT
 * chunk to repeat it too, turning one glitch into minutes of garbage (observed:
 * a panelist intro repeated ~50 times across 60 s). Collapsing here cleans the
 * stored transcript AND keeps the tail clean so the loop cannot feed forward.
 */
function collapseRepetition(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const text = collapseWithinText(seg.text).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && dedupKey(last.text) === dedupKey(text)) {
      // Identical to the previous kept segment — a loop that spans segment
      // boundaries (e.g. "True." repeated across dozens of chunks, or a phrase
      // repeated chunk after chunk). Extend that segment's span rather than
      // repeat the line. Consecutive identical segments are not natural speech.
      last.end = seg.end;
      continue;
    }
    out.push({ ...seg, text });
  }
  return out;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (required by the selected transcription provider).`);
  return v;
}

/* ---------------- local: whisper.cpp ---------------- */

const WHISPER_BIN = process.env.WHISPER_CPP_BIN ?? "whisper-cli";
// Audio normalisation binary. macOS uses the built-in `afconvert`; every other
// platform (Windows/Linux) uses ffmpeg, bundled as bin/ffmpeg(.exe) in the
// desktop app and passed via FFMPEG_BIN. See scripts/prepare-bundle*.
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
const MODELS_DIR = path.join(ASSETS_DIR, "models");

/**
 * Normalise arbitrary input audio to the 16 kHz mono 16-bit WAV whisper.cpp
 * expects. Platform-aware: `afconvert` ships with macOS (no extra dependency),
 * ffmpeg covers Windows/Linux.
 */
async function toWhisperWav(inputPath: string, wavPath: string): Promise<void> {
  if (process.platform === "darwin") {
    await run("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", inputPath, wavPath]);
    return;
  }
  // -ar 16000 (16 kHz) -ac 1 (mono) -c:a pcm_s16le (16-bit little-endian PCM).
  try {
    await run(
      FFMPEG_BIN,
      ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `ffmpeg not found. Install it (or set FFMPEG_BIN); the desktop app bundles it as bin/ffmpeg.`,
      );
    }
    throw e;
  }
}
/** Best-first: pick the strongest model present in data/models/. */
const MODEL_PREFERENCE = [
  "ggml-large-v3-turbo-q5_0.bin",
  "ggml-large-v3-turbo.bin",
  "ggml-small.en.bin",
  "ggml-base.en.bin",
];

async function resolveModel(): Promise<string> {
  if (process.env.WHISPER_CPP_MODEL) return process.env.WHISPER_CPP_MODEL;
  for (const name of MODEL_PREFERENCE) {
    const p = path.join(MODELS_DIR, name);
    try {
      await fs.access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return path.join(MODELS_DIR, MODEL_PREFERENCE[0]);
}

async function transcribeLocal(
  audioPath: string,
  prompt?: string,
): Promise<TranscriptSegment[]> {
  const model = await resolveModel();
  try {
    await fs.access(model);
  } catch {
    throw new Error(
      `Whisper model not found at ${model}. Download one (e.g. ggml-large-v3-turbo-q5_0.bin from huggingface.co/ggerganov/whisper.cpp) into data/models/ or set WHISPER_CPP_MODEL.`,
    );
  }

  // whisper.cpp expects 16 kHz mono 16-bit WAV. toWhisperWav picks afconvert
  // (macOS) or ffmpeg (Windows/Linux) — see its definition above.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "insight-"));
  const wavPath = path.join(tmpDir, "audio.wav");
  const outBase = path.join(tmpDir, "out");
  try {
    await toWhisperWav(audioPath, wavPath);

    // --suppress-nst suppresses non-speech tokens (bracketed "[music]"-style
    // and subtitle-credit artefacts), a common seed for Whisper hallucinations.
    // Temperature fallback stays on (whisper.cpp default) to break decoder loops;
    // the repetition-collapse guard above is the deterministic backstop.
    const args = [
      "-m", model, "-f", wavPath, "-oj", "-of", outBase, "--no-prints",
      "--suppress-nst",
    ];
    if (prompt) args.push("--prompt", prompt);
    try {
      await run(WHISPER_BIN, args, { maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `whisper-cli not found. Install it with \`brew install whisper-cpp\` or set WHISPER_CPP_BIN.`,
        );
      }
      throw e;
    }

    const raw = await fs.readFile(`${outBase}.json`, "utf8");
    const json = JSON.parse(raw) as {
      transcription: { offsets: { from: number; to: number }; text: string }[];
    };
    return json.transcription
      .map((t) => ({
        start: t.offsets.from / 1000,
        end: t.offsets.to / 1000,
        text: t.text.trim(),
      }))
      .filter((s) => s.text.length > 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/* ---------------- hosted: Groq / OpenAI (same wire shape) ---------------- */

async function transcribeHosted(
  audioPath: string,
  cfg: { url: string; key: string; model: string; prompt?: string },
): Promise<TranscriptSegment[]> {
  const bytes = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), path.basename(audioPath));
  form.append("model", cfg.model);
  form.append("response_format", "verbose_json");
  if (cfg.prompt) form.append("prompt", cfg.prompt);

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Transcription request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    segments?: { start: number; end: number; text: string }[];
    text?: string;
  };
  if (json.segments?.length) {
    return json.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));
  }
  return json.text ? [{ start: 0, end: 0, text: json.text.trim() }] : [];
}
