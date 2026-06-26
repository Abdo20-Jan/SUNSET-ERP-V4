import Link from "next/link";

/*
 * VentaAlertasBand (PR-018) — faixa de alertas ativos do registro de Venta
 * (06_RECORD_PATTERN: "faixa no topo, antes das abas"). Três níveis empilhados por
 * severidade. APRESENTACIONAL: a página deriva as alertas SÓ de dados já
 * carregados (estado, solicitudes, cliente.estado, asiento) — nada de motor novo.
 */
export type AlertaNivel = "critical" | "warning" | "info";

export type VentaAlerta = {
  nivel: AlertaNivel;
  mensaje: string;
  href?: string;
  hrefLabel?: string;
};

const TONE: Record<AlertaNivel, string> = {
  critical:
    "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  info: "border-border bg-muted/40 text-muted-foreground",
};

function AlertaRow({ alerta }: { alerta: VentaAlerta }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${TONE[alerta.nivel]}`}
    >
      <span>{alerta.mensaje}</span>
      {alerta.href && (
        <Link
          href={alerta.href}
          className="shrink-0 text-xs font-medium underline-offset-2 hover:underline"
        >
          {alerta.hrefLabel ?? "Abrir"} →
        </Link>
      )}
    </div>
  );
}

export function VentaAlertasBand({ alertas }: { alertas: VentaAlerta[] }) {
  if (alertas.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      {alertas.map((a) => (
        <AlertaRow key={a.mensaje} alerta={a} />
      ))}
    </div>
  );
}
