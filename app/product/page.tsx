import type { Metadata } from "next";
import NextLink from "next/link";
import {
  BookOpen,
  Check,
  Cpu,
  Download,
  FileText,
  Gauge,
  HardDrive,
  Laptop,
  ListChecks,
  Lock,
  MemoryStick,
  MessageCircleQuestion,
  Mic,
  Monitor,
  Radar,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { HeroLive, LiveLayoutMock, ReviewMock, SummaryMock } from "./mocks";

export const metadata: Metadata = {
  title: "INSIGHT · A live companion for user interviews",
  description:
    "INSIGHT listens alongside you during interviews and surfaces the right follow-up, a definition, or relevant context in the moment. Runs entirely on your machine.",
};

/* ------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------ */

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#surfaces", label: "What it surfaces" },
  { href: "#offline", label: "Runs on your machine" },
  { href: "#requirements", label: "What you'll need" },
];

/**
 * INSIGHT is becoming a standalone Mac / Windows desktop app; the builds are in
 * active development and not yet downloadable, so the buttons are disabled.
 * When packaging ships, add the signed installer `href` and enable the button.
 */
const DOWNLOADS = [
  { platform: "macOS", detail: "Apple silicon · .dmg", icon: Laptop },
  { platform: "Windows", detail: "Windows 10 and 11 · .exe", icon: Monitor },
];

/**
 * Minimum specs the local models (Llama-3.1-8B coach + Whisper) need to feel
 * real-time. Kept in sync with the `insight-system-requirements` memory. The
 * Windows GPU line is the load-bearing one — see the caveat callout below.
 */
const REQUIREMENTS = [
  {
    platform: "macOS",
    icon: Laptop,
    subtitle: "Apple silicon only",
    specs: [
      { icon: Cpu, label: "Chip", value: "Apple M1 or later" },
      { icon: MemoryStick, label: "Memory", value: "16 GB (32 GB recommended)" },
      { icon: Monitor, label: "System", value: "macOS 12 Monterey or later" },
      { icon: HardDrive, label: "Storage", value: "10 GB free" },
    ],
  },
  {
    platform: "Windows",
    icon: Monitor,
    subtitle: "Windows 10 / 11 · 64-bit",
    specs: [
      { icon: Gauge, label: "Graphics", value: "NVIDIA RTX GPU, 8 GB VRAM" },
      { icon: MemoryStick, label: "Memory", value: "16 GB (32 GB recommended)" },
      { icon: Cpu, label: "Processor", value: "8-core, 64-bit" },
      { icon: HardDrive, label: "Storage", value: "10 GB free" },
    ],
  },
];

// Optional pre-step: not part of the three-step flow, shown as a lead-in.
const PREP = {
  icon: FileText,
  title: "Prepare the ground",
  body: "Upload the PRD or brief and add the terms your team uses. INSIGHT reads them so its help is grounded in your project, not generic advice.",
};

const STEPS = [
  {
    icon: Mic,
    title: "Start listening",
    body: "Press start and INSIGHT transcribes the conversation in near real time, on device.",
  },
  {
    icon: Sparkles,
    title: "Get a nudge, in the moment",
    body: "One suggestion at a time on the Now card: a follow-up to ask, a definition for a piece of jargon, or a relevant snippet from your documents.",
  },
  {
    icon: Download,
    title: "Review and export",
    body: "End the session for a speaker labeled transcript with every coach cue anchored in time, ready to export as Markdown or JSON.",
  },
];

const SURFACES = [
  {
    icon: MessageCircleQuestion,
    tint: "text-success",
    badge: "success" as const,
    label: "Follow-up",
    title: "A follow-up question",
    body: "Shaped by the live flow of the conversation and grounded in proven interview technique, so every probe goes deeper without leading the participant.",
  },
  {
    icon: BookOpen,
    tint: "text-fg-muted",
    badge: "subtle" as const,
    label: "Definition",
    title: "An instant definition",
    body: "Jargon and acronyms explained the moment they come up, drawn from your glossary so you never have to break the conversation to ask.",
  },
  {
    icon: FileText,
    tint: "text-info",
    badge: "info" as const,
    label: "Context",
    title: "Relevant context",
    body: "The right snippet from your uploaded documents and PRDs, surfaced in time to connect what you are hearing to what was planned.",
  },
];

const TECHNIQUES = [
  "Five Whys",
  "Laddering",
  "Neutral vs leading",
  "Contrastive questioning",
  "Critical incident technique",
  "Silence tolerance",
  "Satisficing awareness",
];

const SUMMARY_POINTS = [
  "A factual recap of what was said, not analysis or conclusions.",
  "Updates quietly as the conversation moves, so it is always current.",
  "Hide it whenever you want a calmer view; it picks up where it left off.",
];

const OFFLINE = [
  {
    icon: WifiOff,
    title: "Fully offline",
    body: "INSIGHT is built to work air gapped, so it is usable even without network connection.",
  },
  {
    icon: Cpu,
    title: "Local intelligence",
    body: "Transcription and coaching run on your machine with local models. Nothing about the conversation leaves the device.",
  },
  {
    icon: ShieldCheck,
    title: "You own the record",
    body: "Sessions, transcripts, and audio stay on disk as plain files. Nothing is shared until you export it yourself.",
  },
];

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function ProductPage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <NextLink href="/product" className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-accent" aria-hidden />
            <span className="text-sm font-semibold tracking-wide text-fg">INSIGHT</span>
          </NextLink>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a
            href="#download"
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover md:ml-0"
          >
            <Download className="h-4 w-4" aria-hidden />
            Get INSIGHT
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-bg-subtle to-bg">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 right-[-10%] h-96 w-96 rounded-full bg-accent/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 left-[-10%] h-96 w-96 rounded-full bg-info/10 blur-3xl"
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:py-24">
          <div>
            <Badge variant="outline" className="mb-5">
              <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
              Live companion for interviews and conversations
            </Badge>
            <Heading
              as="h1"
              size="4xl"
              className="text-4xl leading-[1.05] sm:text-5xl lg:text-6xl"
            >
              You run the user interview.
              <br />
              <span className="text-accent">INSIGHT runs alongside you.</span>
            </Heading>
            <Text size="lg" variant="muted" className="mt-5 max-w-xl">
              INSIGHT listens as you talk and surfaces the right follow-up, a
              definition, or relevant context in the moment, so you can focus on
              the conversation and elicit deeper insights.
            </Text>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#how">
                <Button size="lg">See how it works</Button>
              </a>
              <a href="#download">
                <Button size="lg" variant="outline" className="gap-2">
                  <Download className="h-4 w-4" aria-hidden />
                  Get INSIGHT
                </Button>
              </a>
            </div>
            <Text size="sm" variant="subtle" className="mt-3">
              Native apps for macOS and Windows, coming soon. Runs fully offline
              once installed.
            </Text>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <WifiOff className="h-4 w-4" aria-hidden />
                Runs offline
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-4 w-4" aria-hidden />
                No accounts
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Your data stays on device
              </span>
            </div>
          </div>
          <HeroLive />
        </div>
      </section>

      {/* The shift */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <Heading as="h2" size="3xl">
            Interviewing well takes two jobs at once
          </Heading>
          <Text size="lg" variant="muted" className="mt-4">
            You have to listen closely and, at the same time, decide where to
            probe next, catch the jargon, and remember what the background is.
            INSIGHT takes the second job, so you can give the person in front of
            you your full attention.
          </Text>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-y border-border bg-bg-subtle">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <div className="max-w-2xl">
            <Badge variant="outline" className="mb-4">
              How it works
            </Badge>
            <Heading as="h2" size="3xl">
              Almost nothing to set up
            </Heading>
            <Text size="lg" variant="muted" className="mt-4">
              Prep is optional. Once you start, INSIGHT listens, helps in the
              moment, and hands you a full record when you finish.
            </Text>
          </div>

          {/* Optional pre-step */}
          <Card className="mt-12 bg-bg">
            <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:gap-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-bg-muted text-fg-muted">
                  <PREP.icon className="h-4 w-4" aria-hidden />
                </span>
                <Badge variant="outline">Optional</Badge>
              </div>
              <div>
                <Heading as="h3" size="lg">
                  {PREP.title}
                </Heading>
                <Text size="sm" variant="muted" className="mt-1">
                  {PREP.body}
                </Text>
              </div>
            </CardContent>
          </Card>

          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <Card key={step.title} className="flex h-full flex-col">
                  <CardContent className="flex h-full flex-col gap-3 p-6">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
                        {i + 1}
                      </span>
                      <Icon className="h-5 w-5 text-fg-muted" aria-hidden />
                    </div>
                    <Heading as="h3" size="lg">
                      {step.title}
                    </Heading>
                    <Text size="sm" variant="muted">
                      {step.body}
                    </Text>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* What it surfaces */}
      <section id="surfaces" className="scroll-mt-20 mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
        <div className="max-w-2xl">
          <Badge variant="outline" className="mb-4">
            What it surfaces
          </Badge>
          <Heading as="h2" size="3xl">
            One clear nudge at a time
          </Heading>
          <Text size="lg" variant="muted" className="mt-4">
            As the conversation unfolds, INSIGHT surfaces the single most useful
            suggestion in real time, phrased as something you can say out loud.
          </Text>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {SURFACES.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.title} className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="flex items-center justify-between">
                    <Icon className={cn("h-6 w-6", s.tint)} aria-hidden />
                    <Badge variant={s.badge}>{s.label}</Badge>
                  </div>
                  <Heading as="h3" size="lg">
                    {s.title}
                  </Heading>
                  <Text size="sm" variant="muted">
                    {s.body}
                  </Text>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="mt-8 bg-bg-subtle">
          <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-md">
              <Heading as="h3" size="lg">
                Coaching from real interview technique
              </Heading>
              <Text size="sm" variant="muted" className="mt-2">
                Follow-ups draw on a corpus of established methods, and every
                suggestion carries the reason it was offered.
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              {TECHNIQUES.map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Running summary */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <Badge variant="outline" className="mb-4">
              <ListChecks className="h-3.5 w-3.5 text-accent" aria-hidden />
              Running summary
            </Badge>
            <Heading as="h2" size="3xl">
              Glance away without losing the context
            </Heading>
            <Text size="lg" variant="muted" className="mt-4">
              A short running recap of what has been covered, there for the
              moment you glance up and lose your place. One look and you are
              back, without scrolling the transcript.
            </Text>
            <div className="mt-7 flex flex-col gap-3">
              {SUMMARY_POINTS.map((p) => (
                <div key={p} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <Text size="sm" variant="muted">
                    {p}
                  </Text>
                </div>
              ))}
            </div>
          </div>
          <SummaryMock />
        </div>
      </section>

      {/* Product showcase */}
      <section className="border-y border-border bg-bg-subtle">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 py-16 lg:py-24">
          {/* The live view, laid out */}
          <div>
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="success" className="mb-4">
                In the room
              </Badge>
              <Heading as="h2" size="2xl">
                The whole live view on one screen
              </Heading>
              <Text size="md" variant="muted" className="mt-4">
                While you record, the live session goes into full screen.
              </Text>
            </div>
            <div className="mt-10">
              <LiveLayoutMock />
            </div>
          </div>

          <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
            <div className="lg:order-2">
              <Badge variant="info" className="mb-4">
                After the session
              </Badge>
              <Heading as="h2" size="2xl">
                No manual note taking
              </Heading>
              <Text size="md" variant="muted" className="mt-4">
                You never have to write anything down. End the session and
                INSIGHT labels who said what and anchors each coach cue to the
                moment it appeared, ready to export as Markdown or JSON when you
                write it up.
              </Text>
            </div>
            <div className="lg:order-1">
              <ReviewMock />
            </div>
          </div>
        </div>
      </section>

      {/* Offline / privacy */}
      <section id="offline" className="scroll-mt-20 mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
        <div className="max-w-2xl">
          <Badge variant="outline" className="mb-4">
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
            Runs on your machine
          </Badge>
          <Heading as="h2" size="3xl">
            Private because it never leaves the device
          </Heading>
          <Text size="lg" variant="muted" className="mt-4">
            Transcription and coaching run locally, so real interview data stays
            with you.
          </Text>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {OFFLINE.map((o) => {
            const Icon = o.icon;
            return (
              <Card key={o.title} className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <Icon className="h-6 w-6 text-accent" aria-hidden />
                  <Heading as="h3" size="lg">
                    {o.title}
                  </Heading>
                  <Text size="sm" variant="muted">
                    {o.body}
                  </Text>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* System requirements */}
      <section
        id="requirements"
        className="scroll-mt-20 border-t border-border bg-bg-subtle"
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <div className="max-w-2xl">
            <Badge variant="outline" className="mb-4">
              <Cpu className="h-3.5 w-3.5" aria-hidden />
              What you'll need
            </Badge>
            <Heading as="h2" size="3xl">
              Built to run on the machine in front of you
            </Heading>
            <Text size="lg" variant="muted" className="mt-4">
              Transcription and the coach run entirely on device, so the local
              models set the bar. These are the specs that keep suggestions
              arriving in real time.
            </Text>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {REQUIREMENTS.map((req) => {
              const PlatformIcon = req.icon;
              return (
                <Card key={req.platform} className="h-full bg-bg">
                  <CardContent className="flex h-full flex-col gap-5 p-6">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                        <PlatformIcon className="h-5 w-5" aria-hidden />
                      </span>
                      <div>
                        <Heading as="h3" size="lg">
                          {req.platform}
                        </Heading>
                        <Text size="sm" variant="subtle">
                          {req.subtitle}
                        </Text>
                      </div>
                    </div>
                    <dl className="flex flex-col gap-3">
                      {req.specs.map((spec) => {
                        const SpecIcon = spec.icon;
                        return (
                          <div key={spec.label} className="flex items-start gap-3">
                            <SpecIcon
                              className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted"
                              aria-hidden
                            />
                            <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
                              <dt className="text-sm text-fg-muted">{spec.label}</dt>
                              <dd className="text-sm font-medium text-fg">
                                {spec.value}
                              </dd>
                            </div>
                          </div>
                        );
                      })}
                    </dl>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Alert className="mt-5">
            <Gauge className="h-4 w-4" aria-hidden />
            <AlertDescription>
              The live coach relies on the GPU. On a Windows machine without a
              compatible discrete GPU, transcription still runs, but coach
              suggestions arrive noticeably slower. On macOS the coach uses the
              Apple silicon GPU, so Intel Macs are not supported.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      {/* Download */}
      <section id="download" className="scroll-mt-20 border-t border-border bg-bg-subtle">
        <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
          <Badge variant="outline" className="mb-4">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download
          </Badge>
          <Heading as="h2" size="3xl">
            Coming to macOS and Windows
          </Heading>
          <Text size="lg" variant="muted" className="mx-auto mt-4 max-w-xl">
            INSIGHT is a standalone desktop app. The macOS and Windows
            builds are in active development and will run fully offline, with no
            account and no setup.
          </Text>
          <div className="mx-auto mt-10 grid max-w-xl gap-4 sm:grid-cols-2">
            {DOWNLOADS.map((d) => {
              const Icon = d.icon;
              return (
                <Card key={d.platform} className="text-left">
                  <CardContent className="flex flex-col gap-3 p-6">
                    <div className="flex items-center justify-between">
                      <Icon className="h-7 w-7 text-accent" aria-hidden />
                      <Badge variant="warning">Coming soon</Badge>
                    </div>
                    <div>
                      <Heading as="h3" size="lg">
                        {d.platform}
                      </Heading>
                      <Text size="sm" variant="subtle" className="mt-1">
                        {d.detail}
                      </Text>
                    </div>
                    <Button variant="outline" className="mt-1 w-full gap-2" disabled>
                      <Download className="h-4 w-4" aria-hidden />
                      Download for {d.platform}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Text size="xs" variant="subtle" className="mt-6">
            Your interviews never leave your device.
          </Text>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-accent" aria-hidden />
            <span className="text-sm font-semibold tracking-wide text-fg">INSIGHT</span>
            <Separator orientation="vertical" className="mx-2 h-4" />
            <Text size="sm" variant="subtle">
              Live companion for interviews and conversations
            </Text>
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm text-fg-muted">
            <a href="#how" className="transition-colors hover:text-fg">
              How it works
            </a>
            <a href="#surfaces" className="transition-colors hover:text-fg">
              What it surfaces
            </a>
            <a href="#offline" className="transition-colors hover:text-fg">
              Runs on your machine
            </a>
            <a href="#requirements" className="transition-colors hover:text-fg">
              What you'll need
            </a>
            <a href="#download" className="transition-colors hover:text-fg">
              Download
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
