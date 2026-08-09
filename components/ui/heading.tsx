import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type HTMLAttributes, forwardRef } from "react";

const headingVariants = cva("font-semibold tracking-tight text-fg", {
  variants: {
    size: {
      "4xl": "text-4xl",
      "3xl": "text-3xl",
      "2xl": "text-2xl",
      xl: "text-xl",
      lg: "text-lg",
      md: "text-base",
    },
  },
  defaultVariants: { size: "2xl" },
});

export interface HeadingProps
  extends HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, as: Tag = "h2", size, ...props }, ref) => (
    <Tag ref={ref} className={cn(headingVariants({ size }), className)} {...props} />
  ),
);
Heading.displayName = "Heading";
