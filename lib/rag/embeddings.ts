/**
 * Embedding provider: OpenAI text-embedding-3-small when OPENAI_API_KEY is
 * set (Whisper integration in step 2 uses the same key), otherwise null and
 * retrieval falls back to lexical scoring.
 */

const MODEL = "text-embedding-3-small";

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || texts.length === 0) return null;

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  const out: number[][] = new Array(texts.length);
  for (const d of json.data) out[d.index] = d.embedding;
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
