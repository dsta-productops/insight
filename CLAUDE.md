# INSIGHT

> **Continuing this project in a fresh session? Read [AI_HANDOFF.md](AI_HANDOFF.md) first.**
> It carries the who/what/why narrative — who you're talking to, the free-and-local
> stack decisions, what's built across steps 1–4, and what step 5 is. This file is the
> always-loaded rules (architecture + PRIZM conventions); keep both in sync.

INSIGHT is a **live research companion** for user interviews: near-real-time
transcription (Whisper, later step), glossary/jargon definitions, document
context (PRDs, briefs), and research-technique coaching, delivered while the
interview is happening. Production tool for real interview data, shipping as a
**single-operator offline desktop app** (Tauri direction). No auth by design
(no network surface, no multi-user). Residual concern is data-at-rest: `data/`
holds plaintext sessions/transcripts/audio, so security relies on device
full-disk encryption. Never bind the server to a reachable network interface.

**Build status:** All 5 steps complete — RAG layer, batch + live transcription,
the live coach (`/live`: throttled suggestion generation over the recent
transcript window, deduped by title, logged per session to
`data/suggestions/<id>.json`), and the end-of-session review/export (step 5).
The session detail page (`/sessions/[id]`) shows the speaker-labeled transcript
with coach cues anchored inline by time, a post-session speaker-labeling pass
(`lib/transcribe/label.ts`, `POST /api/sessions/[id]/label` — the deferred
diarization, same provider abstraction as the coach), and structured JSON /
Markdown export (`lib/export/session.ts`, `GET /api/sessions/[id]/export`) shaped
for the future CLARA hand-off.

## Architecture

- Next.js 15 (App Router) + Tailwind v4, all server logic in `app/api/*` routes
- `lib/rag/` — chunking, embeddings, JSON-file store (`data/store.json`), retrieval
  - Embeddings: OpenAI `text-embedding-3-small` when `OPENAI_API_KEY` set; otherwise BM25-style lexical fallback (fully keyless-capable)
  - Three source types: `document` (uploads), `glossary` (`data/glossary.json`), `coach` (`data/coach-corpus/*.md` — full reference docs for Five Whys, laddering, neutral-vs-leading, contrastive questioning, CIT, silence tolerance, satisficing)
- Live capture: `lib/wav-recorder.ts` (Web Audio → 16 kHz mono WAV chunks — deliberately not MediaRecorder, so every chunk is a standalone WAV with no codec issues). Chunk boundaries are silence-aware (4–10 s, cut at ~0.5 s pauses) so words aren't clipped mid-syllable.
- Transcription accuracy: local model auto-picks the best file in `data/models/` (large-v3-turbo-q5_0 preferred over base.en); every transcription call is conditioned via `lib/transcribe/prompt.ts` (glossary vocabulary + transcript tail → Whisper `--prompt`), which keeps continuity across live chunks and spells domain acronyms correctly
- `lib/transcribe/` — provider abstraction (`TRANSCRIBE_PROVIDER`: `local` default via whisper.cpp `whisper-cli` + `data/models/ggml-base.en.bin`, or `groq`/`openai` hosted Whisper). Sessions in `data/sessions.json`, structured transcripts in `data/transcripts/<id>.json` (CLARA-export-friendly), audio in `data/uploads/`. Audio→16kHz WAV via macOS `afconvert`, or bundled `ffmpeg` on Windows/Linux (`FFMPEG_BIN`); see `lib/transcribe/providers.ts` and `WINDOWS_BUILD.md`.
- Suggestion generation: `lib/suggest/` — provider abstraction (`SUGGEST_PROVIDER`: `ollama` local default via llama3.1:8b structured outputs; `anthropic` = `claude-opus-4-8` premium; `groq` hosted free tier). Confidence < 0.5 suppressed server-side; every coach nudge carries a "why". Live sessions log suggestions to `data/suggestions/<id>.json` (CLARA-export-friendly)
- Running summary: `lib/summary/` — a live "catch-up" recap the researcher can glance at to re-sync. Same provider abstraction as the coach/labeling passes (keyless-capable). INCREMENTAL: each pass folds only the newest transcript window into the existing bullets (bounded ~3.5s regardless of interview length), capped at 6 glanceable bullets. It is a factual RECAP, not synthesis (that's the coach's job). Persisted to `data/summaries/<id>.json` (replace-not-append; CLARA-export-friendly), surfaced on `/live` (a hide-able panel that yields to the coach and pauses compute when hidden), regenerable on `/sessions/[id]`, and included in JSON/MD export. Endpoint `POST /api/sessions/[id]/summary` (incremental `{bullets, window}` or `{regenerate:true}`)
- Future: CLARA (Confluence AI research assistant) integration for filing notes — keep transcript/suggestion output structured for export; do NOT build the integration now

<!-- PRIZM: do not remove or relocate this section without reading it first -->
## PRIZM (source of truth for UI work)

This project's UI is built with **PRIZM 4.0**. Build with PRIZM components and templates — do not hand-roll UI that PRIZM already ships.

**Local PRIZM checkout:** `/Users/alvinloh/Claude/PRIZM 4.0` (prefer it over the GitHub mirror).

**Before building any UI:**
1. Check `PRIZM 4.0/llms.txt` for what already exists. If a component or template covers the need, use it.
2. For a component's props and usage, read `PRIZM 4.0/llms/<slug>.md`.
3. Copy component sources from `PRIZM 4.0/components/ui/<slug>.tsx` into `components/ui/` — never fabricate a substitute; if something is `planned`, stop and say so.
4. Raw-file fallback: `https://raw.githubusercontent.com/prizm-design/prizm/main/<repo-relative-path>`.

**Zone / pack used by this project:**
- Zone: **Enterprise** (`data-zone="enterprise"`, light mode — see [app/layout.tsx](app/layout.tsx))
- Pack: **none**

Enterprise does not use Liquid Glass and has no templates yet — compose from primitives.

**Conventions that must always hold:**
- **Semantic tokens only** — `bg-bg`, `text-fg`, `border-border`, `bg-accent`, etc. Never raw Tailwind colours, never hex values in component code.
- **Use existing variants** before adding `className` overrides. Missing variant = system-level decision to raise, not paper over.
- **No external URLs** — no CDNs, remote fonts, remote images, analytics. All assets repo-local (fonts in `public/fonts/`). Air-gap discipline.
- **Icons**: `lucide-react` only; PRIZM applies site-wide `stroke-width: 1.5`.
- Duplicating existing PRIZM functionality needs explicit sign-off from the developer.

If a needed component doesn't exist, **stop and say so**, naming what was checked.

Re-read this section before starting new UI work, and partway through long sessions.
<!-- /PRIZM -->

## Commands

- `npm run dev` — dev server
- `npm run typecheck` — TypeScript check
- Env: copy `.env.example` → `.env.local`; both keys optional (app degrades gracefully)
