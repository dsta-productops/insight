"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Download, ListChecks, Maximize, Pencil, Sparkles, Trash2, Users, X } from "lucide-react";
import { stripListMarker } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";

type Speaker = "researcher" | "participant";

interface SessionMeta {
  id: string;
  title: string;
  filename: string;
  uploadedAt: string;
  status: "live" | "transcribing" | "done" | "error";
  provider: string;
  durationSec?: number;
  error?: string;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: Speaker;
}

interface TranscriptDoc {
  sessionId: string;
  createdAt: string;
  provider: string;
  segments: TranscriptSegment[];
  labeledAt?: string;
}

interface Suggestion {
  type: "definition" | "context" | "coach";
  title: string;
  body: string;
  ask: string;
  why: string;
  source: string;
  confidence: number;
}

interface SuggestionLogEntry {
  at: string;
  query: string;
  provider: string;
  suggestions: Suggestion[];
}

interface RecapSection {
  title: string;
  points: string[];
}

interface SummaryDoc {
  updatedAt: string;
  provider?: string;
  bullets: string[];
  sections?: RecapSection[];
}

const TYPE_BADGE: Record<Suggestion["type"], "info" | "success" | "outline"> = {
  coach: "info",
  definition: "success",
  context: "outline",
};

const SPEAKER_LABEL: Record<Speaker, string> = {
  researcher: "Researcher",
  participant: "Participant",
};

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** A transcript segment or a coach suggestion, placed on the session timeline. */
type TimelineRow =
  | { kind: "segment"; time: number; seg: TranscriptSegment; key: string }
  | { kind: "suggestion"; time: number; s: Suggestion; key: string };

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [transcript, setTranscript] = useState<TranscriptDoc | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionLogEntry[]>([]);
  const [summary, setSummary] = useState<SummaryDoc | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState<number | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [audioExt, setAudioExt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labeling, setLabeling] = useState(false);
  const [labelProgress, setLabelProgress] = useState<number | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Presentation mode: a scaled, maximized scroll of the recap for showing on a
  // screen. The overlay covers the app chrome; Esc or the close button exits.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [presenting]);

  // Seek the audio to a transcript/coach-cue timestamp and play from there.
  const seekTo = useCallback((seconds: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, seconds);
    void a.play().catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const r = await fetch(`/api/sessions/${id}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json.error ?? `Request failed (${r.status}).`);
    setSession(json.session);
    setTranscript(json.transcript);
    setSuggestions(json.suggestions ?? []);
    setSummary(json.summary ?? null);
    setHasAudio(!!json.hasAudio);
    setAudioExt(json.audioExt ?? null);
  }, [id]);

  useEffect(() => {
    load().catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load session."),
    );
  }, [load]);

  async function onLabelSpeakers() {
    setLabeling(true);
    setLabelProgress(0);
    setLabelError(null);
    try {
      const r = await fetch(`/api/sessions/${id}/label`, { method: "POST" });
      // Pre-stream failures (no/empty transcript) come back as JSON.
      if (!r.ok || !r.body) {
        const json = await r.json().catch(() => ({}));
        throw new Error(json.error ?? `Labeling failed (${r.status}).`);
      }
      // Otherwise a progress stream (NDJSON): {progress} lines then {transcript}.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalTranscript: TranscriptDoc | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: { progress?: number; transcript?: TranscriptDoc; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof msg.progress === "number") setLabelProgress(msg.progress);
          else if (msg.error) throw new Error(msg.error);
          else if (msg.transcript) {
            finalTranscript = msg.transcript;
            setLabelProgress(100);
          }
        }
      }
      if (!finalTranscript) throw new Error("Speaker labeling did not complete.");
      setTranscript(finalTranscript);
    } catch (e) {
      setLabelError(e instanceof Error ? e.message : "Speaker labeling failed.");
    } finally {
      setLabeling(false);
      setLabelProgress(null);
    }
  }

  async function onGenerateRecap() {
    setRegenerating(true);
    setRegenProgress(0);
    setRegenError(null);
    try {
      const r = await fetch(`/api/sessions/${id}/recap`, { method: "POST" });
      // Pre-stream failures (no transcript, still live) come back as JSON.
      if (!r.ok || !r.body) {
        const json = await r.json().catch(() => ({}));
        throw new Error(json.error ?? `Recap failed (${r.status}).`);
      }
      // Otherwise it's a progress stream (NDJSON): {progress} lines then {summary}.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalSummary: SummaryDoc | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: { progress?: number; summary?: SummaryDoc; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof msg.progress === "number") setRegenProgress(msg.progress);
          else if (msg.error) throw new Error(msg.error);
          else if (msg.summary) {
            finalSummary = msg.summary;
            setRegenProgress(100);
          }
        }
      }
      if (!finalSummary) throw new Error("Recap generation did not complete.");
      setSummary(finalSummary);
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "Recap generation failed.");
    } finally {
      setRegenerating(false);
      setRegenProgress(null);
    }
  }

  function startRename() {
    if (!session) return;
    setEditValue(session.title);
    setEditing(true);
  }

  function cancelRename() {
    setEditing(false);
    setEditValue("");
  }

  async function saveRename() {
    const title = editValue.trim();
    if (!title || title === session?.title) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    setError(null);
    try {
      const r = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error ?? `Rename failed (${r.status}).`);
      setSession((s) => (s ? { ...s, title } : s));
      cancelRename();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setSavingRename(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const json = await r.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed (${r.status}).`);
      }
      router.push("/sessions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      setDeleting(false);
      setPendingDelete(false);
    }
  }

  // Formats browsers can play in <audio>; others (aiff/caf) stay download-only.
  const canPlayAudio = !!audioExt && [".wav", ".mp3", ".m4a", ".mp4"].includes(audioExt);
  // When playable audio exists, timestamps become clickable to seek the player.
  const canSeek = hasAudio && canPlayAudio;

  const hasLabels = !!transcript?.segments.some((s) => s.speaker);

  // Merge transcript segments and coach suggestions onto one timeline. Each
  // suggestion is anchored by when it was generated, relative to the transcript
  // start — so the reviewer sees what the coach surfaced and roughly when.
  const timeline = useMemo<TimelineRow[]>(() => {
    if (!transcript) return [];
    const t0 = Date.parse(transcript.createdAt);
    const lastEnd = transcript.segments.at(-1)?.end ?? 0;
    const rows: TimelineRow[] = transcript.segments.map((seg, i) => ({
      kind: "segment",
      time: seg.start,
      seg,
      key: `seg-${i}`,
    }));
    suggestions.forEach((entry, ei) => {
      const offset = Number.isFinite(t0)
        ? Math.min(Math.max((Date.parse(entry.at) - t0) / 1000, 0), lastEnd)
        : 0;
      entry.suggestions.forEach((s, si) => {
        rows.push({ kind: "suggestion", time: offset, s, key: `sug-${ei}-${si}` });
      });
    });
    // Stable sort by time; segments sort before suggestions at the same instant.
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r.time - b.r.time || a.i - b.i)
      .map(({ r }) => r);
  }, [transcript, suggestions]);

  const coachCount = useMemo(
    () => suggestions.reduce((n, e) => n + e.suggestions.length, 0),
    [suggestions],
  );

  let lastSpeaker: Speaker | undefined;

  return (
    <div className="space-y-6">
      <div>
        <NextLink
          href="/sessions"
          className="mb-2 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All sessions
        </NextLink>
        {session && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              {editing ? (
                <div className="flex items-center gap-1">
                  <Input
                    autoFocus
                    value={editValue}
                    disabled={savingRename}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    className="h-9 max-w-sm text-lg"
                    aria-label="Session name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Save name"
                    disabled={savingRename}
                    onClick={saveRename}
                  >
                    {savingRename ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel rename"
                    disabled={savingRename}
                    onClick={cancelRename}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <div className="group flex items-center gap-1.5">
                  <Heading as="h1" size="2xl" className="min-w-0 break-words">{session.title}</Heading>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Rename session"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={startRename}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {session.durationSec ? (
                  <Text as="span" size="sm" variant="muted">{ts(session.durationSec)}</Text>
                ) : null}
                <Text as="span" size="sm" variant="muted">
                  {session.filename} · {new Date(session.uploadedAt).toLocaleString()}
                </Text>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {transcript && transcript.segments.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onLabelSpeakers}
                    disabled={labeling}
                  >
                    {labeling ? (
                      <>
                        <Spinner className="h-4 w-4 text-current" />
                        {labelProgress != null ? `${labelProgress}%` : "Starting"}
                      </>
                    ) : (
                      <>
                        <Users className="h-4 w-4" aria-hidden="true" />
                        {hasLabels ? "Re-label speakers" : "Label speakers"}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { window.location.href = `/api/sessions/${id}/export?format=md`; }}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Markdown
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { window.location.href = `/api/sessions/${id}/export?format=json`; }}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    JSON
                  </Button>
                </>
              )}
              {hasAudio && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { window.location.href = `/api/sessions/${id}/audio?download=1`; }}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Audio
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-label="Delete session"
                onClick={() => setPendingDelete(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      {hasAudio && canPlayAudio && (
        // Sticky so the playback controls stay in view while scrolling the
        // transcript below — makes it easy to cross-reference audio with text.
        <Card className="sticky top-4 z-20 p-4 shadow-sm">
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={`/api/sessions/${id}/audio`}
            className="w-full"
          >
            Your browser does not support audio playback.
          </audio>
        </Card>
      )}

      {error && (
        <Alert variant="danger">
          <AlertTitle>Could not load session</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {labelError && (
        <Alert variant="danger">
          <AlertTitle>Speaker labeling failed</AlertTitle>
          <AlertDescription>{labelError}</AlertDescription>
        </Alert>
      )}

      {!session && !error && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {transcript && transcript.segments.length > 0 && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
              <Heading as="h2" size="lg">Recap</Heading>
            </div>
            <div className="flex items-center gap-2">
              {summary && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setPresenting(true)}>
                    <Maximize className="h-4 w-4" aria-hidden="true" />
                    Present
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { window.location.href = `/api/sessions/${id}/recap?format=md`; }}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </Button>
                </>
              )}
              <Button
                variant={summary?.sections?.length ? "outline" : "solid"}
                size="sm"
                onClick={onGenerateRecap}
                disabled={regenerating}
              >
                {regenerating ? (
                  <>
                    <Spinner className="h-4 w-4 text-current" />
                    {regenProgress != null ? `${regenProgress}%` : "Starting"}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    {summary?.sections?.length ? "Regenerate" : "Generate detailed recap"}
                  </>
                )}
              </Button>
            </div>
          </div>
          {regenError && (
            <Alert variant="danger">
              <AlertDescription>{regenError}</AlertDescription>
            </Alert>
          )}
          {summary && (summary.sections?.length || summary.bullets.length > 0) ? (
            <>
              <div className="max-h-[28rem] overflow-y-auto pr-1">
                {summary.sections && summary.sections.length > 0 ? (
                  <div className="space-y-5">
                    {summary.sections.map((sec, i) => (
                      <div key={i} className="space-y-1.5">
                        <Heading as="h3" size="md">{sec.title}</Heading>
                        <ul className="space-y-1.5">
                          {sec.points.map((p, j) => (
                            <li key={j} className="flex gap-2.5">
                              <span
                                aria-hidden="true"
                                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                              />
                              <Text size="sm">{stripListMarker(p)}</Text>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                        />
                        <Text size="sm">{stripListMarker(b)}</Text>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Text as="div" size="xs" variant="subtle">
                Updated {new Date(summary.updatedAt).toLocaleString()}
              </Text>
            </>
          ) : (
            !regenerating && (
              <Text size="sm" variant="muted">
                No recap yet. Generate a recap of what the session covered.
              </Text>
            )
          )}
          {regenerating && (
            <Text size="sm" variant="muted">
              Generating a detailed recap. This runs on the local model and can take a couple of minutes.
            </Text>
          )}
        </Card>
      )}

      {transcript && (
        <>
          <Separator />
          <div className="flex items-center gap-3">
            <Text size="sm" variant="muted">
              {transcript.segments.length} segments
            </Text>
            {coachCount > 0 && (
              <span className="inline-flex items-center gap-1 text-sm text-info">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {coachCount} coach {coachCount === 1 ? "cue" : "cues"}
              </span>
            )}
            {!hasLabels && (
              <Text size="sm" variant="subtle">· speakers not labeled yet</Text>
            )}
          </div>

          <div className="space-y-3">
            {timeline.map((row) => {
              if (row.kind === "suggestion") {
                return (
                  <SuggestionCard
                    key={row.key}
                    s={row.s}
                    time={row.time}
                    onSeek={canSeek ? seekTo : undefined}
                  />
                );
              }
              const showSpeaker = row.seg.speaker && row.seg.speaker !== lastSpeaker;
              lastSpeaker = row.seg.speaker ?? lastSpeaker;
              return (
                <div key={row.key} className="flex gap-4">
                  {canSeek ? (
                    <button
                      type="button"
                      onClick={() => seekTo(row.seg.start)}
                      title="Jump to this point in the audio"
                      className="w-12 shrink-0 pt-1 text-left font-mono text-xs text-fg-subtle transition-colors hover:text-accent hover:underline"
                    >
                      {ts(row.seg.start)}
                    </button>
                  ) : (
                    <Text as="span" size="xs" variant="subtle" className="w-12 shrink-0 pt-1 font-mono">
                      {ts(row.seg.start)}
                    </Text>
                  )}
                  <div className="min-w-0 flex-1">
                    {showSpeaker && (
                      <Text
                        as="div"
                        size="xs"
                        weight="medium"
                        className={row.seg.speaker === "researcher" ? "text-accent" : "text-fg"}
                      >
                        {SPEAKER_LABEL[row.seg.speaker!]}
                      </Text>
                    )}
                    <Text size="sm">{row.seg.text}</Text>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {presenting && summary && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-bg"
          role="dialog"
          aria-modal="true"
          aria-label="Recap presentation"
        >
          <div className="mx-auto max-w-3xl px-8 pb-16 sm:px-12">
            <div className="sticky top-0 z-10 mb-10 flex items-start justify-between gap-6 border-b border-border bg-bg pb-4 pt-10">
              <div className="min-w-0">
                <Heading as="h1" size="3xl">{session?.title}</Heading>
                <Text as="div" size="md" variant="muted" className="mt-1">Session recap</Text>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => setPresenting(false)}
                aria-label="Exit presentation"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>

            {summary.sections && summary.sections.length > 0 ? (
              <div className="space-y-10">
                {summary.sections.map((sec, i) => (
                  <section key={i}>
                    <Heading as="h2" size="xl" className="mb-4">{sec.title}</Heading>
                    <ul className="space-y-3">
                      {sec.points.map((p, j) => (
                        <li key={j} className="flex gap-3">
                          <span
                            aria-hidden="true"
                            className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                          />
                          <Text size="lg">{stripListMarker(p)}</Text>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul className="space-y-3">
                {summary.bullets.map((b, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    />
                    <Text size="lg">{stripListMarker(b)}</Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(false);
        }}
        title="Delete session?"
        description="This permanently removes the session, its transcript, recap, coach cues, and audio. This cannot be undone."
        busy={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

function SuggestionCard({
  s,
  time,
  onSeek,
}: {
  s: Suggestion;
  time: number;
  onSeek?: (seconds: number) => void;
}) {
  return (
    <div className="flex gap-4">
      {onSeek ? (
        <button
          type="button"
          onClick={() => onSeek(time)}
          title="Jump to this point in the audio"
          className="w-12 shrink-0 pt-2 text-left font-mono text-xs text-fg-subtle transition-colors hover:text-accent hover:underline"
        >
          ~{ts(time)}
        </button>
      ) : (
        <Text as="span" size="xs" variant="subtle" className="w-12 shrink-0 pt-2 font-mono">
          ~{ts(time)}
        </Text>
      )}
      <Card className="min-w-0 flex-1 border-l-2 border-l-info bg-surface p-3">
        <div className="mb-1 flex items-center gap-2">
          <Badge variant={TYPE_BADGE[s.type]}>{s.type}</Badge>
          <Text as="span" size="sm" weight="medium">{s.title}</Text>
        </div>
        <Text size="sm" className="text-fg">
          {s.ask ? <>“{s.ask}”</> : s.body}
        </Text>
        {(s.why || s.source) && (
          <Text as="div" size="xs" variant="subtle" className="mt-1">
            {s.why}
            {s.why && s.source ? " · " : ""}
            {s.source}
          </Text>
        )}
      </Card>
    </div>
  );
}
