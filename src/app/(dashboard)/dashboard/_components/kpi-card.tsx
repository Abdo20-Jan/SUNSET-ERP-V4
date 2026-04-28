import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "neutral" | "positive" | "negative" | "warning" | "info";

const ACCENT_VALUE_CLASSES: Record<Accent, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-rose-700 dark:text-rose-400",
  warning: "text-amber-700 dark:text-amber-400",
  info: "text-indigo-700 dark:text-indigo-400",
};

// Palitos coloridos laterales (border-l-4) por accent.
const ACCENT_BORDER_CLASSES: Record<Accent, string> = {
  neutral: "border-l-slate-300 dark:border-l-slate-600",
  positive: "border-l-emerald-500",
  negative: "border-l-rose-500",
  warning: "border-l-amber-500",
  info: "border-l-indigo-500",
};

const ACCENT_ICON_BG: Record<Accent, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  negative: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  info: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
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
    <Card className={cn("border-l-4", ACCENT_BORDER_CLASSES[accent])}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          </div>
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              ACCENT_ICON_BG[accent],
            )}
          >
            <HugeiconsIcon icon={icon} className="size-5" strokeWidth={2} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "font-heading text-2xl font-semibold tabular-nums",
            ACCENT_VALUE_CLASSES[accent],
          )}
        >
          {value}
        </div>
        {hint ? (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
