import path from "path";

/**
 * Filesystem roots for the app's data. Split so the same code runs both under
 * `npm run dev` and inside a packaged desktop bundle:
 *
 * - DATA_DIR   — WRITABLE user data (sessions, transcripts, audio, suggestion
 *                logs, the RAG store, and the working glossary). In a packaged
 *                app this must live in a user-writable location (e.g. the OS
 *                app-data dir), NOT inside the read-only app bundle.
 * - ASSETS_DIR — READ-ONLY assets shipped with the app (whisper models, the
 *                coach corpus, the seed glossary). In a packaged app these are
 *                bundled resources; the app never writes here.
 *
 * Both default to `<cwd>/data`, so `npm run dev` behaves exactly as before
 * (the split is a no-op locally). The desktop packaging overrides them via
 * INSIGHT_DATA_DIR / INSIGHT_ASSETS_DIR.
 */
export const DATA_DIR =
  process.env.INSIGHT_DATA_DIR ?? path.join(process.cwd(), "data");

export const ASSETS_DIR =
  process.env.INSIGHT_ASSETS_DIR ?? path.join(process.cwd(), "data");
