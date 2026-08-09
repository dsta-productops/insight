import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type HTMLAttributes, forwardRef } from "react";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-fg",
        info: "border-[oklch(58.8%_0.158_241.97_/_0.30)] bg-[oklch(68.5%_0.169_237.32_/_0.10)] text-info [&>svg]:text-info",
        success:
          "border-[oklch(62.7%_0.194_149.21_/_0.30)] bg-[oklch(72.3%_0.219_149.58_/_0.10)] text-success [&>svg]:text-success",
        warning:
          "border-[oklch(66.6%_0.179_58.32_/_0.30)] bg-[oklch(76.9%_0.188_70.08_/_0.10)] text-warning [&>svg]:text-warning",
        danger:
          "border-[oklch(57.7%_0.245_27.32_/_0.30)] bg-[oklch(63.7%_0.237_25.33_/_0.10)] text-danger [&>svg]:text-danger",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = "Alert";

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm leading-relaxed [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";
