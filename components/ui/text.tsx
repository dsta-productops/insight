import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type HTMLAttributes, forwardRef } from "react";

const textVariants = cva("", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      md: "text-base",
      lg: "text-lg",
    },
    variant: {
      default: "text-fg",
      muted: "text-fg-muted",
      subtle: "text-fg-subtle",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
    },
  },
  defaultVariants: { size: "md", variant: "default", weight: "normal" },
});

export interface TextProps
  extends HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {
  as?: "p" | "span" | "div";
}

export const Text = forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, as: Tag = "p", size, variant, weight, ...props }, ref) => (
    <Tag ref={ref} className={cn(textVariants({ size, variant, weight }), className)} {...props} />
  ),
);
Text.displayName = "Text";
