"use client";

import { cn } from "@/lib/utils";
import { PreviewCard as BasePreviewCard } from "@base-ui-components/react/preview-card";
import type { ComponentPropsWithoutRef } from "react";

export const HoverCard = BasePreviewCard.Root;
export const HoverCardTrigger = BasePreviewCard.Trigger;

export function HoverCardContent({
  className,
  sideOffset = 8,
  variant = "solid",
  ...props
}: ComponentPropsWithoutRef<typeof BasePreviewCard.Popup> & {
  sideOffset?: number;
  variant?: "solid" | "glass";
}) {
  return (
    <BasePreviewCard.Portal>
      <BasePreviewCard.Positioner sideOffset={sideOffset}>
        <BasePreviewCard.Popup
          className={cn(
            "z-50 w-64 rounded-lg border border-border p-4 shadow-md",
            variant === "glass" ? "surface-glass-panel" : "bg-surface-elevated",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
            "transition-all duration-150",
            className,
          )}
          {...props}
        />
      </BasePreviewCard.Positioner>
    </BasePreviewCard.Portal>
  );
}
