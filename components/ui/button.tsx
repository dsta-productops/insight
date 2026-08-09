import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        solid: "bg-accent text-accent-fg hover:bg-accent-hover",
        outline: "border border-border bg-bg text-fg hover:bg-bg-muted",
        ghost: "text-fg hover:bg-bg-muted",
        subtle: "bg-bg-muted text-fg hover:bg-bg-subtle",
        danger: "bg-danger text-danger-fg hover:opacity-90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "solid", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
