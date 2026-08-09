// Import the library entry directly to avoid pdf-parse's index.js debug block,
// which reads a bundled test PDF at import time and breaks under bundlers.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * Extract plain text from an uploaded file by extension. Supports plain text,
 * Markdown, and PDF. PDFs are parsed locally (no network); page text is
 * concatenated in reading order.
 */
export async function extractText(
  file: File,
  ext: string,
): Promise<string> {
  if (ext === ".pdf") {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return file.text();
}
