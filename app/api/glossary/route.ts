import { NextRequest, NextResponse } from "next/server";
import {
  getGlossary,
  removeGlossaryEntry,
  upsertGlossaryEntry,
} from "@/lib/rag/sources";
import type { GlossaryEntry } from "@/lib/rag/types";

export const runtime = "nodejs";

export async function GET() {
  const glossary = await getGlossary();
  return NextResponse.json({ glossary });
}

/** Add or update a glossary term (upsert by term), then reindex for retrieval. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const term = typeof body?.term === "string" ? body.term.trim() : "";
  const definition =
    typeof body?.definition === "string" ? body.definition.trim() : "";
  const expansion =
    typeof body?.expansion === "string" ? body.expansion.trim() : "";
  const tags: string[] = Array.isArray(body?.tags)
    ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
    : typeof body?.tags === "string"
      ? body.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
      : [];

  if (!term) {
    return NextResponse.json({ error: "Term is required." }, { status: 400 });
  }
  if (!expansion) {
    return NextResponse.json({ error: "Expansion is required." }, { status: 400 });
  }

  const entry: GlossaryEntry = {
    term,
    expansion,
    ...(definition ? { definition } : {}),
    ...(tags.length ? { tags } : {}),
  };
  const glossary = await upsertGlossaryEntry(entry);
  return NextResponse.json({ glossary, entry }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const term = req.nextUrl.searchParams.get("term");
  if (!term) {
    return NextResponse.json({ error: "Missing term." }, { status: 400 });
  }
  const removed = await removeGlossaryEntry(term);
  if (!removed) {
    return NextResponse.json({ error: "Term not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
