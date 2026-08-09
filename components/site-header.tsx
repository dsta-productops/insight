"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/live", label: "Live" },
  { href: "/sessions", label: "Sessions" },
  { href: "/documents", label: "Documents" },
  { href: "/glossary", label: "Glossary" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-6">
        <NextLink href="/" className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-accent" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-wide text-fg">
            INSIGHT
          </span>
        </NextLink>
        <nav className="ml-auto flex items-center gap-1">
          {NAV.map((item) => (
            <NextLink
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg",
                pathname?.startsWith(item.href) && "bg-bg-muted text-fg",
              )}
            >
              {item.label}
            </NextLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
