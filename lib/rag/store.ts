import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/paths";
import type { Chunk, DocumentMeta } from "./types";

const STORE_PATH = path.join(DATA_DIR, "store.json");

interface StoreShape {
  documents: DocumentMeta[];
  chunks: Chunk[];
}

const EMPTY: StoreShape = { documents: [], chunks: [] };

export async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store), "utf8");
}

export async function addDocument(
  meta: DocumentMeta,
  chunks: Chunk[],
): Promise<void> {
  const store = await readStore();
  store.documents.push(meta);
  store.chunks.push(...chunks);
  await writeStore(store);
}

/**
 * Remove one or more documents (and their chunks) in a single atomic
 * read-modify-write of store.json. Batching keeps the shared file safe from the
 * last-write-wins race that separate per-id writes would hit. Returns the count
 * actually removed.
 */
export async function removeDocuments(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const remove = new Set(ids);
  const store = await readStore();
  const before = store.documents.length;
  store.documents = store.documents.filter((d) => !remove.has(d.id));
  store.chunks = store.chunks.filter(
    (c) => !(c.sourceType === "document" && remove.has(c.sourceId)),
  );
  const removed = before - store.documents.length;
  if (removed > 0) await writeStore(store);
  return removed;
}

/** Replace all chunks of a given source type (used for glossary/coach re-indexing). */
export async function replaceSourceChunks(
  sourceType: Chunk["sourceType"],
  chunks: Chunk[],
): Promise<void> {
  const store = await readStore();
  store.chunks = store.chunks.filter((c) => c.sourceType !== sourceType);
  store.chunks.push(...chunks);
  await writeStore(store);
}
