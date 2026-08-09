import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type SVGAttributes, forwardRef } from "react";

const spinnerVariants = cva("animate-spin text-fg-muted", {
  variants: {
    size: {
      sm: "h-3 w-3",
      md: "h-4 w-4",
      lg: "h-6 w-6",
      xl: "h-10 w-10",
    },
  },
  defaultVariants: { size: "md" },
});

export interface SpinnerProps
  extends SVGAttributes<SVGElement>,
    VariantProps<typeof spinnerVariants> {
  label?: string;
}

export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size, label = "Loading", ...props }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // biome-ignore lint/a11y/useSemanticElements: <svg role="status"> is the standard live-region pattern for an inline loading indicator with an aria-label.
      role="status"
      aria-label={label}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    >
      <title>{label}</title>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  ),
);
Spinner.displayName = "Spinner";
