"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookMarked, Plus, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";

interface GlossaryEntry {
  term: string;
  expansion: string;
  definition?: string;
  tags?: string[];
}

const EMPTY_FORM = { term: "", expansion: "", definition: "", tags: "" };

export default function GlossaryPage() {
  const [entries, setEntries] = useState<GlossaryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/glossary");
    const json = await r.json();
    setEntries(json.glossary ?? []);
  }, []);

  useEffect(() => {
    refresh().catch(() =>
      setError("Could not load the glossary."),
    );
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.expansion?.toLowerCase().includes(q) ||
        e.definition?.toLowerCase().includes(q),
    );
  }, [entries, query]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setAddOpen(true);
  }

  async function saveTerm() {
    const term = form.term.trim();
    const definition = form.definition.trim();
    if (!term || !form.expansion.trim()) {
      setFormError("Term and expansion are both required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const r = await fetch("/api/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term,
          expansion: form.expansion.trim(),
          definition,
          tags: form.tags,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error ?? `Save failed (${r.status}).`);
      setEntries(json.glossary ?? null);
      setAddOpen(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save the term.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTerm(term: string) {
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/glossary?term=${encodeURIComponent(term)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const json = await r.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed (${r.status}).`);
      }
      await refresh();
      setPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the term.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Heading as="h1" size="2xl">Glossary</Heading>
          <Text variant="muted">
            Acronyms and jargon surfaced during live sessions.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add term
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <Input
          className="pl-9"
          placeholder="Search terms…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search glossary"
        />
      </div>

      {filtered === null ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookMarked className="h-6 w-6" />}
          title={query ? "No matching terms" : "No glossary terms yet"}
          description={query ? "Try a different search." : "Add a term to get started."}
          action={
            !query ? (
              <Button variant="outline" size="sm" onClick={openAdd}>
                Add term
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Term</TableHead>
              <TableHead className="w-56">Expansion</TableHead>
              <TableHead>Definition</TableHead>
              <TableHead className="w-40">Tags</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.term}>
                <TableCell className="font-medium">{e.term}</TableCell>
                <TableCell>{e.expansion ?? "-"}</TableCell>
                <TableCell className="max-w-xl whitespace-normal">
                  {e.definition ?? "-"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {e.tags?.map((t) => (
                      <Badge key={t} variant="outline">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${e.term}`}
                    onClick={() => setPendingDelete(e.term)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add glossary term</DialogTitle>
            <DialogDescription>
              Definitions are shared across sessions and surfaced live when the
              term comes up.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_1.6fr]">
              <div className="space-y-1.5">
                <Label htmlFor="g-term">Term</Label>
                <Input
                  id="g-term"
                  autoFocus
                  value={form.term}
                  placeholder="e.g. PRD"
                  onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-expansion">Expansion</Label>
                <Input
                  id="g-expansion"
                  value={form.expansion}
                  placeholder="e.g. Product Requirements Document"
                  onChange={(e) => setForm((f) => ({ ...f, expansion: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-definition">Definition (optional)</Label>
              <Textarea
                id="g-definition"
                rows={3}
                value={form.definition}
                placeholder="What it means, in plain language."
                onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-tags">Tags (optional)</Label>
              <Input
                id="g-tags"
                value={form.tags}
                placeholder="Comma-separated, e.g. product, research"
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </div>
            {formError && (
              <Text size="sm" className="text-danger">
                {formError}
              </Text>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={saveTerm} disabled={saving}>
              {saving && <Spinner className="h-4 w-4" />}
              Add term
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete term?"
        description={
          pendingDelete
            ? `This removes “${pendingDelete}” from the glossary and from live retrieval. This cannot be undone.`
            : ""
        }
        busy={deleting}
        onConfirm={() => {
          if (pendingDelete) deleteTerm(pendingDelete);
        }}
      />
    </div>
  );
}
