import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { chunkText } from "./chunk";
import { embed, embeddingsEnabled } from "./embeddings";
import { readStore, replaceSourceChunks } from "./store";
import { ASSETS_DIR, DATA_DIR } from "@/lib/paths";
import type { Chunk, GlossaryEntry } from "./types";

// Working (user-editable) glossary lives in writable DATA_DIR; the bundled seed
// ships read-only in ASSETS_DIR. First read falls back to the seed; the first
// add/remove materializes the working copy. In dev the two dirs coincide, so
// this is a no-op and behaves exactly as before.
const GLOSSARY_PATH = path.join(DATA_DIR, "glossary.json");
const GLOSSARY_SEED_PATH = path.join(ASSETS_DIR, "glossary.json");

export async function getGlossary(): Promise<GlossaryEntry[]> {
  for (const p of [GLOSSARY_PATH, GLOSSARY_SEED_PATH]) {
    try {
      return JSON.parse(await fs.readFile(p, "utf8")) as GlossaryEntry[];
    } catch {
      /* try the seed, then give up */
    }
  }
  return [];
}

async function writeGlossary(entries: GlossaryEntry[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(GLOSSARY_PATH, JSON.stringify(entries, null, 2), "utf8");
}

/** Rebuild the store's glossary chunks from the given entries (keeps live
 *  retrieval in sync after a term is added or removed). */
export async function reindexGlossary(glossary: GlossaryEntry[]): Promise<void> {
  const chunks: Chunk[] = glossary.map((g) => ({
    id: randomUUID(),
    sourceType: "glossary",
    sourceId: g.term,
    sourceLabel: g.term,
    text: `${g.term}${g.expansion ? ` (${g.expansion})` : ""}${g.definition ? `: ${g.definition}` : ""}`,
  }));
  await attachEmbeddings(chunks);
  await replaceSourceChunks("glossary", chunks);
}

/** Add or replace a glossary entry (matched case-insensitively by term), keep
 *  the list sorted, then reindex. Returns the updated glossary. */
export async function upsertGlossaryEntry(
  entry: GlossaryEntry,
): Promise<GlossaryEntry[]> {
  const glossary = await getGlossary();
  const i = glossary.findIndex(
    (g) => g.term.toLowerCase() === entry.term.toLowerCase(),
  );
  if (i === -1) glossary.push(entry);
  else glossary[i] = entry;
  glossary.sort((a, b) => a.term.localeCompare(b.term));
  await writeGlossary(glossary);
  await reindexGlossary(glossary);
  return glossary;
}

/** Remove a glossary entry by term (case-insensitive), then reindex. */
export async function removeGlossaryEntry(term: string): Promise<boolean> {
  const glossary = await getGlossary();
  const next = glossary.filter(
    (g) => g.term.toLowerCase() !== term.toLowerCase(),
  );
  if (next.length === glossary.length) return false;
  await writeGlossary(next);
  await reindexGlossary(next);
  return true;
}

/**
 * Ensure the static sources (glossary entries + coach reference corpus) are
 * indexed into the chunk store. Runs lazily on first retrieval-related
 * request; re-runs only when the store has no chunks for a source, or when
 * embeddings became available and stored chunks lack them.
 */
export async function ensureStaticSourcesIndexed(): Promise<void> {
  const store = await readStore();
  const wantEmbeddings = embeddingsEnabled();

  const needsReindex = (type: Chunk["sourceType"]) => {
    const existing = store.chunks.filter((c) => c.sourceType === type);
    if (existing.length === 0) return true;
    if (wantEmbeddings && existing.some((c) => !c.embedding)) return true;
    return false;
  };

  if (needsReindex("glossary")) {
    await reindexGlossary(await getGlossary());
  }

  if (needsReindex("coach")) {
    const corpusDir = path.join(ASSETS_DIR, "coach-corpus");
    const files = (await fs.readdir(corpusDir)).filter((f) => f.endsWith(".md"));
    const chunks: Chunk[] = [];
    for (const file of files) {
      const text = await fs.readFile(path.join(corpusDir, file), "utf8");
      const label = file.replace(/\.md$/, "");
      for (const piece of chunkText(text)) {
        chunks.push({
          id: randomUUID(),
          sourceType: "coach",
          sourceId: label,
          sourceLabel: label,
          text: piece,
        });
      }
    }
    await attachEmbeddings(chunks);
    await replaceSourceChunks("coach", chunks);
  }
}

export async function attachEmbeddings(chunks: Chunk[]): Promise<void> {
  if (!embeddingsEnabled() || chunks.length === 0) return;
  const vectors = await embed(chunks.map((c) => c.text));
  if (!vectors) return;
  chunks.forEach((c, i) => {
    c.embedding = vectors[i];
  });
}
