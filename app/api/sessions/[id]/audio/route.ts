import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { findAudioFile, getSession, saveLiveAudio } from "@/lib/transcribe/sessions";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".caf": "audio/x-caf",
};

/**
 * Serve the session's audio. Streams inline (with HTTP Range support so the
 * <audio> player can seek) by default; pass `?download=1` to force a file
 * attachment instead.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const file = await findAudioFile(id);
  if (!file) {
    return NextResponse.json({ error: "No audio for this session." }, { status: 404 });
  }
  const data = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const download = req.nextUrl.searchParams.has("download");

  const disposition = download
    ? (() => {
        const safeName = (session.title || "session")
          .replace(/[^\w.-]+/g, "_")
          .slice(0, 80);
        return `attachment; filename="${safeName}${ext}"`;
      })()
    : "inline";

  // Honor a single Range request so seeking works in the browser player.
  const range = req.headers.get("range");
  const rangeMatch = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (rangeMatch && !download) {
    const total = data.length;
    const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : total - 1;
    if (start >= total || end >= total || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }
    const chunk = data.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
      },
    });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Accept-Ranges": "bytes",
      "Content-Length": String(data.length),
    },
  });
}

/** Save a live session's full recording (multipart: file=WAV). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio provided." }, { status: 400 });
  }
  await saveLiveAudio(id, Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true });
}
