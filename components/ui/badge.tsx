import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        solid: "border-transparent bg-accent text-accent-fg",
        outline: "border-border bg-transparent text-fg",
        subtle: "border-transparent bg-bg-muted text-fg-muted",
        success: "border-transparent bg-[oklch(72.3%_0.219_149.58_/_0.15)] text-success",
        warning: "border-transparent bg-[oklch(76.9%_0.188_70.08_/_0.15)] text-warning",
        danger: "border-transparent bg-[oklch(63.7%_0.237_25.33_/_0.15)] text-danger",
        info: "border-transparent bg-[oklch(68.5%_0.169_237.32_/_0.15)] text-info",
      },
    },
    defaultVariants: { variant: "subtle" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
