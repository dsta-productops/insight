"use client";

import { use, useEffect, useState } from "react";
import NextLink from "next/link";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";

interface DocumentDoc {
  id: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
  bytes: number;
  text: string;
}

export default function DocumentViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [doc, setDoc] = useState<DocumentDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/documents/${id}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `Could not load document (${res.status}).`);
        return;
      }
      const json = await res.json();
      setDoc(json.document);
    })();
  }, [id]);

  return (
    <div className="space-y-6">
      <div>
        <NextLink
          href="/documents"
          className="mb-2 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All documents
        </NextLink>
        {doc && (
          <div className="space-y-1">
            <Heading as="h1" size="2xl">{doc.filename}</Heading>
            <Text variant="muted">
              Uploaded {new Date(doc.uploadedAt).toLocaleString()} ·{" "}
              {(doc.bytes / 1024).toFixed(1)} KB · {doc.chunkCount} chunks
              indexed
            </Text>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="danger">
          <AlertTitle>Unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!doc && !error ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        doc && (
          <Card>
            <CardContent className="py-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-fg">
                {doc.text}
              </pre>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
