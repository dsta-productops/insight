import { cn } from "@/lib/utils";
import { type HTMLAttributes, forwardRef } from "react";

export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-bg-muted", className)}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";
