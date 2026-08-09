import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { findAudioFile, getSession, readTranscript } from "@/lib/transcribe/sessions";
import { readSuggestionLog } from "@/lib/suggest/log";
import { readSummary } from "@/lib/summary/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const [transcript, suggestions, summary, audioFile] = await Promise.all([
    readTranscript(id),
    readSuggestionLog(id),
    readSummary(id),
    findAudioFile(id),
  ]);
  const audioExt = audioFile ? path.extname(audioFile).toLowerCase() : null;
  return NextResponse.json({
    session,
    transcript,
    suggestions,
    summary,
    hasAudio: !!audioFile,
    audioExt,
  });
}
