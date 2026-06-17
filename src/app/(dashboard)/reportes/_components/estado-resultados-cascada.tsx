import type { EstadoResultadosRT9, SeccionRT9Id } from "@/lib/services/reportes";
import { convertirAUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { fmtMoney, fmtSigno } from "./money";

// Cascada de exposición RT9 del Estado de Resultados. Cada sección aporta su
// `montoExpuesto` (egresos en positivo, con prefijo "(−)"; mixtos con signo) y
// los subtotales encadenan Bruto → Operativo → antes de Impuestos → Ejercicio.

type Fila =
  | { tipo: "seccion"; id: SeccionRT9Id }
  | { tipo: "subtotal"; label: string; valor: string; enfasis?: boolean };

function montoExpuestoStr(rt9: EstadoResultadosRT9, id: SeccionRT9Id): string {
  return rt9.secciones.find((s) => s.id === id)?.montoExpuesto.toFixed(2) ?? "0.00";
}

function labelSeccion(rt9: EstadoResultadosRT9, id: SeccionRT9Id): string {
  const sec = rt9.secciones.find((s) => s.id === id);
  if (!sec) return id;
  return sec.tipo === "egreso" ? `(−) ${sec.label}` : sec.label;
}

export function EstadoResultadosCascada({
  rt9,
  tcParaUsd,
}: {
  rt9: EstadoResultadosRT9;
  tcParaUsd: string | null;
}) {
  const filas: Fila[] = [
    { tipo: "seccion", id: "VENTAS" },
    { tipo: "seccion", id: "CMV" },
    { tipo: "subtotal", label: "Resultado Bruto", valor: rt9.resultadoBruto.toFixed(2) },
    { tipo: "seccion", id: "COMERCIALIZACION" },
    { tipo: "seccion", id: "ADMINISTRACION" },
    { tipo: "subtotal", label: "Resultado Operativo", valor: rt9.resultadoOperativo.toFixed(2) },
    { tipo: "seccion", id: "FINANCIEROS" },
    { tipo: "seccion", id: "OTROS" },
    {
      tipo: "subtotal",
      label: "Resultado antes de Impuestos",
      valor: rt9.resultadoAntesImpuestos.toFixed(2),
    },
    { tipo: "seccion", id: "GANANCIAS" },
    {
      tipo: "subtotal",
      label: "Resultado del Ejercicio",
      valor: rt9.resultadoEjercicio.toFixed(2),
      enfasis: true,
    },
  ];

  return (
    <div className="flex flex-col">
      {filas.map((fila) => {
        if (fila.tipo === "subtotal") {
          const signo = fmtSigno(fila.valor);
          return (
            <div
              key={`sub-${fila.label}`}
              className={cn(
                "flex items-center justify-between border-t px-4 py-2.5",
                fila.enfasis ? "border-t-2 bg-muted/40" : "bg-muted/20",
              )}
            >
              <span className={cn("text-sm", fila.enfasis ? "font-semibold" : "font-medium")}>
                {fila.label}
              </span>
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  fila.enfasis ? "font-semibold" : "font-medium",
                  signo === "positive" && "text-emerald-700 dark:text-emerald-400",
                  signo === "negative" && "text-destructive",
                  signo === "zero" && "text-muted-foreground",
                )}
              >
                {fmtMoney(convertirAUsd(fila.valor, tcParaUsd))}
              </span>
            </div>
          );
        }

        const valor = montoExpuestoStr(rt9, fila.id);
        return (
          <div
            key={fila.id}
            className="flex items-center justify-between border-t border-dashed px-4 py-2"
          >
            <span className="text-sm text-muted-foreground">{labelSeccion(rt9, fila.id)}</span>
            <span className="font-mono text-sm tabular-nums">
              {fmtMoney(convertirAUsd(valor, tcParaUsd))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
