"use client";

import { cn } from "@/lib/utils";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export const Select = BaseSelect.Root;

export function SelectValue({
  placeholder,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof BaseSelect.Value>, "children"> & {
  placeholder?: ReactNode;
}) {
  return (
    <BaseSelect.Value className={cn("data-[placeholder]:text-fg-subtle", className)} {...props}>
      {(value) => (value == null || value === "" ? placeholder : (value as ReactNode))}
    </BaseSelect.Value>
  );
}

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-1 text-sm shadow-sm",
        "focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[placeholder]:text-fg-subtle",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="text-fg-muted">
        <ChevronDown className="h-4 w-4" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BaseSelect.Popup> & { children?: ReactNode }) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} align="start">
        <BaseSelect.Popup
          className={cn(
            "z-50 max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto",
            "rounded-md border border-border bg-surface-elevated p-1 shadow-md",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-150",
            className,
          )}
          {...props}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseSelect.Group>) {
  return <BaseSelect.Group className={cn(className)} {...props} />;
}

export function SelectGroupLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseSelect.GroupLabel>) {
  return (
    <BaseSelect.GroupLabel
      className={cn("px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle", className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-sm text-fg outline-none",
        "data-[highlighted]:bg-bg-muted",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemIndicator className="absolute left-2 inline-flex items-center text-accent">
        <Check className="h-3.5 w-3.5" />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}
