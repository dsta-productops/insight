"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Download,
  EyeOff,
  FileText,
  ListChecks,
  MessageCircleQuestion,
  Radar,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Faithful recreations of the INSIGHT product surfaces, populated with
 * representative interview content. Not raster screenshots — these are
 * the real PRIZM components, so they stay crisp, responsive, and on-theme.
 * ------------------------------------------------------------------ */

export function BrowserFrame({
  label,
  live,
  className,
  children,
}: {
  label: string;
  live?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden shadow-lg", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-bg-subtle px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="ml-3 inline-flex items-center gap-2 rounded-md bg-surface px-3 py-1 text-xs text-fg-subtle">
          <Radar className="h-3.5 w-3.5 text-accent" aria-hidden />
          {label}
        </span>
        {live ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-danger">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
            </span>
            Recording
          </span>
        ) : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

function TranscriptLine({
  time,
  speaker,
  text,
  typing,
}: {
  time: string;
  speaker: "Researcher" | "Participant";
  text: string;
  typing?: boolean;
}) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="shrink-0 font-mono text-xs leading-6 text-fg-subtle">{time}</span>
      <span className="flex-1">
        <span
          className={cn(
            "mr-1.5 text-xs font-semibold",
            speaker === "Researcher" ? "text-accent" : "text-fg-muted",
          )}
        >
          {speaker}
        </span>
        <span className="text-fg">{text}</span>
        {typing ? (
          <span
            className="hero-caret ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-fg-muted align-middle"
            aria-hidden
          />
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Now card — renders whichever suggestion type is current.
 * ------------------------------------------------------------------ */

type Suggestion =
  | { type: "coach"; ask: string; why: string }
  | { type: "definition"; term: string; text: string }
  | { type: "context"; text: string; source: string };

function suggestionKey(s: Suggestion): string {
  if (s.type === "coach") return "c-" + s.ask;
  if (s.type === "definition") return "d-" + s.term;
  return "x-" + s.source;
}

function NowCard({ suggestion }: { suggestion: Suggestion | null }) {
  return (
    <div className="now-card-live flex min-h-[8.5rem] flex-col justify-center rounded-lg border border-border bg-surface p-4">
      {suggestion ? (
        <div key={suggestionKey(suggestion)} className="hero-swap">
          {suggestion.type === "coach" ? (
            <>
              <div className="mb-2">
                <Badge variant="success">
                  <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
                  Follow-up
                </Badge>
              </div>
              <p className="text-[15px] font-medium leading-snug text-fg">{suggestion.ask}</p>
              <Text size="xs" variant="subtle" className="mt-2.5">
                Why: {suggestion.why}
              </Text>
            </>
          ) : null}
          {suggestion.type === "definition" ? (
            <>
              <div className="mb-2">
                <Badge variant="subtle">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  Definition
                </Badge>
              </div>
              <p className="text-[15px] font-semibold leading-snug text-fg">{suggestion.term}</p>
              <Text size="xs" variant="muted" className="mt-1.5">
                {suggestion.text}
              </Text>
            </>
          ) : null}
          {suggestion.type === "context" ? (
            <>
              <div className="mb-2">
                <Badge variant="info">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Context
                </Badge>
              </div>
              <p className="text-[15px] font-medium leading-snug text-fg">{suggestion.text}</p>
              <Text size="xs" variant="subtle" className="mt-2.5">
                From your documents · {suggestion.source}
              </Text>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <Text size="sm" variant="muted">
            INSIGHT is listening…
          </Text>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Animated hero: a short looping "live" sequence. The transcript types
 * out line by line; as lines land, the Now card reacts with the right
 * suggestion type (definition → follow-up → context).
 * ------------------------------------------------------------------ */

const SCRIPT: {
  time: string;
  speaker: "Researcher" | "Participant";
  text: string;
  suggestion?: Suggestion;
}[] = [
  {
    time: "04:12",
    speaker: "Researcher",
    text: "How does your team handle a handover today?",
  },
  {
    time: "04:18",
    speaker: "Participant",
    text: "Right now it is ad hoc. The CONOPS assumes a clean handover, but we just call it in.",
    suggestion: {
      type: "definition",
      term: "CONOPS",
      text: "Concept of operations: how a capability is intended to be used in the field.",
    },
  },
  {
    time: "04:31",
    speaker: "Participant",
    text: "And when it gets busy it feels chaotic, things slip through.",
    suggestion: {
      type: "coach",
      ask: "You said it feels chaotic. Walk me through the last time that happened, start to finish.",
      why: "grounds a vague feeling in a concrete event · five whys",
    },
  },
  {
    time: "04:44",
    speaker: "Researcher",
    text: "Tell me about the last time something slipped.",
    suggestion: {
      type: "context",
      text: "Notifications and offline queueing are the proposed fix for missed handovers.",
      source: "Tasking Module PRD",
    },
  },
];

interface Frame {
  lines: number;
  active: { time: string; speaker: "Researcher" | "Participant"; text: string; words: number } | null;
  suggestion: Suggestion | null;
  dur: number;
}

function buildFrames(): Frame[] {
  const WORD_MS = 72;
  const frames: Frame[] = [];
  let current: Suggestion | null = null;

  SCRIPT.forEach((line, idx) => {
    const words = line.text.split(" ");
    for (let w = 1; w <= words.length; w++) {
      frames.push({
        lines: idx,
        active: { time: line.time, speaker: line.speaker, text: line.text, words: w },
        suggestion: current,
        dur: WORD_MS,
      });
    }
    // Line complete: brief settle, then the suggestion it triggers appears.
    frames.push({ lines: idx + 1, active: null, suggestion: current, dur: line.suggestion ? 550 : 1300 });
    if (line.suggestion) {
      current = line.suggestion;
      frames.push({ lines: idx + 1, active: null, suggestion: current, dur: 1900 });
    }
  });

  if (frames.length) {
    frames[frames.length - 1] = { ...frames[frames.length - 1], dur: 2800 };
  }
  return frames;
}

export function HeroLive() {
  const frames = useMemo(buildFrames, []);
  const [i, setI] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setReduced(true);
      setI(frames.length - 1); // rest on the fully-played state
    }
  }, [frames.length]);

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setI((n) => (n + 1) % frames.length), frames[i].dur);
    return () => clearTimeout(t);
  }, [i, reduced, frames]);

  const f = frames[i];
  const shown = SCRIPT.slice(0, f.lines);

  return (
    <BrowserFrame label="insight · live" live>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <NowCard suggestion={f.suggestion} />
        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <Text
            size="xs"
            variant="subtle"
            weight="semibold"
            className="mb-2 uppercase tracking-wide"
          >
            Transcript
          </Text>
          <div className="flex h-[13rem] flex-col justify-end gap-2.5 overflow-hidden">
            {shown.map((l, idx) => (
              <TranscriptLine key={idx} time={l.time} speaker={l.speaker} text={l.text} />
            ))}
            {f.active ? (
              <TranscriptLine
                time={f.active.time}
                speaker={f.active.speaker}
                text={f.active.text.split(" ").slice(0, f.active.words).join(" ")}
                typing
              />
            ) : null}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Static mocks used lower on the page (no motion where it isn't needed).
 * ------------------------------------------------------------------ */

export function LiveCoachMock() {
  return (
    <BrowserFrame label="insight · live" live>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-3">
          <NowCard
            suggestion={{
              type: "coach",
              ask: 'You said the handover "felt chaotic." Can you walk me through the last time that happened, start to finish?',
              why: "grounds a vague feeling in a concrete recent event · five whys",
            }}
          />
          <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-fg-muted" aria-hidden />
              <Text size="xs" weight="semibold">
                CONOPS
              </Text>
            </div>
            <Text size="xs" variant="muted" className="mt-1">
              Concept of operations: how a capability is intended to be used in the field.
            </Text>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <Text
            size="xs"
            variant="subtle"
            weight="semibold"
            className="mb-2 uppercase tracking-wide"
          >
            Transcript
          </Text>
          <div className="flex flex-col gap-2.5">
            <TranscriptLine time="04:12" speaker="Researcher" text="How does your team handle a handover today?" />
            <TranscriptLine time="04:18" speaker="Participant" text="Honestly it is a bit ad hoc. Someone calls, someone writes it on the whiteboard." />
            <TranscriptLine time="04:31" speaker="Participant" text="When it gets busy it felt chaotic, things slip through." />
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

const SUMMARY_BULLETS = [
  "Handover today is ad hoc: a phone call plus the whiteboard",
  "It gets chaotic when the team is busy",
  "Tasks slip through during the busy stretches",
  "The CONOPS assumes a clean handover that does not happen",
  "Open to notifications for tasks that get missed",
];

export function SummaryMock() {
  return (
    <Card className="overflow-hidden shadow-lg">
      <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-4 py-2.5">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          <ListChecks className="h-4 w-4 text-accent" aria-hidden />
          Summary
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-fg-subtle">
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          Hide
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <ul className="space-y-2.5">
          {SUMMARY_BULLETS.map((b) => (
            <li key={b} className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <Text size="sm" variant="muted">
                {b}
              </Text>
            </li>
          ))}
        </ul>
        <Text size="xs" variant="subtle" className="mt-4">
          Updated moments ago
        </Text>
      </div>
    </Card>
  );
}

/**
 * The four regions of the live view, in reading order (left column top to
 * bottom, then right column). Used both as hover targets on the mock and as the
 * copy shown in the inspector caption beneath it.
 */
const LAYOUT_REGIONS = [
  {
    icon: MessageCircleQuestion,
    tint: "text-success",
    label: "Now card",
    desc: "The one suggestion to act on right now, phrased so you can read it aloud.",
  },
  {
    icon: BookOpen,
    tint: "text-fg-muted",
    label: "Glossary and history",
    desc: "The terms in play right now, with every earlier suggestion one tap away.",
  },
  {
    icon: ListChecks,
    tint: "text-accent",
    label: "Running summary",
    desc: "A running recap of what has been covered, for when you lose the thread.",
  },
  {
    icon: FileText,
    tint: "text-info",
    label: "Transcript",
    desc: "The live conversation, transcribed on your device as you talk.",
  },
];

/**
 * A glass callout that floats in beside the highlighted region on desktop,
 * always mounted (opacity-toggled) so it can fade + scale in. Left-column
 * regions point their callout right, right-column regions point left, so it
 * lands in the interior of the frame and never clips at the edge.
 */
function RegionCallout({ i, open, side }: { i: number; open: boolean; side: "left" | "right" }) {
  const r = LAYOUT_REGIONS[i];
  const Icon = r.icon;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 z-30 hidden w-60 -translate-y-1/2 rounded-xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur-sm transition-all duration-200 ease-out lg:block",
        side === "right" ? "left-full ml-3" : "right-full mr-3",
        open ? "translate-x-0 opacity-100" : cn("opacity-0", side === "right" ? "-translate-x-2" : "translate-x-2"),
      )}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-bg-muted">
          <Icon className={cn("h-4 w-4", r.tint)} aria-hidden />
        </span>
        <Text weight="semibold" size="sm">
          {r.label}
        </Text>
      </div>
      <Text size="sm" variant="muted" className="mt-2 leading-relaxed">
        {r.desc}
      </Text>
    </div>
  );
}

/**
 * The full live view, made explorable. Pointing at a region (hover / focus /
 * tap) spotlights it: the panel lifts and stays crisp while the rest dims, and
 * a glass callout floats in beside it naming what it does. On touch, where hover
 * doesn't exist, tapping toggles the same state and a caption appears below.
 */
export function LiveLayoutMock() {
  const [active, setActive] = useState<number | null>(null);

  const hot = (i: number) => ({
    tabIndex: 0,
    "aria-label": `${LAYOUT_REGIONS[i].label}. ${LAYOUT_REGIONS[i].desc}`,
    onMouseEnter: () => setActive(i),
    onMouseLeave: () => setActive((a) => (a === i ? null : a)),
    onFocus: () => setActive(i),
    onBlur: () => setActive((a) => (a === i ? null : a)),
    onClick: () => setActive((a) => (a === i ? null : i)),
  });

  // Spotlight: the active region lifts + glows; the others dim back.
  const cls = (i: number, extra?: string) =>
    cn(
      "relative rounded-lg outline-none ring-2 transition-all duration-300 ease-out",
      active === i
        ? "z-20 scale-[1.02] shadow-xl ring-accent"
        : "ring-transparent",
      active !== null && active !== i && "scale-[0.99] opacity-40",
      extra,
    );

  const r = active !== null ? LAYOUT_REGIONS[active] : null;
  const ActiveIcon = r?.icon;

  return (
    <div>
      <BrowserFrame label="insight · live" live>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Left: the coach — what to do next */}
          <div className="flex flex-col gap-3">
            <div {...hot(0)} className={cls(0)}>
              <NowCard
                suggestion={{
                  type: "coach",
                  ask: 'You said the handover "felt chaotic." Walk me through the last time that happened, start to finish.',
                  why: "grounds a vague feeling in a concrete event · five whys",
                }}
              />
              <RegionCallout i={0} open={active === 0} side="right" />
            </div>
            <div {...hot(1)} className={cls(1, "flex flex-col gap-2 p-1.5")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  CONOPS
                  <span className="ml-1 font-normal text-fg-subtle">Concept of operations</span>
                </Badge>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" aria-hidden />
                Earlier suggestions (3)
              </span>
              <RegionCallout i={1} open={active === 1} side="right" />
            </div>
          </div>

          {/* Right: the record — what was said */}
          <div className="flex flex-col gap-3">
            <div {...hot(2)} className={cls(2, "border border-border bg-surface")}>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  <ListChecks className="h-3.5 w-3.5 text-accent" aria-hidden />
                  Summary
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
                  <EyeOff className="h-3 w-3" aria-hidden />
                  Hide
                </span>
              </div>
              <ul className="space-y-1.5 p-3">
                {SUMMARY_BULLETS.slice(0, 3).map((b) => (
                  <li key={b} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <Text size="xs" variant="muted">
                      {b}
                    </Text>
                  </li>
                ))}
              </ul>
              <RegionCallout i={2} open={active === 2} side="left" />
            </div>
            <div {...hot(3)} className={cls(3, "border border-border bg-bg-subtle p-3")}>
              <Text
                size="xs"
                variant="subtle"
                weight="semibold"
                className="mb-2 uppercase tracking-wide"
              >
                Transcript
              </Text>
              <div className="flex flex-col gap-2.5">
                <TranscriptLine
                  time="04:12"
                  speaker="Researcher"
                  text="How does your team handle a handover today?"
                />
                <TranscriptLine
                  time="04:18"
                  speaker="Participant"
                  text="Honestly it is a bit ad hoc. Someone calls, someone writes it on the whiteboard."
                />
                <TranscriptLine
                  time="04:31"
                  speaker="Participant"
                  text="When it gets busy it felt chaotic, things slip through."
                />
              </div>
              <RegionCallout i={3} open={active === 3} side="left" />
            </div>
          </div>
        </div>
      </BrowserFrame>

      {/* Touch fallback: no hover on mobile, so a tapped region shows its
          description here. Hidden on desktop, where the floating callout does it. */}
      <div
        aria-live="polite"
        className="mt-4 flex min-h-[3.5rem] items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 lg:hidden"
      >
        {r && ActiveIcon ? (
          <>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-muted">
              <ActiveIcon className={cn("h-4 w-4", r.tint)} aria-hidden />
            </span>
            <div>
              <Text weight="semibold" size="sm">
                {r.label}
              </Text>
              <Text size="sm" variant="muted">
                {r.desc}
              </Text>
            </div>
          </>
        ) : (
          <Text size="sm" variant="muted">
            Tap a panel to see what it does.
          </Text>
        )}
      </div>
    </div>
  );
}

export function ReviewMock() {
  return (
    <BrowserFrame label="insight · session review">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="subtle">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Speakers labeled
        </Badge>
        <span className="ml-auto flex gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Markdown
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted">
            <Download className="h-3.5 w-3.5" aria-hidden />
            JSON
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <TranscriptLine time="04:12" speaker="Researcher" text="How does your team handle a handover today?" />
        <TranscriptLine time="04:18" speaker="Participant" text="It is a bit ad hoc. Someone calls, someone writes it on the whiteboard." />
        <div className="ml-14 rounded-md border-l-2 border-success bg-bg-subtle px-3 py-2">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-3.5 w-3.5 text-success" aria-hidden />
            <Text size="xs" weight="semibold" className="text-success">
              Coach cue at 04:26
            </Text>
          </div>
          <Text size="xs" variant="muted" className="mt-1">
            Ask them to walk through the last chaotic handover, start to finish.
          </Text>
        </div>
        <TranscriptLine time="04:31" speaker="Participant" text="When it gets busy it felt chaotic, things slip through the cracks." />
        <TranscriptLine time="04:44" speaker="Researcher" text="Tell me about the last time something slipped." />
      </div>
    </BrowserFrame>
  );
}
