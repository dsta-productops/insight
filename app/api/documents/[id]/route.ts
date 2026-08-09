import { NextResponse } from "next/server";
import { readStore } from "@/lib/rag/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = await readStore();
  const doc = store.documents.find((d) => d.id === id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  // Documents uploaded before text was persisted have no `text` field; fall
  // back to reconstructing it from their stored chunks (in insertion order).
  const text =
    doc.text ??
    store.chunks
      .filter((c) => c.sourceType === "document" && c.sourceId === id)
      .map((c) => c.text)
      .join("\n\n");
  return NextResponse.json({ document: { ...doc, text } });
}
