# INSIGHT — Live Research Companion

Insight, generated in-session. INSIGHT supports a researcher **while a user
interview is happening**: near-real-time transcription, glossary/jargon
definitions, document context, and coaching toward better questioning —
closing with a full transcript.

A standalone, **offline** production tool for real user interviews: it runs
fully local so interview content never leaves the machine. Intended to ship as
a single-operator desktop app (Tauri), with no network surface and no
multi-user model, so it deliberately has no login.

> **Security posture:** Because INSIGHT is offline and single-operator, it has
> no authentication by design. The residual concern is **data-at-rest**:
> sessions, transcripts, and audio are stored in plaintext under `data/`, so
> protection relies on device security (OS full-disk encryption + physical
> control of the machine). Do **not** bind the server to a reachable network
> interface — the no-auth assumption holds only while it stays local. See
> `AI_HANDOFF.md`.

## Build — all 5 steps complete

| Step | Scope | Status |
|---|---|---|
| 1 | Static glossary + document upload + retrieval | ✅ |
| 2 | Batch transcription (Whisper) | ✅ |
| 3 | Near-real-time transcription (chunked/polled) | ✅ |
| 4 | Coach logic against the reference corpus | ✅ |
| 5 | End-of-session transcript view/export | ✅ |

What works now:

- **Live Session** — start a session, speak, and watch the transcript grow in
  ~5-second increments while a "live context" panel re-runs retrieval over the
  latest utterances (glossary hits, document context, coach material).
- **Live coach** — every ~30 s the recent transcript window goes through the
  suggestion engine: definitions, document context, and questioning-technique
  nudges (each with a "why"), grounded in the retrieved corpus. Runs on
  **local Ollama** by default (`brew install ollama`, `ollama pull llama3.1:8b`)
  — free, offline, no quota. Set `SUGGEST_PROVIDER=anthropic` (premium) or
  `groq` for hosted alternatives. Low-confidence suggestions are suppressed;
  each live session's suggestion stream is logged to
  `data/suggestions/<id>.json`.
- **Sessions** — upload a recording (`.wav`/`.mp3`/`.m4a`/`.aiff`/…) and get a
  timestamped transcript. Default provider is **local whisper.cpp** (free,
  offline — audio never leaves the machine): `brew install whisper-cpp` and
  place `ggml-base.en.bin` in `data/models/`. Set `TRANSCRIBE_PROVIDER=groq`
  (free tier) or `openai` to use hosted Whisper instead.
- **Documents** — upload `.txt`/`.md` (PRDs, briefs); files are chunked and indexed
- **Glossary** — 16 seeded dummy acronyms/terms, searchable
- **Retrieval Playground** — paste a mock transcript snippet; see glossary
  matches, retrieved document chunks, and coach-corpus excerpts. With an
  Anthropic key set, a "Generate suggestions" button previews the in-session
  suggestion feed (definitions / context / coaching nudges, each with a "why").
- **Coach reference corpus** — full reference documents (method, examples,
  detection patterns) for Five Whys, Laddering, Neutral vs. Leading questions,
  Contrastive Questioning, Critical Incident Technique, Silence Tolerance, and
  Satisficing Detection, already indexed into the RAG store for step 4.

## Setup

```sh
npm install
cp .env.example .env.local   # optional — see below
npm run dev                  # http://localhost:3000
```

Both API keys are optional:

- `OPENAI_API_KEY` — enables vector embeddings (`text-embedding-3-small`).
  Without it, retrieval uses a BM25-style lexical fallback (works offline).
- `ANTHROPIC_API_KEY` — enables suggestion generation (Claude Opus 4.8,
  structured outputs). Without it, the playground shows raw retrieval only.

## Architecture notes

- Next.js 15 App Router; API routes under `app/api/` (documents, glossary,
  retrieve, suggest)
- `lib/rag/` — chunker, embedding provider, JSON-file vector store
  (`data/store.json`), hybrid retrieval
- UI is **PRIZM 4.0, Enterprise zone** (see `CLAUDE.md` for the working rules)
- Transcript and suggestion outputs are kept structured (JSON) so they could
  plausibly export to CLARA later; that integration is explicitly out of scope
