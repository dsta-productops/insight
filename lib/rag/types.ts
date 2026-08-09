export type SourceType = "document" | "glossary" | "coach";

export interface Chunk {
  id: string;
  sourceType: SourceType;
  /** Document id, glossary term, or coach technique slug */
  sourceId: string;
  /** Human-readable label, e.g. filename or term */
  sourceLabel: string;
  text: string;
  /** Present only when an embedding provider is configured */
  embedding?: number[];
}

export interface DocumentMeta {
  id: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
  bytes: number;
  /** Extracted plain text, for in-app viewing. Omitted from list responses. */
  text?: string;
}

export interface GlossaryEntry {
  term: string;
  /** Required: the full form (e.g. "Product Requirements Document"). */
  expansion: string;
  /** Optional prose meaning; when absent, the expansion stands in for it. */
  definition?: string;
  tags?: string[];
}

export interface RetrievalHit {
  chunk: Omit<Chunk, "embedding">;
  score: number;
  method: "vector" | "lexical";
}
