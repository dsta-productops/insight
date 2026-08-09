import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip a leading markdown list marker ("- ", "* ", "• ", "1. ", "1) ") that
 * the local model sometimes emits inside a bullet's own text. Without this the
 * marker doubles up with our rendered bullet dot / the "- " we prepend on
 * export. Pure + client-safe.
 */
export function stripListMarker(s: string): string {
  return s.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, "").trim();
}
