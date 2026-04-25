import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "neutral" | "positive" | "negative";

const ACCENT_VALUE_CLASSES: Record<Accent, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-rose-700 dark:text-rose-400",
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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <HugeiconsIcon icon={icon} className="size-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn("font-heading text-2xl font-semibold tabular-nums", ACCENT_VALUE_CLASSES[accent])}>
          {value}
        </div>
        {hint ? (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
