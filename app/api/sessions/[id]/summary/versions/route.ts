import { NextRequest, NextResponse } from "next/server";
import { pushHistory, readHistory, readSummary, writeSummary } from "@/lib/summary/store";
import type { SummaryDoc } from "@/lib/summary";

export const runtime = "nodejs";

/** GET — prior versions of this session's recap, newest first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({ versions: await readHistory(id) });
}

/**
 * POST { restore: <versionId> } — make a prior version the current recap. The
 * recap being replaced is itself set aside first, so a restore is never lossy.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { restore?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.restore !== "string") {
    return NextResponse.json({ error: "restore must be a version id." }, { status: 400 });
  }

  const version = (await readHistory(id)).find((v) => v.id === body.restore);
  if (!version) {
    return NextResponse.json({ error: "Version not found." }, { status: 404 });
  }
  const current = await readSummary(id);
  if (current) await pushHistory(current);

  const restored: SummaryDoc = {
    ...version.doc,
    sessionId: id,
    updatedAt: new Date().toISOString(),
  };
  await writeSummary(restored);
  return NextResponse.json({ summary: restored });
}
