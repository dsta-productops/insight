import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "INSIGHT · Live Companion for Interviews and Conversations",
  description:
    "In-session support for interviews and conversations: transcription, glossary look-ups, and technique coaching.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-zone="enterprise" data-mode="light">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
