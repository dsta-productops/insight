import { NextRequest, NextResponse } from "next/server";
import { getSession, readTranscript } from "@/lib/transcribe/sessions";
import { readSuggestionLog } from "@/lib/suggest/log";
import { readSummary } from "@/lib/summary/store";
import { buildSessionExport, toMarkdown } from "@/lib/export/session";

export const runtime = "nodejs";

/** GET ?format=json|md — download the session as a structured file. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = (req.nextUrl.searchParams.get("format") ?? "json").toLowerCase();

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const [transcript, suggestions, summary] = await Promise.all([
    readTranscript(id),
    readSuggestionLog(id),
    readSummary(id),
  ]);
  const data = buildSessionExport(session, transcript, suggestions, summary);

  const slug =
    session.title.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() ||
    id;

  if (format === "md" || format === "markdown") {
    return new NextResponse(toMarkdown(data), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.md"`,
      },
    });
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.json"`,
    },
  });
}
