import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EntityLink } from "@/components/data-grid/entity-link";
import { cn } from "@/lib/utils";
import type { Tono } from "@/lib/services/comex-worklist-derivaciones";

/**
 * Bloque compacto del cockpit (CX-01 §9): tabla densa de 5–10 filas con contador
 * + [Ver todos]. Genérico para los 6 bloques de pendencias — cada bloque mapea
 * sus ítems a `CockpitBloqueRow`. Sólo display + drill-down (read-only).
 */

const TONE_CHIP_CLASS: Record<Tono, string> = {
  neutral: "bg-muted text-muted-foreground border-border/60",
  process: "bg-process/12 text-process border-process/25",
  info: "bg-info/12 text-info border-info/25",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
};

export function ToneChip({ tono, children }: { tono: Tono; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn("normal-case tracking-normal", TONE_CHIP_CLASS[tono])}>
      {children}
    </Badge>
  );
}

export type CockpitBloqueRow = {
  id: string;
  codigo: string;
  href: string;
  proveedorNombre: string;
  /** Línea secundaria bajo el código (próxima acción / motivo / vencimiento). */
  detalle: string;
  /** Métrica a la derecha (estado, fecha, monto). */
  metric: string;
  /** Si está presente, la métrica se pinta como chip tonal; si no, texto sutil. */
  metricTono?: Tono;
};

export function CockpitBloque({
  title,
  icon,
  count,
  verTodosHref,
  rows,
  emptyMsg,
  footnote,
}: {
  title: string;
  icon: IconSvgElement;
  count: number;
  verTodosHref?: string;
  rows: CockpitBloqueRow[];
  emptyMsg: string;
  footnote?: string;
}) {
  return (
    <Card size="sm" className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
          <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" strokeWidth={2} />
          {title}
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </span>
        {verTodosHref ? (
          <a
            href={verTodosHref}
            className="shrink-0 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Ver todos →
          </a>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyMsg}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li
              key={row.id}
              data-cockpit-row
              data-busca={`${row.codigo} ${row.proveedorNombre} ${row.detalle} ${row.metric}`.toLowerCase()}
              className="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <EntityLink label={row.codigo} href={row.href} tabLabel={row.codigo} />
                <span className="truncate text-[11px] text-muted-foreground">
                  {row.proveedorNombre} · {row.detalle}
                </span>
              </span>
              {row.metricTono ? (
                <ToneChip tono={row.metricTono}>{row.metric}</ToneChip>
              ) : (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {row.metric}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {footnote ? (
        <p className="border-t px-3 py-1.5 text-[10.5px] text-muted-foreground">{footnote}</p>
      ) : null}
    </Card>
  );
}
