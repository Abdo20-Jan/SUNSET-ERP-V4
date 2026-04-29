"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  className?: string;
};

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        // Base box: 16x16 with explicit dimensions, visible border, white fill.
        "inline-flex items-center justify-center shrink-0",
        "h-4 w-4 rounded-sm border-2 border-muted-foreground/60 bg-background",
        "transition-colors cursor-pointer",
        // Checked state.
        "data-[checked]:bg-primary data-[checked]:border-primary data-[checked]:text-primary-foreground",
        // Hover.
        "hover:border-primary/70",
        // Focus ring.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        // Disabled.
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-current"
        keepMounted={false}
      >
        <HugeiconsIcon
          icon={Tick02Icon}
          className="h-3 w-3"
          strokeWidth={3.5}
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
