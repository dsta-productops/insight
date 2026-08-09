import type { ModeId } from "@/lib/modes/registry";

export type TranscriptionProvider = "local" | "groq" | "openai";

export type SessionStatus = "live" | "transcribing" | "done" | "error";

export type Speaker = "researcher" | "participant";

export interface TranscriptSegment {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  text: string;
  /** Filled by the post-session speaker-labeling pass (Step 5). */
  speaker?: Speaker;
}

export interface SessionMeta {
  id: string;
  title: string;
  filename: string;
  uploadedAt: string;
  status: SessionStatus;
  provider: TranscriptionProvider;
  /** Conversation mode driving the coach's framing/behavior. Absent = user-research (legacy sessions). */
  mode?: ModeId;
  durationSec?: number;
  error?: string;
}

/**
 * Structured transcript document — the export shape kept deliberately
 * simple/structured so it could later be filed into CLARA.
 */
export interface TranscriptDoc {
  sessionId: string;
  createdAt: string;
  provider: TranscriptionProvider;
  segments: TranscriptSegment[];
  /** ISO timestamp of the last speaker-labeling pass, if any (Step 5). */
  labeledAt?: string;
}
