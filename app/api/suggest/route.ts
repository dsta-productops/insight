import { NextRequest, NextResponse } from "next/server";
import {
  activeSuggestProvider,
  generateSuggestions,
} from "@/lib/suggest";
import { appendSuggestionLog } from "@/lib/suggest/log";
import type { ModeId } from "@/lib/modes/registry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    query?: string;
    sessionId?: string;
    exclude?: string[];
    recentTechniques?: string[];
    ephemeral?: boolean;
    mode?: string;
  } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }
  const exclude = Array.isArray(body?.exclude)
    ? body.exclude.filter((e): e is string => typeof e === "string").slice(0, 20)
    : [];
  const recentTechniques = Array.isArray(body?.recentTechniques)
    ? body.recentTechniques.filter((e): e is string => typeof e === "string").slice(-3)
    : [];

  try {
    const provider = activeSuggestProvider();
    const suggestions = await generateSuggestions(
      query,
      exclude,
      recentTechniques,
      body?.mode as ModeId | undefined,
    );

    // Live sessions log their suggestion stream for later review/export.
    // Ephemeral ("don't save") sessions skip the log — nothing hits disk.
    if (body?.sessionId && !body?.ephemeral && suggestions.length > 0) {
      await appendSuggestionLog(body.sessionId, {
        at: new Date().toISOString(),
        query,
        provider,
        suggestions,
      });
    }

    return NextResponse.json({ suggestions, provider });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Suggestion generation failed." },
      { status: 500 },
    );
  }
}
