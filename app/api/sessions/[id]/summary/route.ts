import { NextRequest, NextResponse } from "next/server";
import {
  summarizeTranscript,
  summaryProviderName,
  updateSummary,
  type SummaryDoc,
} from "@/lib/summary";
import { pushHistory, readSummary, writeSummary } from "@/lib/summary/store";
import { readTranscript } from "@/lib/transcribe/sessions";

export const runtime = "nodejs";

/**
 * Update a session's running summary.
 *
 * Two modes:
 * - INCREMENTAL (default) — body { bullets, window }: fold the newest transcript
 *   window into the given bullets. Driven by the live view's low-cadence loop.
 *   Writes its own summaries/<id>.json, so it never races the transcript writer.
 * - REGENERATE — body { regenerate: true }: rebuild from the whole stored
 *   transcript (post-session "Regenerate"). Ignores any client-sent bullets.
 *
 * Persists the result and returns { summary }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { bullets?: unknown; window?: unknown; regenerate?: unknown; ephemeral?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → treated as an incremental no-op update */
  }

  try {
    let bullets: string[];

    if (body.regenerate === true) {
      const transcript = await readTranscript(id);
      if (!transcript) {
        return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
      }
      if (transcript.segments.length === 0) {
        return NextResponse.json({ error: "Transcript is empty." }, { status: 409 });
      }
      bullets = await summarizeTranscript(transcript.segments);
    } else {
      const current = Array.isArray(body.bullets)
        ? body.bullets.filter((b): b is string => typeof b === "string")
        : (await readSummary(id))?.bullets ?? [];
      const window = typeof body.window === "string" ? body.window : "";
      bullets = await updateSummary(current, window);
    }

    const summary: SummaryDoc = {
      sessionId: id,
      updatedAt: new Date().toISOString(),
      provider: summaryProviderName(),
      bullets,
    };
    // Ephemeral ("don't save") sessions compute the recap for the live panel but
    // never persist it. The client keeps the bullets in memory across passes.
    if (body.ephemeral !== true) {
      await writeSummary(summary);
    }
    return NextResponse.json({ summary });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Summary update failed." },
      { status: 500 },
    );
  }
}

const MAX_TEXT = 2000;

function cleanText(v: unknown): string | null {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : null;
}

/**
 * Save a hand-edited recap. Body { bullets?, sections? } replaces whichever
 * parts are sent; blank entries are dropped. Stamps `editedAt` so the UI can
 * warn before a regenerate overwrites the edits. Never calls a model.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { bullets?: unknown; sections?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const existing = await readSummary(id);
  if (!existing) {
    return NextResponse.json({ error: "No recap for this session yet." }, { status: 404 });
  }

  const next: SummaryDoc = { ...existing };

  if (body.bullets !== undefined) {
    if (!Array.isArray(body.bullets)) {
      return NextResponse.json({ error: "bullets must be an array." }, { status: 400 });
    }
    next.bullets = body.bullets
      .map(cleanText)
      .filter((b): b is string => !!b);
  }

  if (body.sections !== undefined) {
    if (!Array.isArray(body.sections)) {
      return NextResponse.json({ error: "sections must be an array." }, { status: 400 });
    }
    next.sections = body.sections
      .map((sec) => {
        const o = (sec ?? {}) as { title?: unknown; points?: unknown };
        const points = Array.isArray(o.points)
          ? o.points.map(cleanText).filter((p): p is string => !!p)
          : [];
        return { title: cleanText(o.title) ?? "", points };
      })
      // Drop a section only when it is entirely empty.
      .filter((sec) => sec.title || sec.points.length > 0);
  }

  await pushHistory(existing);
  next.editedAt = new Date().toISOString();
  next.updatedAt = next.editedAt;
  await writeSummary(next);
  return NextResponse.json({ summary: next });
}
