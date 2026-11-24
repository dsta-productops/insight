import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/paths";
import type { SummaryDoc } from "./index";

const SUMMARY_DIR = path.join(DATA_DIR, "summaries");

/**
 * Per-session running summary — the current state, kept in an export-friendly
 * shape for a future CLARA integration. Unlike the suggestion log this is a
 * REPLACE, not an append: the summary is a single tight running list, so each
 * update overwrites the last.
 */
export async function writeSummary(doc: SummaryDoc): Promise<void> {
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SUMMARY_DIR, `${doc.sessionId}.json`),
    JSON.stringify(doc, null, 2),
    "utf8",
  );
}

export async function readSummary(sessionId: string): Promise<SummaryDoc | null> {
  try {
    const file = path.join(SUMMARY_DIR, `${sessionId}.json`);
    return JSON.parse(await fs.readFile(file, "utf8")) as SummaryDoc;
  } catch {
    return null;
  }
}

/** Delete a session's summary, if any (called when a session is removed). */
export async function removeSummary(sessionId: string): Promise<void> {
  await fs.rm(path.join(SUMMARY_DIR, `${sessionId}.json`), { force: true });
  await fs.rm(historyFile(sessionId), { force: true });
}

/**
 * Prior versions of a session's recap, newest first. A version is saved here
 * just before the current recap is replaced (regenerated, hand-edited, or
 * restored), so nothing is lost and versions can be compared. Kept in a
 * separate file so summaries/<id>.json stays the single "current" doc.
 */
export interface RecapVersion {
  /** Stable id for restore requests. */
  id: string;
  /** When this version was set aside (ISO). */
  savedAt: string;
  /** The recap as it was. */
  doc: SummaryDoc;
}

const MAX_VERSIONS = 10;

function historyFile(sessionId: string): string {
  return path.join(SUMMARY_DIR, `${sessionId}.history.json`);
}

export async function readHistory(sessionId: string): Promise<RecapVersion[]> {
  try {
    const v = JSON.parse(await fs.readFile(historyFile(sessionId), "utf8"));
    return Array.isArray(v) ? (v as RecapVersion[]) : [];
  } catch {
    return [];
  }
}

/** Set `doc` aside as a version. No-op for a recap with nothing in it. */
export async function pushHistory(doc: SummaryDoc): Promise<void> {
  if (!doc.sections?.length && doc.bullets.length === 0) return;
  const history = await readHistory(doc.sessionId);
  history.unshift({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    savedAt: new Date().toISOString(),
    doc,
  });
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    historyFile(doc.sessionId),
    JSON.stringify(history.slice(0, MAX_VERSIONS), null, 2),
    "utf8",
  );
}
