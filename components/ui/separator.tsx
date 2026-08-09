import { cn } from "@/lib/utils";
import { Separator as BaseSeparator } from "@base-ui-components/react/separator";
import type { ComponentPropsWithoutRef } from "react";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: ComponentPropsWithoutRef<typeof BaseSeparator>) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
