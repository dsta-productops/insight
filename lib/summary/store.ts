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
}
