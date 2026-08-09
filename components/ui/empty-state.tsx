import { cn } from "@/lib/utils";
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col items-center justify-center py-12 text-center", className)}
      {...props}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-bg-muted text-fg-muted">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";
