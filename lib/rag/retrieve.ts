import { cosine, embed } from "./embeddings";
import { readStore } from "./store";
import type { Chunk, GlossaryEntry, RetrievalHit } from "./types";
import { getGlossary } from "./sources";

/** BM25-ish lexical scoring — the keyless fallback when no embedding provider is configured. */
function lexicalScores(query: string, chunks: Chunk[]): number[] {
  const qTerms = tokenize(query);
  const docs = chunks.map((c) => tokenize(c.text));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;

  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of new Set(qTerms)) {
      const f = tf.get(q);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen));
    }
    return score;
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export interface RetrievalResult {
  glossaryMatches: GlossaryEntry[];
  hits: RetrievalHit[];
  method: "vector" | "lexical";
}

/**
 * Retrieve context relevant to a transcript snippet:
 * 1. Exact/word-boundary glossary term matching (acronyms surface reliably)
 * 2. Semantic or lexical retrieval over document + coach-corpus chunks
 */
export async function retrieve(
  query: string,
  topK = 6,
): Promise<RetrievalResult> {
  const [store, glossary] = await Promise.all([readStore(), getGlossary()]);

  // 1. Direct glossary term matches against the snippet
  const glossaryMatches = glossary.filter((g) =>
    new RegExp(`\\b${escapeRegExp(g.term)}\\b`, "i").test(query),
  );

  // 2. Ranked retrieval over all chunks
  const chunks = store.chunks;
  if (chunks.length === 0) {
    return { glossaryMatches, hits: [], method: "lexical" };
  }

  let scores: number[];
  let method: "vector" | "lexical" = "lexical";

  const allEmbedded = chunks.every((c) => c.embedding);
  if (allEmbedded) {
    const q = await embed([query]);
    if (q) {
      scores = chunks.map((c) => cosine(q[0], c.embedding!));
      method = "vector";
    } else {
      scores = lexicalScores(query, chunks);
    }
  } else {
    scores = lexicalScores(query, chunks);
  }

  const hits: RetrievalHit[] = chunks
    .map((c, i) => ({
      chunk: {
        id: c.id,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        sourceLabel: c.sourceLabel,
        text: c.text,
      },
      score: scores[i],
      method,
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { glossaryMatches, hits, method };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
