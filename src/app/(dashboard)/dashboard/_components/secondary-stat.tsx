import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Card, CardContent } from "@/components/ui/card";

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
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <HugeiconsIcon icon={icon} className="size-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="font-heading text-lg font-semibold tabular-nums">
            {value.toLocaleString("es-AR")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
