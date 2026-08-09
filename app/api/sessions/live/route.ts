import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { activeProvider } from "@/lib/transcribe/providers";
import { addSession } from "@/lib/transcribe/sessions";
import { preventSleep } from "@/lib/keep-awake";
import type { SessionMeta } from "@/lib/transcribe/types";
import { DEFAULT_MODE, isAvailableMode, type ModeId } from "@/lib/modes/registry";

export const runtime = "nodejs";

/** Start a live session. Audio chunks are then POSTed to /api/sessions/live/[id]. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    title?: string;
    mode?: string;
    ephemeral?: boolean;
  } | null;
  // Only accept a built, selectable mode; anything else falls back to the default
  // so a stale/coming-soon id can never start a session in an unsupported mode.
  const mode: ModeId = isAvailableMode(body?.mode) ? (body!.mode as ModeId) : DEFAULT_MODE;
  const meta: SessionMeta = {
    id: randomUUID(),
    title: body?.title?.trim() || `Live session ${new Date().toLocaleString()}`,
    filename: "(live microphone)",
    uploadedAt: new Date().toISOString(),
    status: "live",
    provider: activeProvider(),
    mode,
  };
  // Ephemeral ("don't save") sessions never touch disk: the id lives only in the
  // client for the duration of the session, and the chunk/suggest/summary/audio
  // routes are told (by the client) to skip every write. So we do NOT persist the
  // session metadata here either — nothing is saved, nothing to clean up.
  if (!body?.ephemeral) {
    await addSession(meta);
  }
  // Keep the Mac awake for the duration of the recording (released on PATCH end,
  // or automatically if the server process dies).
  preventSleep();
  return NextResponse.json({ session: meta }, { status: 201 });
}
