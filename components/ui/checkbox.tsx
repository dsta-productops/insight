"use client";

import { cn } from "@/lib/utils";
import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { Check } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

export function Checkbox({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface shadow-sm transition-colors",
        "data-[checked]:border-accent data-[checked]:bg-accent data-[checked]:text-accent-fg",
        "data-[indeterminate]:border-accent data-[indeterminate]:bg-accent data-[indeterminate]:text-accent-fg",
        "focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-current data-[unchecked]:hidden">
        <Check className="h-3 w-3" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
