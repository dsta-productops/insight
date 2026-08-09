import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { buildWhisperPrompt } from "@/lib/transcribe/prompt";
import { activeProvider, transcribe } from "@/lib/transcribe/providers";
import {
  UPLOADS_DIR,
  addSession,
  getSession,
  listSessions,
  removeSessions,
  saveTranscript,
  updateSession,
} from "@/lib/transcribe/sessions";
import type { SessionMeta } from "@/lib/transcribe/types";

export const runtime = "nodejs";

const ACCEPTED = [".wav", ".mp3", ".m4a", ".aiff", ".aif", ".caf", ".mp4"];
const MAX_BYTES = 100 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ sessions: await listSessions() });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const title = (form.get("title") as string | null)?.trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
  }
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported audio type. Accepted: ${ACCEPTED.join(", ")}.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 100 MB limit." }, { status: 400 });
  }

  const id = randomUUID();
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const audioPath = path.join(UPLOADS_DIR, `${id}${ext}`);
  await fs.writeFile(audioPath, Buffer.from(await file.arrayBuffer()));

  const meta: SessionMeta = {
    id,
    title: title || file.name,
    filename: file.name,
    uploadedAt: new Date().toISOString(),
    status: "transcribing",
    provider: activeProvider(),
  };
  await addSession(meta);

  // Fire-and-forget background transcription; the client polls GET /api/sessions/[id].
  void runTranscription(id, audioPath);

  return NextResponse.json({ session: meta }, { status: 202 });
}

async function runTranscription(id: string, audioPath: string): Promise<void> {
  try {
    const prompt = await buildWhisperPrompt();
    const segments = await transcribe(audioPath, prompt);
    await saveTranscript({
      sessionId: id,
      createdAt: new Date().toISOString(),
      provider: activeProvider(),
      segments,
    });
    const durationSec = segments.length ? segments[segments.length - 1].end : 0;
    await updateSession(id, { status: "done", durationSec });
  } catch (e) {
    await updateSession(id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  const title = typeof body?.title === "string" ? body.title.trim() : null;
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
  const existing = await getSession(id);
  if (!existing) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  await updateSession(id, { title });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ids = req.nextUrl.searchParams.getAll("id");
  if (ids.length === 0) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const removed = await removeSessions(ids);
  if (removed === 0) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json({ ok: true, removed });
}
