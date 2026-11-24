"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { stripListMarker } from "@/lib/utils";

export interface RecapDocLike {
  updatedAt: string;
  provider?: string;
  bullets: string[];
  sections?: { title: string; points: string[] }[];
  editedAt?: string;
}

export interface RecapVersionLike {
  id: string;
  savedAt: string;
  doc: RecapDocLike;
}

type Line = { kind: "title" | "point"; text: string };

/** Flatten a recap (detailed sections, else flat bullets) into comparable lines. */
function toLines(doc: RecapDocLike): Line[] {
  if (doc.sections && doc.sections.length > 0) {
    return doc.sections.flatMap((s) => [
      ...(s.title ? [{ kind: "title" as const, text: s.title }] : []),
      ...s.points.map((p) => ({ kind: "point" as const, text: stripListMarker(p) })),
    ]);
  }
  return doc.bullets.map((b) => ({ kind: "point" as const, text: stripListMarker(b) }));
}

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

function versionLabel(v: RecapVersionLike): string {
  const when = new Date(v.savedAt).toLocaleString();
  return `${v.doc.editedAt ? "Edited" : "Generated"} · ${when}`;
}

function Column({
  heading,
  badge,
  lines,
  otherSet,
  mark,
}: {
  heading: string;
  badge?: string;
  lines: Line[];
  otherSet: Set<string>;
  /** How lines missing from the other side are marked. */
  mark: "removed" | "added";
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <Text size="sm" className="font-medium">{heading}</Text>
        {badge && <Badge variant="outline">{badge}</Badge>}
      </div>
      <div className="max-h-[24rem] space-y-1 overflow-y-auto rounded-md border border-border bg-bg-subtle p-3">
        {lines.length === 0 && <Text size="sm" variant="muted">Empty.</Text>}
        {lines.map((l, i) => {
          const differs = !otherSet.has(norm(l.text));
          return (
            <div
              key={i}
              className={[
                "flex gap-2 border-l-2 pl-2",
                differs ? (mark === "added" ? "border-success" : "border-danger") : "border-transparent",
              ].join(" ")}
            >
              {differs && (
                <span
                  aria-label={mark}
                  className={`w-3 shrink-0 text-sm ${mark === "added" ? "text-success" : "text-danger"}`}
                >
                  {mark === "added" ? "+" : "−"}
                </span>
              )}
              {l.kind === "title" ? (
                <Heading as="h4" size="md">{l.text}</Heading>
              ) : (
                <Text size="sm" className={differs ? "" : "text-fg-muted"}>{l.text}</Text>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Side-by-side comparison of a previous recap version against the current one.
 * Lines present on only one side are marked (+ added / − removed); unchanged
 * lines are dimmed. Matching is by normalized text, so it works for both the
 * model's regenerations and hand edits.
 */
export function RecapCompare({
  versions,
  current,
  busy,
  onRestore,
}: {
  versions: RecapVersionLike[] | null;
  current: RecapDocLike;
  busy: boolean;
  onRestore: (versionId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = versions?.find((v) => v.id === selectedId) ?? versions?.[0] ?? null;

  const currentLines = useMemo(() => toLines(current), [current]);
  const selectedLines = useMemo(() => (selected ? toLines(selected.doc) : []), [selected]);
  const currentSet = useMemo(() => new Set(currentLines.map((l) => norm(l.text))), [currentLines]);
  const selectedSet = useMemo(() => new Set(selectedLines.map((l) => norm(l.text))), [selectedLines]);

  if (versions === null) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <Text size="sm" variant="muted">
        No earlier versions yet. A version is saved each time you regenerate, edit or restore the recap.
      </Text>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Text size="sm" variant="muted">Compare current with</Text>
        <Select value={selected?.id ?? ""} onValueChange={(v) => v && setSelectedId(v as string)}>
          <SelectTrigger aria-label="Earlier recap version" className="w-auto min-w-64 gap-3">
            <span className="truncate">{selected ? versionLabel(selected) : ""}</span>
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.id} value={v.id}>{versionLabel(v)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onRestore(selected.id)}>
            {busy ? <Spinner className="h-4 w-4 text-current" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Restore this version
          </Button>
        )}
      </div>
      {selected && (
        <div className="grid gap-4 md:grid-cols-2">
          <Column
            heading="Earlier version"
            badge={selected.doc.provider}
            lines={selectedLines}
            otherSet={currentSet}
            mark="removed"
          />
          <Column
            heading="Current"
            badge={current.provider}
            lines={currentLines}
            otherSet={selectedSet}
            mark="added"
          />
        </div>
      )}
    </div>
  );
}
