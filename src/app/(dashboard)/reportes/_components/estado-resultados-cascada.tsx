import type { EstadoResultadosRT9 } from "@/lib/services/reportes";
import { convertirAUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { fmtMoney, fmtSigno } from "./money";

// Cascada de exposición del Estado de Resultados (orden de los EECC, 21
// conceptos del Excel + "Otros ingresos operativos"). Cada concepto-cuenta
// aporta su `montoExpuesto` (egresos en
// positivo, con prefijo "(−)"; mixtos con signo); los subtotales (Ingresos
// netos → Resultado bruto → … → Resultado del ejercicio) encadenan el acumulado.

export function EstadoResultadosCascada({
  rt9,
  tcParaUsd,
}: {
  rt9: EstadoResultadosRT9;
  tcParaUsd: string | null;
}) {
  return (
    <div className="flex flex-col">
      {rt9.conceptos.map((c) => {
        const valorStr = c.montoExpuesto.toFixed(2);

        if (c.tipo === "subtotal") {
          const signo = fmtSigno(valorStr);
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-center justify-between border-t px-4 py-2.5",
                c.enfasis ? "border-t-2 bg-muted/40" : "bg-muted/20",
              )}
            >
              <span className={cn("text-sm", c.enfasis ? "font-semibold" : "font-medium")}>
                {c.label}
              </span>
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  c.enfasis ? "font-semibold" : "font-medium",
                  signo === "positive" && "text-emerald-700 dark:text-emerald-400",
                  signo === "negative" && "text-destructive",
                  signo === "zero" && "text-muted-foreground",
                )}
              >
                {fmtMoney(convertirAUsd(valorStr, tcParaUsd))}
              </span>
            </div>
          );
        }

        const label = c.tipo === "egreso" ? `(−) ${c.label}` : c.label;
        return (
          <div
            key={c.id}
            className="flex items-center justify-between border-t border-dashed px-4 py-2"
          >
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="font-mono text-sm tabular-nums">
              {fmtMoney(convertirAUsd(valorStr, tcParaUsd))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
