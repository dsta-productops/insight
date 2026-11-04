"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import NextLink from "next/link";
import {
  BookPlus,
  Briefcase,
  ChevronDown,
  CircleStop,
  Clock,
  Eye,
  EyeOff,
  FileUp,
  ListChecks,
  MessageCircle,
  MessageSquareQuote,
  Mic,
  Presentation,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Heading } from "@/components/ui/heading";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { WavRecorder, type WavChunk } from "@/lib/wav-recorder";
import { useImmersive } from "@/components/app-shell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_MODE, getMode, isAvailableMode, modesByFamily, type ModeId } from "@/lib/modes/registry";
import { cn, stripListMarker } from "@/lib/utils";

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface GlossaryEntry {
  term: string;
  expansion: string;
  definition?: string;
}

interface Suggestion {
  type: "definition" | "context" | "coach" | "respond";
  title: string;
  body: string;
  ask: string;
  why: string;
  source: string;
  confidence: number;
}

/**
 * Minimum gap between coach calls. A warm 8B pass generates ~85 output tokens
 * in ~4 s (generation, not prompt-eval, dominates once the model is pinned), so
 * an 8 s floor keeps passes from overlapping while surfacing nudges quickly.
 * The anti-repeat filter drops passes that re-cover ground, so a tight interval
 * makes the *right* nudge appear sooner rather than churning the Now card.
 */
const SUGGEST_INTERVAL_MS = 8000;

/**
 * Require at least this many NEW transcript segments since the last coach pass
 * before firing again. Consecutive passes over a barely-changed window produced
 * near-duplicate suggestions (the main repetition complaint); waiting for a few
 * new lines means each pass sees materially fresh content. Tunable.
 */
const MIN_NEW_SEGMENTS = 3;

/**
 * Running-summary cadence. Deliberately far slower than the coach: a recap only
 * needs to feel current, not timely. Each tick folds ONE incremental window and
 * yields to the coach (skips if a coach pass is in flight).
 *
 * Set to 90 s (was 45 s). The coach and summary share ONE local model + GPU, so
 * a more frequent summary measurably taxed the coach: direct contention when
 * passes overlap (coach ~2.7 s -> ~5.4 s, measured) AND eviction of the coach's
 * warm prompt from the shared llama.cpp KV cache. Halving the frequency roughly
 * halves that tax; a catch-up recap does not need to be fresher than this. Paired
 * with a trimmed summary SYSTEM prompt (see lib/summary) to shrink cache
 * pressure. Hiding the panel pauses this loop entirely (zero cost when off).
 */
const SUMMARY_INTERVAL_MS = 90000;

/**
 * Hard cap on how many recent transcript segments one summary pass folds. Normal
 * 90s cadence yields a small window; this only bites after a long Hide (or coach
 * starvation) when the un-summarized gap is huge — without it, one catch-up pass
 * would send minutes of transcript, slowing the pass and risking a context
 * overflow on the local model. We then catch up on the RECENT state (older
 * bullets persist), which is what a "where are we now" recap wants anyway.
 */
const SUMMARY_MAX_WINDOW_SEGMENTS = 40;

/**
 * Cap how many transcript lines the LIVE feed renders. The full transcript is
 * always saved and shown on /sessions/[id]; the live strip only needs recent
 * context. Without this the DOM grows unbounded over a multi-hour interview and
 * every new chunk re-renders the whole list, which is the main thing that would
 * make a long session feel sluggish. Recent lines are all the researcher glances
 * at anyway.
 */
const MAX_VISIBLE_SEGMENTS = 200;

const TYPE_BADGE: Record<Suggestion["type"], "success" | "subtle" | "info" | "warning"> = {
  coach: "success",
  definition: "subtle",
  context: "info",
  respond: "warning",
};

/**
 * How many suggestions the "Earlier suggestions" list retains. Set high enough
 * to hold a full session so the live view matches the post-session review (which
 * shows the whole logged stream) — the earlier list is collapsed by default and
 * scrolls internally, so a large list costs nothing until expanded. At the ~15s
 * coach cadence this covers well over a two-hour interview.
 */
const MAX_HISTORY = 1000;

/** Per-mode glyph for the picker (kept in the UI layer; the registry stays pure data). */
const MODE_ICONS: Record<ModeId, LucideIcon> = {
  "user-research": MessageCircle,
  "job-interview": Briefcase,
  "table-discussion": UsersRound,
  "panel-moderation": Presentation,
};

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Elapsed session time from milliseconds → "MM:SS", rolling to "H:MM:SS" past an hour. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 3600) return ts(total);
  return `${Math.floor(total / 3600)}:${ts(total % 3600)}`;
}

/**
 * Dedup key for "have I already shown this?". Coach suggestions reuse a small
 * set of generic titles ("Neutralize embedded assumption", "Probe the underlying
 * goal") across genuinely DIFFERENT questions, so keying coach on the title
 * throws away most useful nudges — key it on the actual `ask` instead. Definition
 * and context suggestions still key on the title (the term / document name).
 */
function suggestionKey(s: Suggestion): string {
  return s.type === "coach" && s.ask
    ? `ask:${s.ask.toLowerCase().replace(/\s+/g, " ").trim()}`
    : `title:${s.title.toLowerCase().trim()}`;
}

export default function LivePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  // Elapsed-session timer: startedAt is captured when recording begins; nowTick
  // updates every second while recording so the interviewer always sees the time.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [starting, setStarting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  // Conversation mode chosen at session start (drives the coach's framing).
  // Defaults to the operator's last-used mode (persisted locally) so a frequent
  // mode stays pre-selected; falls back to DEFAULT_MODE. Read after mount to
  // avoid an SSR/hydration mismatch.
  const [mode, setMode] = useState<ModeId>(DEFAULT_MODE);
  useEffect(() => {
    const saved = localStorage.getItem("insight:preferredMode");
    if (saved && isAvailableMode(saved)) setMode(saved as ModeId);
  }, []);
  const chooseMode = useCallback((v: ModeId) => {
    setMode(v);
    try {
      localStorage.setItem("insight:preferredMode", v);
    } catch {
      /* private mode / storage disabled — fall back to session-only */
    }
  }, []);
  // "Don't save": transcription still runs live, but nothing is written to disk.
  const [ephemeral, setEphemeral] = useState(false);
  // The active session's ephemerality, captured at start so async callbacks
  // (chunk/suggest/summary/stop) use the value the session began with.
  const sessionEphemeralRef = useRef(false);
  // Likewise the active session's mode, so the coach loop tags each /api/suggest
  // call with the mode the session began in.
  const sessionModeRef = useRef<ModeId>(DEFAULT_MODE);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [glossaryMatches, setGlossaryMatches] = useState<GlossaryEntry[]>([]);
  const [current, setCurrent] = useState<Suggestion | null>(null);
  const [history, setHistory] = useState<Suggestion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  // Running conversation summary — the catch-up aid (pull, not push).
  const [summaryOn, setSummaryOn] = useState(true);
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const summaryBulletsRef = useRef<string[]>([]);
  const summarizedFrom = useRef(0);
  const lastSummaryAt = useRef(0);
  const summaryInFlight = useRef(false);
  const segmentsRef = useRef<Segment[]>([]);
  const recorderRef = useRef<WavRecorder | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  // Auto-follow the transcript only while the user is at the bottom. Once they
  // scroll up to read an earlier part, stop yanking them back down.
  const stickToBottomRef = useRef(true);
  const lastSuggestAt = useRef(0);
  const suggestedFrom = useRef(0);
  const seenTerms = useRef(new Set<string>());
  const shownAsks = useRef<string[]>([]);
  const recentTechniques = useRef<string[]>([]);
  const suggestInFlight = useRef(false);
  const currentRef = useRef<Suggestion | null>(null);
  const { setImmersive } = useImmersive();

  // While recording, hide the app nav header to give the live view more room.
  // Restored on stop and on leaving the page.
  useEffect(() => {
    setImmersive(recording);
    return () => setImmersive(false);
  }, [recording, setImmersive]);

  // Drive the elapsed-time display: tick once a second while recording.
  useEffect(() => {
    if (!recording || startedAt == null) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [recording, startedAt]);

  /** Insert into history, deduped by suggestion key (safety net against
   *  double-adds); coach items key on the ask so distinct questions all survive. */
  const pushHistory = useCallback((items: Suggestion[]) => {
    setHistory((h) => {
      const merged = [...items, ...h];
      return merged
        .filter(
          (s, i) => merged.findIndex((x) => suggestionKey(x) === suggestionKey(s)) === i,
        )
        .slice(0, MAX_HISTORY);
    });
  }, []);

  /** Newest wins the Now card; whatever was there moves into history. */
  const showNow = useCallback(
    (next: Suggestion) => {
      const prev = currentRef.current;
      currentRef.current = next;
      setCurrent(next);
      if (prev) pushHistory([prev]);
    },
    [pushHistory],
  );

  // Earlier-suggestions list: new items PREPEND to the top, which would shove
  // whatever the researcher is reading downward. When they've scrolled into the
  // list, compensate scrollTop by the height just added so their view stays put
  // (only auto-follows when parked at the top). useLayoutEffect: adjust before
  // paint so there's no visible jump.
  const historyRef = useRef<HTMLDivElement>(null);
  const historyHeightRef = useRef(0);
  useLayoutEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    const added = el.scrollHeight - historyHeightRef.current;
    if (el.scrollTop > 4 && added > 0) el.scrollTop += added;
    historyHeightRef.current = el.scrollHeight;
  }, [history, historyOpen]);

  // Auto-scroll the transcript strip; keep a ref of the latest segments so the
  // summary interval can read them without re-subscribing on every batch.
  useEffect(() => {
    segmentsRef.current = segments;
    // Only follow to the newest line if the user hasn't scrolled up to read.
    // Instant (not smooth) so the programmatic jump lands at the bottom in one
    // step and can't leave an intermediate position that reads as "scrolled up".
    if (stickToBottomRef.current) {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    }
  }, [segments]);

  // Glossary chips: cheap retrieval over the most recent utterances.
  useEffect(() => {
    if (segments.length === 0) return;
    const recent = segments.slice(-6).map((s) => s.text).join(" ");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/retrieve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: recent }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const matches: GlossaryEntry[] = json.glossaryMatches ?? [];
        setGlossaryMatches(matches);

        // First mention of a term → instant definition in the Now card.
        // Deterministic and immediate; doesn't wait for the coach loop.
        for (const g of matches) {
          const key = g.term.toLowerCase();
          if (seenTerms.current.has(key)) continue;
          seenTerms.current.add(key);
          // With no prose definition, surface just the expansion: term as the
          // title, the full form as the body (e.g. PRD -> "Product Requirements
          // Document"). With a definition, keep the expansion in the title.
          const def: Suggestion = {
            type: "definition",
            title: g.definition ? g.term + (g.expansion ? ` (${g.expansion})` : "") : g.term,
            body: g.definition || g.expansion,
            ask: "",
            why: "First mention of a glossary term in this session.",
            source: "glossary",
            confidence: 1,
          };
          // Feed the shown text into the exclusion list so the LLM's own
          // paraphrase of the same term gets suppressed server-side.
          shownAsks.current.push(
            `${g.term}${g.expansion ? ` (${g.expansion})` : ""}. ${g.definition || g.expansion}`,
          );
          showNow(def);
          break; // one at a time — further new terms surface on later ticks
        }
      } catch {
        /* transient — next tick will retry */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [segments, showNow]);

  // Coach loop: throttled suggestion generation over the recent window.
  useEffect(() => {
    if (!sessionId || segments.length === 0) return;
    if (segments.length - suggestedFrom.current < MIN_NEW_SEGMENTS) return;
    const since = Date.now() - lastSuggestAt.current;
    const wait = Math.max(0, SUGGEST_INTERVAL_MS - since);
    const t = setTimeout(async () => {
      if (suggestInFlight.current) return;
      suggestInFlight.current = true;
      lastSuggestAt.current = Date.now();
      suggestedFrom.current = segments.length;
      const recent = segments.slice(-8).map((s) => s.text).join(" ");
      setSuggesting(true);
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: recent,
            sessionId,
            exclude: shownAsks.current.slice(-20),
            recentTechniques: recentTechniques.current.slice(-3),
            ephemeral: sessionEphemeralRef.current,
            mode: sessionModeRef.current,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Suggest failed (${res.status}).`);
        setSuggestError(null);
        // Surface everything the server returns. The server already suppresses
        // repeats (the echo filter, using `exclude` below) BEFORE it logs, so
        // the live stream now matches the reviewed/exported log exactly — no
        // second client-side dedup that would make live show fewer than review.
        const returned = json.suggestions as Suggestion[];
        returned.forEach((s) => {
          // Feed what was shown back as the exclusion list so the next pass's
          // server-side echo filter can drop a rephrase of it.
          shownAsks.current.push(`${s.title}. ${s.ask || s.body}`);
          // Track the technique used so the next pass can be nudged to vary it.
          if (s.type === "coach" && s.source) recentTechniques.current.push(s.source);
        });
        if (returned.length) {
          // One thing at a time: newest becomes "Now", the rest (incl. the
          // previous card) drop into history.
          const [best, ...rest] = returned;
          if (rest.length) pushHistory(rest);
          showNow(best);
        }
      } catch (e) {
        setSuggestError(e instanceof Error ? e.message : "Suggestion generation failed.");
      } finally {
        suggestInFlight.current = false;
        setSuggesting(false);
      }
    }, wait);
    return () => clearTimeout(t);
  }, [segments, sessionId, showNow, pushHistory]);

  // One incremental summary pass: fold the newest transcript window into the
  // running bullets. Reads segments from a ref so it never runs on stale data.
  const runSummaryPass = useCallback(async () => {
    if (!sessionId) return;
    const segs = segmentsRef.current;
    const from = summarizedFrom.current;
    if (segs.length <= from) return; // nothing new
    summaryInFlight.current = true;
    summarizedFrom.current = segs.length;
    lastSummaryAt.current = Date.now();
    // Fold the new segments, but never more than the recent-window cap — bounds
    // the pass regardless of how far behind `from` is (e.g. after a long Hide).
    const windowStart = Math.max(from, segs.length - SUMMARY_MAX_WINDOW_SEGMENTS);
    const window = segs.slice(windowStart).map((s) => s.text).join("\n");
    setSummaryBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bullets: summaryBulletsRef.current,
          window,
          ephemeral: sessionEphemeralRef.current,
        }),
      });
      const json = await res.json();
      if (res.ok && json.summary) {
        summaryBulletsRef.current = json.summary.bullets;
        setSummaryBullets(json.summary.bullets);
      } else {
        summarizedFrom.current = from; // failed — retry this window next tick
      }
    } catch {
      summarizedFrom.current = from; // transient — retry next tick
    } finally {
      summaryInFlight.current = false;
      setSummaryBusy(false);
    }
  }, [sessionId]);

  // Running-summary loop: a self-ticking interval (NOT keyed on `segments`, so a
  // speech pause or a Hide→Show never strands it). Each tick fires a pass only
  // when there is new transcript, the cadence has elapsed, and — crucially — no
  // coach pass is in flight, so it yields the shared GPU to the timelier coach.
  useEffect(() => {
    if (!summaryOn || !sessionId || !recording) return;
    const id = setInterval(() => {
      if (summaryInFlight.current) return;
      if (segmentsRef.current.length <= summarizedFrom.current) return;
      if (Date.now() - lastSummaryAt.current < SUMMARY_INTERVAL_MS) return;
      if (suggestInFlight.current) return; // yield to the coach; retry next tick
      void runSummaryPass();
    }, 4000);
    return () => clearInterval(id);
  }, [summaryOn, sessionId, recording, runSummaryPass]);

  const sendChunk = useCallback(async (id: string, chunk: WavChunk) => {
    setPendingChunks((n) => n + 1);
    try {
      const form = new FormData();
      form.append("file", chunk.blob, "chunk.wav");
      form.append("offset", String(chunk.offset));
      const q = sessionEphemeralRef.current ? "?ephemeral=1" : "";
      const res = await fetch(`/api/sessions/live/${id}${q}`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Chunk failed (${res.status}).`);
      if (json.appended?.length) {
        setSegments((prev) =>
          [...prev, ...json.appended].sort((a, b) => a.start - b.start),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chunk transcription failed.");
    } finally {
      setPendingChunks((n) => n - 1);
    }
  }, []);

  async function start() {
    setStarting(true);
    setError(null);
    setSegments([]);
    setGlossaryMatches([]);
    currentRef.current = null;
    setCurrent(null);
    setHistory([]);
    setSuggestError(null);
    seenTerms.current.clear();
    shownAsks.current = [];
    recentTechniques.current = [];
    suggestedFrom.current = 0;
    lastSuggestAt.current = 0;
    setSummaryBullets([]);
    summaryBulletsRef.current = [];
    summarizedFrom.current = 0;
    lastSummaryAt.current = 0;
    summaryInFlight.current = false;
    sessionEphemeralRef.current = ephemeral;
    sessionModeRef.current = mode;
    try {
      const res = await fetch("/api/sessions/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ephemeral }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start session.");
      const id: string = json.session.id;
      setSessionId(id);

      const recorder = new WavRecorder((chunk) => void sendChunk(id, chunk));
      await recorder.start();
      recorderRef.current = recorder;
      setStartedAt(Date.now());
      setRecording(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start recording (microphone permission?).",
      );
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    await recorder?.stop();
    const recording = recorder?.getRecording() ?? null;
    recorderRef.current = null;
    setRecording(false);
    if (sessionId) {
      const eph = sessionEphemeralRef.current;
      setFinalizing(true);
      try {
        // Save the full recording before ending; transcript is already saved,
        // so a failed audio upload is non-fatal. Ephemeral sessions skip it —
        // the audio is never written to disk.
        if (recording && !eph) {
          const form = new FormData();
          form.append("file", recording, "recording.wav");
          await fetch(`/api/sessions/${sessionId}/audio`, {
            method: "POST",
            body: form,
          }).catch(() => {});
        }
        await fetch(`/api/sessions/live/${sessionId}${eph ? "?ephemeral=1" : ""}`, {
          method: "PATCH",
        });
      } finally {
        setFinalizing(false);
      }
    }
  }

  const started = recording || segments.length > 0;
  // Recording hides the nav header (immersive), so the sticky columns can reach
  // higher up the viewport; once ended the header returns and we pull back.
  const colClamp = recording
    ? "lg:max-h-[calc(100vh-6rem)]"
    : "lg:max-h-[calc(100vh-10rem)]";
  const ActiveModeIcon = MODE_ICONS[mode];
  const elapsedLabel =
    recording && startedAt != null ? elapsed(nowTick - startedAt) : null;

  return (
    <div className="space-y-8">
      {started ? (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Heading as="h1" size="2xl">Live Session</Heading>
            <span className="flex items-center gap-1.5 text-sm text-fg-muted">
              <ActiveModeIcon className="h-4 w-4" aria-hidden="true" />
              {getMode(mode).label}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {elapsedLabel && (
              <span
                role="timer"
                aria-label={`Elapsed session time ${elapsedLabel}`}
                className="flex items-center gap-1.5 font-mono text-sm tabular-nums text-fg"
              >
                <Clock className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                {elapsedLabel}
              </span>
            )}
            {recording && ephemeral && (
              <span className="flex items-center gap-2 text-sm text-fg-muted">
                <Badge variant="warning">Not recording</Badge>
                {pendingChunks > 0 && <Spinner className="h-3 w-3" />}
              </span>
            )}
            {recording && !ephemeral && (
              <span className="flex items-center gap-2 text-sm text-fg-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
                recording
                {pendingChunks > 0 && <Spinner className="h-3 w-3" />}
              </span>
            )}
            {recording ? (
              <Button variant="danger" onClick={stop}>
                <CircleStop className="h-4 w-4" aria-hidden="true" />
                End session
              </Button>
            ) : (
              <Button onClick={start} disabled={starting || finalizing}>
                {starting || finalizing ? <Spinner className="h-4 w-4" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                {finalizing ? "Saving…" : "Start session"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <section className="space-y-8 py-4 sm:py-8">
          {/* Heading sits above the columns so the card lines up with the
              left content below it, not the tall H1 — keeps the two columns
              the same height with minimal slack. */}
          <Heading as="h1" size="4xl" className="tracking-tight">
            Focus on the conversation
          </Heading>
          <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-stretch">
          {/* Left: what INSIGHT does */}
          <div className="space-y-6">
            <Text variant="muted" size="lg" className="max-w-xl leading-relaxed">
              INSIGHT listens as you talk and surfaces the right follow-up, a
              definition, or relevant context, right in the moment.
            </Text>

            <div className="max-w-sm space-y-2">
              <Text size="xs" variant="subtle" className="uppercase tracking-wide">
                Mode
              </Text>
              <Select value={mode} onValueChange={(v) => v && chooseMode(v as ModeId)}>
                <SelectTrigger aria-label="Conversation mode">
                  <span className="flex items-center gap-2 truncate">
                    <ActiveModeIcon
                      className="h-4 w-4 shrink-0 text-fg-muted"
                      aria-hidden="true"
                    />
                    {getMode(mode).label}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {modesByFamily().map(({ family, modes }) => (
                    <SelectGroup key={family.id}>
                      <SelectGroupLabel>{family.label}</SelectGroupLabel>
                      {modes.map((m) => {
                        const Icon = MODE_ICONS[m.id];
                        const available = m.status === "available";
                        return (
                          <SelectItem key={m.id} value={m.id} disabled={!available}>
                            <span className="flex items-center gap-2">
                              <Icon
                                className="h-4 w-4 shrink-0 text-fg-muted"
                                aria-hidden="true"
                              />
                              <span>{m.label}</span>
                              {!available && <Badge variant="subtle">Soon</Badge>}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <Text size="sm" variant="muted" className="leading-relaxed">
                {getMode(mode).blurb}
              </Text>
            </div>

            <div className="max-w-sm space-y-2">
              <Text size="xs" variant="subtle" className="uppercase tracking-wide">
                Sharper suggestions with prep
              </Text>
              <div className="flex flex-col gap-2">
                <NextLink
                  href="/documents"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full justify-start",
                  )}
                >
                  <FileUp className="size-4" />
                  Upload document
                </NextLink>
                <NextLink
                  href="/glossary"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full justify-start",
                  )}
                >
                  <BookPlus className="size-4" />
                  Add glossary term
                </NextLink>
              </div>
            </div>
          </div>

          {/* Right: start + prep */}
          <Card className="lg:flex lg:flex-col">
            <CardContent className="space-y-5 py-6 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
              <div className="space-y-1.5">
                <Text weight="medium">Ready when you are</Text>
                <Text size="sm" variant="muted" className="leading-relaxed">
                  Press start and INSIGHT begins listening.
                </Text>
              </div>

              <Button
                size="lg"
                className="w-full"
                onClick={start}
                disabled={starting || finalizing}
              >
                {starting || finalizing ? <Spinner className="h-4 w-4" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                {finalizing ? "Saving…" : "Start session"}
              </Button>

              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="cursor-pointer space-y-0.5"
                    onClick={() => setEphemeral((v) => !v)}
                  >
                    <Text size="sm" weight="medium">
                      Don&apos;t record this session
                    </Text>
                    <Text size="xs" variant="subtle" className="leading-relaxed">
                      Transcription still runs live; nothing is saved when you
                      end.
                    </Text>
                  </div>
                  <Switch
                    checked={ephemeral}
                    onCheckedChange={(v) => setEphemeral(v)}
                    aria-label="Don't record this session"
                    className="mt-0.5 shrink-0"
                  />
                </div>

                {/* Consent reminder: a script the researcher can read aloud to
                    seek recording consent before starting. */}
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button variant="outline" size="sm" className="w-full justify-center gap-2">
                        <MessageSquareQuote className="h-4 w-4" aria-hidden="true" />
                        Read consent script
                      </Button>
                    }
                  />
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Seek consent to record</DialogTitle>
                      <DialogDescription>
                        Read this aloud before you start, and wait for a clear
                        yes.
                      </DialogDescription>
                    </DialogHeader>
                    <blockquote className="border-l-2 border-accent bg-bg-subtle px-4 py-3 text-sm leading-relaxed text-fg">
                      &ldquo;Before we begin, I&apos;d like to record our
                      conversation so I can give you my full attention instead of
                      taking notes. The recording stays on my device and
                      won&apos;t be shared beyond the people directly involved in
                      this work. You can ask me to pause or stop at any time, and
                      you&apos;re free to decline. It won&apos;t affect anything.
                      Are you comfortable with me recording this session?&rdquo;
                    </blockquote>
                    <DialogFooter>
                      <DialogClose render={<Button variant="outline">Done</Button>} />
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
          </div>
        </section>
      )}

      {error && (
        <Alert variant="danger">
          <AlertTitle>Live session error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {started && (
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          {/* Left: the coach surface */}
          <div className={cn("space-y-6 lg:sticky lg:top-6 lg:flex lg:flex-col", colClamp)}>
          {/* The one thing to look at */}
          <Card className={cn("lg:shrink-0", recording && "now-card-live border-transparent")}>
            <CardContent className="py-6">
              {current ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Badge variant={TYPE_BADGE[current.type]}>{current.type}</Badge>
                      <Text as="span" size="sm" weight="medium" variant="muted">
                        {current.title}
                      </Text>
                      {suggesting && <Spinner className="h-3 w-3" />}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Dismiss suggestion"
                      onClick={() => {
                        if (currentRef.current) pushHistory([currentRef.current]);
                        currentRef.current = null;
                        setCurrent(null);
                      }}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <Text size="lg" weight="medium" className="leading-snug">
                    {current.ask ? <>“{current.ask}”</> : current.body}
                  </Text>
                  <Text size="xs" variant="subtle">
                    {current.why} · {current.source}
                  </Text>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-2">
                  {suggesting ? <Spinner className="h-4 w-4" /> : <Mic className="h-4 w-4 text-fg-subtle" aria-hidden="true" />}
                  <Text variant="muted">
                    {suggesting
                      ? "Coach is reviewing the conversation…"
                      : recording
                        ? "Listening. The coach will speak up when it has something useful."
                        : "Session ended."}
                  </Text>
                </div>
              )}
              {suggestError && (
                <Text size="xs" variant="muted" className="mt-3">
                  Coach unavailable: {suggestError}
                </Text>
              )}
            </CardContent>
          </Card>

          {/* Glossary chips — compact, hover for the definition */}
          {glossaryMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
              {glossaryMatches.map((g) => (
                <span key={g.term} title={g.definition} className="cursor-help">
                  <Badge variant="outline">
                    {g.term}
                    {g.expansion && (
                      <span className="ml-1 font-normal text-fg-subtle">
                        {g.expansion}
                      </span>
                    )}
                  </Badge>
                </span>
              ))}
            </div>
          )}

          {/* Earlier suggestions — collapsed by default */}
          {history.length > 0 && (
            <div className="space-y-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg lg:shrink-0"
              >
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", !historyOpen && "-rotate-90")}
                  aria-hidden="true"
                />
                Earlier suggestions ({history.length})
              </button>
              {historyOpen && (
                <div ref={historyRef} className="space-y-3 border-l border-border pl-4 max-h-72 overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
                  {history.map((s, i) => (
                    <div key={`${s.title}-${i}`} className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant={TYPE_BADGE[s.type]}>{s.type}</Badge>
                        <Text as="span" size="sm" weight="medium">
                          {s.title}
                        </Text>
                      </div>
                      <Text size="sm" variant="muted">
                        {s.ask ? `“${s.ask}”` : s.body}
                      </Text>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          </div>

          {/* Right: running summary + live transcript. Bounded to the viewport
              (flex column, capped height) so the two never push the page — only
              the transcript scrolls internally. */}
          <div className={cn("space-y-4 lg:sticky lg:top-6 lg:flex lg:flex-col lg:min-h-0", colClamp)}>
            {/* Running summary — a glanceable recap you can pull when you lose the
                thread. Hiding it also pauses the loop, so it costs nothing off.
                shrink-0 + its own scroll cap so long bullets never eat the feed. */}
            <Card className="lg:shrink-0">
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
                    <Text as="span" size="sm" weight="medium" variant="muted">
                      Summary
                    </Text>
                    {summaryBusy && <Spinner className="h-3 w-3" />}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSummaryOn((o) => !o)}
                    aria-label={summaryOn ? "Hide running summary" : "Show running summary"}
                  >
                    {summaryOn ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        Hide
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Show
                      </>
                    )}
                  </Button>
                </div>
                {summaryOn ? (
                  summaryBullets.length > 0 ? (
                    <ul className="space-y-1.5 lg:max-h-[38vh] lg:overflow-y-auto">
                      {summaryBullets.map((b, i) => (
                        <li key={i} className="flex gap-2.5">
                          <span
                            aria-hidden="true"
                            className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                          />
                          <Text size="sm" variant="muted">{stripListMarker(b)}</Text>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Text size="sm" variant="subtle">
                      {recording
                        ? "Building a running summary of what's been covered…"
                        : "No summary yet."}
                    </Text>
                  )
                ) : (
                  <Text size="sm" variant="subtle">Summary hidden. It resumes when shown.</Text>
                )}
              </CardContent>
            </Card>

            {/* Live transcript — fills the remaining column height, scrolls inside */}
            <div className="space-y-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <div className="flex items-center gap-2 lg:shrink-0">
              <Text as="span" size="sm" weight="medium" variant="muted">
                Transcript
              </Text>
              {!recording && sessionId && segments.length > 0 && !ephemeral && (
                <NextLink
                  href={`/sessions/${sessionId}`}
                  className="text-sm text-accent hover:underline"
                >
                  View saved transcript
                </NextLink>
              )}
              {!recording && ephemeral && segments.length > 0 && (
                <Text as="span" size="sm" variant="subtle">
                  Not saved. This transcript is discarded when you leave.
                </Text>
              )}
            </div>
            <div
              ref={feedRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottomRef.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
              className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border bg-surface p-4 lg:max-h-none lg:min-h-0 lg:flex-1"
            >
              {segments.length === 0 ? (
                <Text size="sm" variant="subtle">
                  {recording ? "Listening…" : "No transcript."}
                </Text>
              ) : (
                <>
                  {segments.length > MAX_VISIBLE_SEGMENTS && (
                    <Text size="xs" variant="subtle" className="pb-1">
                      {segments.length - MAX_VISIBLE_SEGMENTS} earlier lines hidden here.{ephemeral ? "" : " The full transcript is saved."}
                    </Text>
                  )}
                  {segments.slice(-MAX_VISIBLE_SEGMENTS).map((seg) => (
                    <div key={`${seg.start}-${seg.end}`} className="flex gap-3">
                      <Text as="span" size="xs" variant="subtle" className="w-10 shrink-0 pt-0.5 font-mono">
                        {ts(seg.start)}
                      </Text>
                      <Text size="sm" variant="muted">
                        {seg.text}
                      </Text>
                    </div>
                  ))}
                </>
              )}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
