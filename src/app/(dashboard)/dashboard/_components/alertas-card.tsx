import Link from "next/link";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Alerta, AlertaSeveridad } from "@/lib/services/dashboard";

const SEVERIDAD_DOT: Record<AlertaSeveridad, string> = {
  critical: "bg-rose-600",
  warning: "bg-amber-500",
};

export function AlertasCard({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
          Alertas
          <Badge variant="outline" className="ml-1 tabular-nums">
            {alertas.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 py-0">
        <ul className="divide-y">
          {alertas.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 px-6 py-3 text-sm"
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", SEVERIDAD_DOT[a.severidad])}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{a.titulo}</span>
                <span className="text-xs text-muted-foreground">{a.detalle}</span>
              </div>
              <Link
                href={a.href}
                className="shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Ver →
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
