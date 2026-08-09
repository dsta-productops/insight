import { cn } from "@/lib/utils";
import { type LabelHTMLAttributes, forwardRef } from "react";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // Primitive: htmlFor is supplied by consumers. The lint rule fires because
    // the bare label has no control association at the source — by design.
    // biome-ignore lint/a11y/noLabelWithoutControl: consumer supplies htmlFor
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-tight text-fg",
        // Base UI controls expose disabled via data-disabled (the peer is a
        // span/div, not a native :disabled control), so target both.
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        "peer-data-[disabled]:cursor-not-allowed peer-data-[disabled]:opacity-70",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";
