"use client";

import { cn } from "@/lib/utils";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import type { ComponentPropsWithoutRef } from "react";

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof BaseSwitch.Root>) {
  // Drive the thumb travel from the checked state via an inline transform rather
  // than a `data-[checked]:translate-x-*` utility: this project's Tailwind v4
  // build does not emit the spacing-number `translate-x-<n>` utilities the
  // shipped PRIZM class relied on, so that class never applied and the knob
  // stayed put. Inline style is independent of Tailwind generation. (Our usage
  // is always controlled via `checked`; `defaultChecked` covers the fallback.)
  const isChecked = props.checked ?? props.defaultChecked ?? false;
  return (
    <BaseSwitch.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "bg-bg-muted data-[checked]:bg-accent",
        "focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        style={{
          transform: isChecked ? "translateX(1rem)" : "translateX(0)",
          transition: "transform 150ms",
        }}
        className={cn(
          // Hairline border defines the thumb edge in both modes — the surface
          // fill flips dark in dark mode and would otherwise blend into the track.
          "pointer-events-none block h-4 w-4 rounded-full border border-border-strong bg-surface shadow-sm",
        )}
      />
    </BaseSwitch.Root>
  );
}
