import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/paths";
import { removeSuggestionLog } from "@/lib/suggest/log";
import { removeSummary } from "@/lib/summary/store";
import type { SessionMeta, TranscriptDoc } from "./types";

const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
const TRANSCRIPTS_DIR = path.join(DATA_DIR, "transcripts");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

export async function listSessions(): Promise<SessionMeta[]> {
  try {
    const raw = await fs.readFile(SESSIONS_PATH, "utf8");
    return JSON.parse(raw) as SessionMeta[];
  } catch {
    return [];
  }
}

async function writeSessions(sessions: SessionMeta[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_PATH, JSON.stringify(sessions, null, 2), "utf8");
}

export async function addSession(meta: SessionMeta): Promise<void> {
  const sessions = await listSessions();
  sessions.unshift(meta);
  await writeSessions(sessions);
}

export async function updateSession(
  id: string,
  patch: Partial<SessionMeta>,
): Promise<void> {
  const sessions = await listSessions();
  const i = sessions.findIndex((s) => s.id === id);
  if (i === -1) return;
  sessions[i] = { ...sessions[i], ...patch };
  await writeSessions(sessions);
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const sessions = await listSessions();
  return sessions.find((s) => s.id === id) ?? null;
}

/**
 * Remove one or more sessions in a single atomic read-modify-write of
 * sessions.json, then clean up each removed session's transcript and audio.
 * Batching the metadata write is essential: deleting ids concurrently with
 * separate read-modify-write cycles races on the shared file (last write wins),
 * so only one deletion would survive. Returns the number actually removed.
 */
export async function removeSessions(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const remove = new Set(ids);
  const sessions = await listSessions();
  const next = sessions.filter((s) => !remove.has(s.id));
  const removedIds = sessions.filter((s) => remove.has(s.id)).map((s) => s.id);
  if (removedIds.length === 0) return 0;
  await writeSessions(next);

  const uploads = await fs.readdir(UPLOADS_DIR).catch(() => []);
  for (const id of removedIds) {
    await fs.rm(transcriptPath(id), { force: true });
    await removeSuggestionLog(id);
    await removeSummary(id);
    for (const f of uploads) {
      if (f.startsWith(id)) await fs.rm(path.join(UPLOADS_DIR, f), { force: true });
    }
  }
  return removedIds.length;
}

/** The saved audio file for a session (`<id>.<ext>` in uploads), if any. */
export async function findAudioFile(id: string): Promise<string | null> {
  const files = await fs.readdir(UPLOADS_DIR).catch(() => []);
  const match = files.find((f) => f.startsWith(`${id}.`));
  return match ? path.join(UPLOADS_DIR, match) : null;
}

/** Persist a live session's full recording as `<id>.wav` in uploads. */
export async function saveLiveAudio(id: string, data: Buffer): Promise<string> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const audioPath = path.join(UPLOADS_DIR, `${id}.wav`);
  await fs.writeFile(audioPath, data);
  return audioPath;
}

function transcriptPath(id: string): string {
  return path.join(TRANSCRIPTS_DIR, `${id}.json`);
}

export async function saveTranscript(doc: TranscriptDoc): Promise<void> {
  await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });
  await fs.writeFile(transcriptPath(doc.sessionId), JSON.stringify(doc, null, 2), "utf8");
}

/** Append segments to a (live) session's transcript, creating it if needed. */
export async function appendSegments(
  sessionId: string,
  provider: TranscriptDoc["provider"],
  segments: TranscriptDoc["segments"],
): Promise<TranscriptDoc> {
  const existing = await readTranscript(sessionId);
  const doc: TranscriptDoc = existing ?? {
    sessionId,
    createdAt: new Date().toISOString(),
    provider,
    segments: [],
  };
  doc.segments.push(...segments);
  doc.segments.sort((a, b) => a.start - b.start);
  // Reconcile overlapping timestamps. Whisper occasionally emits a segment that
  // spans far longer than its audio chunk (a ~30s "super-segment"), whose end
  // then overlaps the following segments — which corrupts the time-anchoring of
  // coach cues in the review/export view and double-covers the timeline. Clamp
  // each segment's end so it never runs past the next segment's start (text is
  // kept; only the stray end is trimmed to keep the timeline monotonic).
  for (let i = 0; i < doc.segments.length - 1; i++) {
    const next = doc.segments[i + 1];
    if (doc.segments[i].end > next.start) {
      doc.segments[i].end = Math.max(doc.segments[i].start, next.start);
    }
  }
  await saveTranscript(doc);
  return doc;
}

export async function readTranscript(id: string): Promise<TranscriptDoc | null> {
  try {
    const raw = await fs.readFile(transcriptPath(id), "utf8");
    return JSON.parse(raw) as TranscriptDoc;
  } catch {
    return null;
  }
}
