const TARGET = 900; // chars per chunk
const OVERLAP = 150;

/**
 * Paragraph-aware chunking: packs whole paragraphs up to ~TARGET chars,
 * splitting oversized paragraphs on sentence boundaries with overlap.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > TARGET) {
      flush();
      for (const piece of splitLong(para)) chunks.push(piece);
      continue;
    }
    if (current.length + para.length + 2 > TARGET) flush();
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();

  return chunks;
}

function splitLong(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > TARGET && current) {
      out.push(current.trim());
      current = current.slice(-OVERLAP) + s;
    } else {
      current += s;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
