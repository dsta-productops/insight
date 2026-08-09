import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { chunkText } from "@/lib/rag/chunk";
import { extractText } from "@/lib/rag/extract";
import { attachEmbeddings } from "@/lib/rag/sources";
import { addDocument, readStore, removeDocuments } from "@/lib/rag/store";
import type { Chunk } from "@/lib/rag/types";

export const runtime = "nodejs";

const ACCEPTED = [".txt", ".md", ".markdown", ".pdf"];
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET() {
  const store = await readStore();
  // Keep the extracted text out of the list payload; fetch it per-document.
  const documents = store.documents.map(({ text: _text, ...meta }) => meta);
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type. Accepted: ${ACCEPTED.join(", ")}.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 2 MB limit." }, { status: 400 });
  }

  let text: string;
  try {
    text = await extractText(file, ext);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read file: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }
  const pieces = chunkText(text);
  if (pieces.length === 0) {
    return NextResponse.json(
      { error: "No extractable text found (scanned or empty file?)." },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const chunks: Chunk[] = pieces.map((p) => ({
    id: randomUUID(),
    sourceType: "document",
    sourceId: id,
    sourceLabel: file.name,
    text: p,
  }));

  try {
    await attachEmbeddings(chunks);
  } catch (e) {
    return NextResponse.json(
      { error: `Embedding failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const meta = {
    id,
    filename: file.name,
    uploadedAt: new Date().toISOString(),
    chunkCount: chunks.length,
    bytes: file.size,
    text,
  };
  await addDocument(meta, chunks);
  const { text: _text, ...listMeta } = meta;
  return NextResponse.json({ document: listMeta }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const ids = req.nextUrl.searchParams.getAll("id");
  if (ids.length === 0) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  const removed = await removeDocuments(ids);
  if (removed === 0) {
    return NextResponse.json({ error: "No matching documents." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, removed });
}
