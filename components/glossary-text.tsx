"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export interface GlossaryTerm {
  term: string;
  expansion: string;
  definition?: string;
}

/** Loads the glossary once per mount (local API, no network surface). */
export function useGlossary(): GlossaryTerm[] {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/glossary")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && Array.isArray(j?.glossary)) setTerms(j.glossary);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return terms;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Renders text with glossary terms highlighted yellow (the `warning` token).
 * Hovering or focusing a term opens a hover card with the definition instantly.
 */
export function GlossaryText({ text, terms }: { text: string; terms: GlossaryTerm[] }) {
  const { re, byKey } = useMemo(() => {
    const list = terms.filter((t) => t.term.trim());
    if (list.length === 0) return { re: null, byKey: new Map<string, GlossaryTerm>() };
    // Longest first so "user research" wins over "user"; word-bounded.
    const alt = list
      .map((t) => escapeRe(t.term.trim()))
      .sort((a, b) => b.length - a.length)
      .join("|");
    return {
      re: new RegExp(`(?<![\\w])(${alt})(?![\\w])`, "gi"),
      byKey: new Map(list.map((t) => [t.term.trim().toLowerCase(), t])),
    };
  }, [terms]);

  if (!re) return <>{text}</>;
  const parts = text.split(re); // odd indices are matches
  return (
    <>
      {parts.map((p, i) => {
        const g = i % 2 === 1 ? byKey.get(p.toLowerCase()) : undefined;
        if (!g) return <Fragment key={i}>{p}</Fragment>;
        return (
          <HoverCard key={i}>
            <HoverCardTrigger
              delay={0}
              closeDelay={100}
              render={<mark />}
              className="cursor-help rounded-xs bg-transparent text-inherit underline decoration-dotted decoration-fg-subtle underline-offset-4 transition-colors hover:bg-highlight data-[popup-open]:bg-highlight"
              tabIndex={0}
            >
              {p}
            </HoverCardTrigger>
            <HoverCardContent className="w-72 space-y-1">
              <p className="text-sm font-semibold text-fg">{g.term}</p>
              {g.expansion && <p className="text-sm text-fg-muted">{g.expansion}</p>}
              {g.definition && <p className="text-sm leading-relaxed text-fg">{g.definition}</p>}
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </>
  );
}
