"use client";

import { cn } from "@/lib/utils";
import { Field as BaseField } from "@base-ui-components/react/field";
import type { ComponentPropsWithoutRef } from "react";

export function Field({ className, ...props }: ComponentPropsWithoutRef<typeof BaseField.Root>) {
  // Bake the label/control/hint/error rhythm in (matches PrizmField's setSpacing(6)),
  // so a field has vertical spacing without the consumer adding space-y-*.
  return <BaseField.Root className={cn("grid gap-1.5", className)} {...props} />;
}

export function FieldLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseField.Label>) {
  return (
    <BaseField.Label
      className={cn("text-sm font-medium leading-tight text-fg", className)}
      {...props}
    />
  );
}

export function FieldDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseField.Description>) {
  return (
    <BaseField.Description
      className={cn("text-xs leading-relaxed text-fg-muted", className)}
      {...props}
    />
  );
}

export function FieldError({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseField.Error>) {
  return (
    <BaseField.Error className={cn("text-xs leading-relaxed text-danger", className)} {...props} />
  );
}

export const FieldControl = BaseField.Control;
export const FieldValidity = BaseField.Validity;
