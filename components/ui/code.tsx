import { cn } from "@/lib/utils";
import { type HTMLAttributes, forwardRef } from "react";

// Inline code
export const Code = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <code
      ref={ref}
      className={cn(
        "relative rounded border border-border bg-bg-muted px-[0.4em] py-[0.2em]",
        "font-mono text-[0.875em] text-fg",
        className,
      )}
      {...props}
    />
  ),
);
Code.displayName = "Code";

// Block code (preformatted)
export const CodeBlock = forwardRef<HTMLPreElement, HTMLAttributes<HTMLPreElement>>(
  ({ className, ...props }, ref) => (
    <pre
      ref={ref}
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-bg-muted p-4",
        "font-mono text-sm text-fg leading-relaxed",
        className,
      )}
      {...props}
    />
  ),
);
CodeBlock.displayName = "CodeBlock";
