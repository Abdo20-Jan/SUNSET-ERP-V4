import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "neutral" | "positive" | "negative" | "warning" | "info";

const ACCENT_VALUE: Record<Accent, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-rose-700 dark:text-rose-400",
  warning: "text-amber-700 dark:text-amber-400",
  info: "text-indigo-700 dark:text-indigo-400",
};

const ACCENT_ICON: Record<Accent, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  negative: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  info: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300",
};

const ACCENT_BORDER: Record<Accent, string> = {
  neutral: "border-l-border-strong",
  positive: "border-l-emerald-500",
  negative: "border-l-rose-500",
  warning: "border-l-amber-500",
  info: "border-l-indigo-500",
};

export function KpiCard({
  label,
  value,
  hint,
  icon,
  accent = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: IconSvgElement;
  accent?: Accent;
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "gap-1.5 border-l-[3px] py-2.5 transition-shadow hover:shadow-md",
        ACCENT_BORDER[accent],
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <div
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            ACCENT_ICON[accent],
          )}
        >
          <HugeiconsIcon icon={icon} className="size-3.5" strokeWidth={2} />
        </div>
      </div>
      <div
        className={cn(
          "px-3 font-mono text-[20px] font-semibold leading-none tracking-tight tabular-nums",
          ACCENT_VALUE[accent],
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="px-3 text-[11px] text-muted-foreground">{hint}</div>
      ) : null}
    </Card>
  );
}
