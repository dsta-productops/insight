import { NextRequest, NextResponse } from "next/server";
import { retrieve } from "@/lib/rag/retrieve";
import { ensureStaticSourcesIndexed } from "@/lib/rag/sources";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }

  try {
    await ensureStaticSourcesIndexed();
    const result = await retrieve(query);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Retrieval failed." },
      { status: 500 },
    );
  }
}
