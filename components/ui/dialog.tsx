"use client";

import { cn } from "@/lib/utils";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentPropsWithoutRef<typeof BaseDialog.Popup> & {
  showCloseButton?: boolean;
  children?: ReactNode;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "transition-opacity duration-200",
        )}
      />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
          "rounded-lg border border-border bg-surface-elevated p-6 shadow-lg",
          "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
          "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          "transition-all duration-200",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <BaseDialog.Close
            className={cn(
              "absolute right-4 top-4 rounded-sm text-fg-muted opacity-70 transition-opacity",
              "hover:opacity-100 focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={cn("text-sm text-fg-muted", className)} {...props} />;
}
