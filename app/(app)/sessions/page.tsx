"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { AudioLines, Check, Pencil, Trash2, Upload, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
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
import { getMode, type ModeId } from "@/lib/modes/registry";

interface SessionMeta {
  id: string;
  title: string;
  filename: string;
  uploadedAt: string;
  status: "live" | "transcribing" | "done" | "error";
  provider: string;
  mode?: ModeId;
  durationSec?: number;
  error?: string;
}

const STATUS_BADGE: Record<SessionMeta["status"], "info" | "warning" | "success" | "danger"> = {
  live: "info",
  transcribing: "warning",
  done: "success",
  error: "danger",
};

function formatDuration(sec?: number): string {
  if (!sec) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sessions");
    const json = await res.json();
    const next: SessionMeta[] = json.sessions ?? [];
    setSessions(next);
    // Drop any selections that no longer exist.
    setSelected((prev) => {
      const ids = new Set(next.map((s) => s.id));
      const kept = [...prev].filter((id) => ids.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any session is still transcribing.
  useEffect(() => {
    if (!sessions?.some((s) => s.status === "transcribing")) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [sessions, refresh]);

  async function onFileSelected(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/sessions", { method: "POST", body: form });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Upload failed (${res.status}).`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(sessions?.map((s) => s.id)) : new Set());
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const params = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
      const res = await fetch(`/api/sessions?${params}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed (${res.status}).`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  function startRename(s: SessionMeta) {
    setEditingId(s.id);
    setEditValue(s.title);
  }

  function cancelRename() {
    setEditingId(null);
    setEditValue("");
  }

  async function saveRename(id: string) {
    const title = editValue.trim();
    const current = sessions?.find((s) => s.id === id);
    if (!title || title === current?.title) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Rename failed (${res.status}).`);
      }
      await refresh();
      cancelRename();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setSavingRename(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Heading as="h1" size="2xl">Sessions</Heading>
          <Text variant="muted">
            Upload a recording to transcribe it, or open a finished session to
            review the labeled transcript with the coach cues it surfaced.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="outline"
              onClick={() => setPendingDelete([...selected])}
              disabled={deleting}
            >
              {deleting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              Delete selected ({selected.size})
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".wav,.mp3,.m4a,.aiff,.aif,.caf,.mp4"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileSelected(f);
            }}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            {uploading ? "Uploading…" : "Upload recording"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger">
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {sessions === null ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<AudioLines className="h-6 w-6" />}
          title="No sessions yet"
          description="Upload an interview recording to transcribe it."
          action={
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              Upload recording
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all sessions"
                  checked={selected.size === sessions.length}
                  indeterminate={selected.size > 0 && selected.size < sessions.length}
                  onCheckedChange={(checked) => toggleAll(checked)}
                />
              </TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id} data-state={selected.has(s.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${s.title}`}
                    checked={selected.has(s.id)}
                    onCheckedChange={(checked) => toggle(s.id, checked)}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {editingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={editValue}
                        disabled={savingRename}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(s.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="h-8 max-w-xs"
                        aria-label={`Rename ${s.title}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Save name"
                        disabled={savingRename}
                        onClick={() => saveRename(s.id)}
                      >
                        {savingRename ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        )}
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
                    <div className="space-y-0.5">
                      <div className="group flex items-center gap-1.5">
                        {s.status === "done" ? (
                          <NextLink href={`/sessions/${s.id}`} className="text-accent hover:underline">
                            {s.title}
                          </NextLink>
                        ) : (
                          s.title
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Rename ${s.title}`}
                          className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => startRename(s)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                      <Text size="xs" variant="subtle" className="font-normal">
                        {getMode(s.mode).label}
                      </Text>
                    </div>
                  )}
                </TableCell>
                <TableCell>{new Date(s.uploadedAt).toLocaleString()}</TableCell>
                <TableCell>{formatDuration(s.durationSec)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_BADGE[s.status]}>{s.status}</Badge>
                    {s.status === "transcribing" && <Spinner className="h-3 w-3" />}
                  </div>
                  {s.status === "error" && s.error && (
                    <Text size="xs" variant="muted" className="mt-1 max-w-xs">
                      {s.error}
                    </Text>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${s.title}`}
                    disabled={deleting}
                    onClick={() => setPendingDelete([s.id])}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={
          (pendingDelete?.length ?? 0) > 1
            ? `Delete ${pendingDelete?.length} sessions?`
            : "Delete session?"
        }
        description={
          (pendingDelete?.length ?? 0) > 1
            ? `This permanently removes ${pendingDelete?.length} sessions, including their transcripts and coach cues. This cannot be undone.`
            : "This permanently removes the session, its transcript, and coach cues. This cannot be undone."
        }
        busy={deleting}
        onConfirm={async () => {
          const ids = pendingDelete ?? [];
          await deleteIds(ids);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
