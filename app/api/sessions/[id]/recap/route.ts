import { NextRequest, NextResponse } from "next/server";
import { getSession, readTranscript } from "@/lib/transcribe/sessions";
import { readSummary, writeSummary } from "@/lib/summary/store";
import type { SummaryDoc } from "@/lib/summary";
import { generateRecap, recapProviderName } from "@/lib/recap";
import { recapToMarkdown } from "@/lib/export/session";

export const runtime = "nodejs";
// A detailed recap folds the whole transcript on the local model — minutes on a
// long session. The bundled desktop server enforces no timeout, so this export
// only matters on Vercel, where the Hobby plan caps maxDuration at 300.
export const maxDuration = 300;

/**
 * GET ?format=md — download just the session recap as a file. A focused
 * artifact (no transcript / coach log); prefers the detailed theme-clustered
 * recap and falls back to the flat summary bullets.
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
  const summary = await readSummary(id);
  if (!summary) {
    return NextResponse.json({ error: "No recap for this session yet." }, { status: 404 });
  }

  const slug =
    session.title.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() ||
    id;

  return new NextResponse(recapToMarkdown(session, summary), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-recap.md"`,
    },
  });
}

/**
 * POST — generate (or regenerate) the DETAILED, mode-shaped recap for this
 * session from its transcript, and store it additively on the summary doc
 * (the flat active-summary `bullets` are preserved as the default/fallback).
 * Runs the map-reduce on the local model; can take a couple of minutes.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (session.status === "live") {
    return NextResponse.json(
      { error: "Session is still live. End it before generating a recap." },
      { status: 409 },
    );
  }
  const transcript = await readTranscript(id);
  if (!transcript || transcript.segments.length === 0) {
    return NextResponse.json({ error: "No transcript to recap yet." }, { status: 400 });
  }

  const existing = await readSummary(id);
  const segments = transcript.segments;

  // Stream progress as newline-delimited JSON: {progress:<pct>} lines during
  // the map-reduce, then a final {summary:<doc>} (or {error:<msg>}). Lets the
  // review page show a live percentage instead of an opaque multi-minute spin.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const sections = await generateRecap(
          segments,
          session.mode,
          existing?.bullets ?? [],
          (pct) => send({ progress: pct }),
        );
        if (sections.length === 0) {
          send({ error: "The model returned nothing usable for this transcript." });
        } else {
          const doc: SummaryDoc = {
            sessionId: id,
            updatedAt: new Date().toISOString(),
            provider: recapProviderName(),
            bullets: existing?.bullets ?? [],
            sections,
          };
          await writeSummary(doc);
          send({ summary: doc });
        }
      } catch (e) {
        send({ error: e instanceof Error ? e.message : "Recap generation failed." });
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
