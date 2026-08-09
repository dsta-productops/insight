import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/paths";
import type { Suggestion } from "./index";

const LOG_DIR = path.join(DATA_DIR, "suggestions");

export interface SuggestionLogEntry {
  at: string;
  /** transcript window the suggestions were generated from */
  query: string;
  provider: string;
  suggestions: Suggestion[];
}

/**
 * Structured per-session suggestion log — like the transcript, kept in an
 * export-friendly shape for a future CLARA integration.
 */
export async function appendSuggestionLog(
  sessionId: string,
  entry: SuggestionLogEntry,
): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `${sessionId}.json`);
  let entries: SuggestionLogEntry[] = [];
  try {
    entries = JSON.parse(await fs.readFile(file, "utf8")) as SuggestionLogEntry[];
  } catch {
    /* new log */
  }
  entries.push(entry);
  await fs.writeFile(file, JSON.stringify(entries, null, 2), "utf8");
}

export async function readSuggestionLog(
  sessionId: string,
): Promise<SuggestionLogEntry[]> {
  try {
    const file = path.join(LOG_DIR, `${sessionId}.json`);
    return JSON.parse(await fs.readFile(file, "utf8")) as SuggestionLogEntry[];
  } catch {
    return [];
  }
}

/** Delete a session's suggestion log, if any (called when a session is removed). */
export async function removeSuggestionLog(sessionId: string): Promise<void> {
  await fs.rm(path.join(LOG_DIR, `${sessionId}.json`), { force: true });
}
