import { getGlossary } from "@/lib/rag/sources";
import { readTranscript } from "./sessions";

/**
 * Default Singapore vocabulary that Whisper otherwise mis-hears (agencies,
 * schemes, products, places, institutions) — seeded into every session's
 * conditioning prompt so local proper nouns transcribe correctly even before
 * the operator loads a topic glossary. Session-specific names (people, project
 * jargon) should still be added to the glossary. Kept focused so it fits
 * Whisper's ~224-token prompt window alongside the transcript tail.
 */
const SG_PRIMING_TERMS = [
  "SingPass", "CPF", "HDB", "MediShield Life", "Integrated Shield Plan", "CareShield",
  "MOH", "MOE", "MSF", "MINDEF", "MHA", "LTA", "URA", "IMDA", "GovTech", "CDC",
  "SkillsFuture", "CDAC", "ICA", "SPF", "SCDF", "NEA",
  "DBS", "OCBC", "UOB", "Grab", "Carousell", "Shopee", "Singtel", "NTUC", "FairPrice",
  "NUS", "NTU", "SMU", "SUTD", "polytechnic", "Junior College", "ITE",
  "kopitiam", "hawker centre", "void deck",
];

/**
 * Build a Whisper conditioning prompt: the glossary vocabulary (so domain
 * acronyms transcribe correctly) plus the tail of the transcript so far (so
 * chunk N is decoded with the context of chunk N-1). Whisper only reads the
 * last ~224 tokens of a prompt, so keep it compact — vocabulary first,
 * transcript tail last (the tail matters most, and Whisper reads from the end).
 */
export async function buildWhisperPrompt(sessionId?: string): Promise<string> {
  const glossary = await getGlossary().catch(() => []);
  // Seed BOTH the term and its expansion so Whisper is primed on full names,
  // not just acronyms — e.g. "Integrated Shield Plan", "SingPass", a minister's
  // name — which is where transcription most often mis-hears (proper nouns and
  // domain terms). Only helps for terms actually present in the glossary, so a
  // topic glossary should be loaded before the session.
  // Default SG terms first, then the (session-relevant) glossary terms last so
  // they sit closest to the transcript tail Whisper weights most heavily.
  const vocab = [
    ...new Set([
      ...SG_PRIMING_TERMS,
      ...glossary.flatMap((g) => [g.term, g.expansion]).filter(Boolean),
    ]),
  ].join(", ");

  let tail = "";
  if (sessionId) {
    const doc = await readTranscript(sessionId);
    if (doc?.segments.length) {
      tail = doc.segments
        .slice(-4)
        .map((s) => s.text)
        .join(" ")
        .slice(-300);
    }
  }

  return [vocab && `Vocabulary: ${vocab}.`, tail].filter(Boolean).join(" ");
}
