import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Card } from "@/components/ui/card";

export function SecondaryStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: IconSvgElement;
}) {
  return (
    <Card size="sm" className="gap-1.5 py-2.5">
      <div className="flex items-center gap-2.5 px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <HugeiconsIcon icon={icon} className="size-3.5" strokeWidth={2} />
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="font-mono text-base font-semibold tabular-nums">
            {value.toLocaleString("es-AR")}
          </span>
        </div>
      </div>
    </Card>
  );
}
