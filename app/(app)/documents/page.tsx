"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { Eye, FileText, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
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

interface DocumentMeta {
  id: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
  bytes: number;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentMeta[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents");
    const json = await res.json();
    const next: DocumentMeta[] = json.documents ?? [];
    setDocuments(next);
    // Drop any selections that no longer exist.
    setSelected((prev) => {
      const ids = new Set(next.map((d) => d.id));
      const kept = [...prev].filter((id) => ids.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(documents?.map((d) => d.id)) : new Set());
  }

  async function onFileSelected(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
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

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const params = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
      const res = await fetch(`/api/documents?${params}`, { method: "DELETE" });
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Heading as="h1" size="2xl">Documents</Heading>
          <Text variant="muted">
            Pre-session reference material (PRDs, briefs). Accepts plain text,
            Markdown, and PDF files.
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
            accept=".txt,.md,.markdown,.pdf"
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
            {uploading ? "Indexing…" : "Upload document"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger">
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {documents === null ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No documents yet"
          description="Upload a PRD or brief to make it available for in-session retrieval."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              Upload document
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all documents"
                  checked={selected.size === documents.length}
                  indeterminate={selected.size > 0 && selected.size < documents.length}
                  onCheckedChange={(checked) => toggleAll(checked)}
                />
              </TableHead>
              <TableHead>File</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((d) => (
              <TableRow key={d.id} data-state={selected.has(d.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${d.filename}`}
                    checked={selected.has(d.id)}
                    onCheckedChange={(checked) => toggle(d.id, checked)}
                  />
                </TableCell>
                <TableCell className="font-medium">{d.filename}</TableCell>
                <TableCell>{new Date(d.uploadedAt).toLocaleString()}</TableCell>
                <TableCell>{(d.bytes / 1024).toFixed(1)} KB</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <NextLink
                      href={`/documents/${d.id}`}
                      aria-label={`View ${d.filename}`}
                      className={buttonVariants({ variant: "ghost", size: "icon" })}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </NextLink>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${d.filename}`}
                      disabled={deleting}
                      onClick={() => setPendingDelete([d.id])}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
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
            ? `Delete ${pendingDelete?.length} documents?`
            : "Delete document?"
        }
        description={
          (pendingDelete?.length ?? 0) > 1
            ? `This permanently removes ${pendingDelete?.length} documents and their indexed chunks. This cannot be undone.`
            : "This permanently removes the document and its indexed chunks. This cannot be undone."
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
