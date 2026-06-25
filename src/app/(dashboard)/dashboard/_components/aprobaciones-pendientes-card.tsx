import Link from "next/link";

import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SLA_BANDA_CLASS } from "@/lib/services/aprobaciones-constants";
import type { AprobacionRow } from "@/lib/services/aprobaciones-query";

// Bloque ADITIVO del Dashboard (DASH-01): contador + top 3 por SLA de las
// aprobaciones que esperan la decisión del usuario actual. Retorna `null` si no
// hay pendientes → con APPROVALS_ENABLED off queda oculto (cero cambio). Linkea a
// la Central. NO reconstruye el dashboard (eso es PR-042).
export function AprobacionesPendientesCard({
  count,
  top,
}: {
  count: number;
  top: AprobacionRow[];
}) {
  if (count === 0) return null;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" />
          Aprobaciones pendientes
          <Badge variant="outline" className="ml-1 tabular-nums">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 py-0">
        <ul className="divide-y">
          {top.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-6 py-3 text-sm">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{s.tipoLabel}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {s.solicitanteNombre} · {s.registroId}
                </span>
              </div>
              <span className={cn("shrink-0 text-xs tabular-nums", SLA_BANDA_CLASS[s.slaBanda])}>
                {s.venceEnLabel}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t px-6 py-2">
          <Link
            href="/sistema/aprobaciones"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Ver todas →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
