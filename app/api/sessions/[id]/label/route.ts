import { NextRequest, NextResponse } from "next/server";
import { labelSpeakers } from "@/lib/transcribe/label";
import { readTranscript, saveTranscript } from "@/lib/transcribe/sessions";

export const runtime = "nodejs";
// Vercel-only cap (Hobby plan max is 300). The bundled desktop server ignores
// this export and imposes no timeout, so the local labeling pass is unaffected.
export const maxDuration = 300;

/**
 * Run the post-session speaker-labeling pass over a finished transcript and
 * persist the labels. Idempotent: re-running relabels from scratch.
 *
 * Streams progress as newline-delimited JSON — {progress:<pct>} lines as each
 * batch completes, then a final {transcript:<doc>} (or {error:<msg>}) — so the
 * review page can show a live percentage instead of an opaque spinner.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const transcript = await readTranscript(id);
  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }
  if (transcript.segments.length === 0) {
    return NextResponse.json({ error: "Transcript is empty." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const segments = await labelSpeakers(transcript.segments, (pct) =>
          send({ progress: pct }),
        );
        const updated = { ...transcript, segments, labeledAt: new Date().toISOString() };
        await saveTranscript(updated);
        send({ transcript: updated });
      } catch (e) {
        send({ error: e instanceof Error ? e.message : "Speaker labeling failed." });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
