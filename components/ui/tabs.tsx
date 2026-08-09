"use client";

import { cn } from "@/lib/utils";
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentPropsWithoutRef } from "react";

export const Tabs = BaseTabs.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        "relative inline-flex h-9 items-center justify-center rounded-md bg-bg-muted p-1 text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-all",
        "text-fg-muted hover:text-fg",
        "focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
        "data-[active]:bg-surface data-[active]:text-accent data-[active]:shadow-sm",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel
      className={cn(
        "mt-2",
        "focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}
