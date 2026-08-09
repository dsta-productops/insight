import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { buildWhisperPrompt } from "@/lib/transcribe/prompt";
import { activeProvider, transcribe } from "@/lib/transcribe/providers";
import {
  appendSegments,
  getSession,
  readTranscript,
  updateSession,
} from "@/lib/transcribe/sessions";
import { allowSleep } from "@/lib/keep-awake";

export const runtime = "nodejs";

/** Whisper hallucination artifacts on silence/noise — dropped from live feeds. */
const NOISE = /^\s*[\[(]/;

/**
 * Stock phrases Whisper hallucinates on silent/near-silent audio (training-data
 * artifacts — quiet video outros). Dropped only when they are the segment's
 * ENTIRE text; "thank you" inside a real sentence is untouched.
 */
const HALLUCINATIONS = new Set([
  "thank you",
  "thank you thank you",
  "thanks",
  "thank you for watching",
  "thanks for watching",
  "please subscribe",
  "bye",
  "you",
]);

function isHallucination(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.has(normalized);
}

/**
 * Collapse a phrase Whisper looped on silence/noise (e.g. "i'm still by myself
 * i'm still by myself i'm still by myself") down to a single instance. Restricted
 * to multi-word phrases (>= ~9 chars, contains a space) repeated 3+ times, so
 * genuine short emphasis ("very very very") is left untouched.
 */
function collapseRepeatedPhrases(text: string): string {
  return text.replace(
    /(\b[\w'][\w']*(?: [\w']+)+)(?:[\s,.!?]+\1\b){2,}/gi,
    "$1",
  );
}

/**
 * POST an audio chunk (multipart: file=WAV, offset=seconds from session start).
 * The chunk is transcribed and its segments appended at the given offset.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Ephemeral sessions are never persisted, so there is no stored session to look
  // up — the client vouches for the session via ?ephemeral=1 and we skip every write.
  const ephemeral = req.nextUrl.searchParams.get("ephemeral") === "1";
  if (!ephemeral) {
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    if (session.status !== "live") {
      return NextResponse.json({ error: "Session is not live." }, { status: 409 });
    }
  }

  const form = await req.formData();
  const file = form.get("file");
  const offset = Number(form.get("offset") ?? 0);
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio chunk provided." }, { status: 400 });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "insight-live-"));
  const chunkPath = path.join(tmpDir, "chunk.wav");
  try {
    await fs.writeFile(chunkPath, Buffer.from(await file.arrayBuffer()));
    const prompt = await buildWhisperPrompt(id);
    const raw = await transcribe(chunkPath, prompt);
    const mapped = raw
      .filter((s) => s.text && !NOISE.test(s.text) && !isHallucination(s.text))
      .map((s) => ({
        start: s.start + offset,
        end: s.end + offset,
        text: collapseRepeatedPhrases(s.text),
      }));

    // Drop consecutive verbatim repeats. On silent/unclear audio (e.g. a speaker
    // off-mic) Whisper loops a phrase — it echoes the conditioning prompt (the
    // transcript tail) — flooding the transcript with the same line across many
    // chunks. collapseRepeatedPhrases only handles a loop WITHIN one chunk; this
    // catches the cross-chunk case by seeding from the last stored segment, so a
    // runaway loop collapses to a single line.
    const norm = (t: string) =>
      t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const prior = ephemeral ? null : await readTranscript(id);
    let lastText = prior?.segments.length
      ? norm(prior.segments[prior.segments.length - 1].text)
      : "";
    const segments = mapped.filter((s) => {
      const n = norm(s.text);
      if (n && n === lastText) return false; // same line as the one before → drop
      lastText = n;
      return true;
    });

    // Ephemeral: transcribe and return, but never write the transcript to disk.
    const doc = ephemeral
      ? null
      : segments.length
        ? await appendSegments(id, activeProvider(), segments)
        : prior;

    return NextResponse.json({
      appended: segments,
      totalSegments: doc?.segments.length ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chunk transcription failed." },
      { status: 500 },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/** End the live session. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Ephemeral session: nothing was persisted, so there's nothing to finalize —
  // just release the sleep lock and return.
  if (req.nextUrl.searchParams.get("ephemeral") === "1") {
    allowSleep();
    return NextResponse.json({ ok: true, durationSec: 0 });
  }
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const doc = await readTranscript(id);
  const durationSec = doc?.segments.length
    ? doc.segments[doc.segments.length - 1].end
    : 0;
  await updateSession(id, { status: "done", durationSec });
  // Recording is over — let the machine idle-sleep again.
  allowSleep();
  return NextResponse.json({ ok: true, durationSec });
}
