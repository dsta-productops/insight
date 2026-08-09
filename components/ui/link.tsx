import { cn } from "@/lib/utils";
import NextLink from "next/link";
import type { ComponentProps } from "react";

export function Link({ className, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink
      className={cn(
        "text-accent underline-offset-4 transition-colors hover:underline",
        "focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}
