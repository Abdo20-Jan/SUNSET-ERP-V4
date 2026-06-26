"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyAmount } from "@/components/ui/money-amount";
import { cn } from "@/lib/utils";
import { SLA_BANDA_CLASS } from "@/lib/services/aprobaciones-constants";
import type { AprobacionRow } from "@/lib/services/aprobaciones-query";
import type { TipoAprobacion } from "@/generated/prisma/enums";

import { SolicitarAutorizacionWindow } from "./solicitar-autorizacion-window";

type Props = {
  tabla: string;
  registroId: string;
  solicitudes: AprobacionRow[];
  approvalsEnabled: boolean;
  tiposPermitidos: readonly TipoAprobacion[];
};

// Aba contextual "Autorizaciones" REUTILIZABLE (06_RECORD_PATTERN). Lista las
// solicitudes vinculadas al documento + botón genérico "Solicitar autorización"
// que CREA una Solicitud vía el motor PR-012 (sin bloquear ninguna acción del
// documento). INERTE: con APPROVALS_ENABLED off, `solicitudes` viene vacío → "sin
// aprobaciones" y el botón no se renderiza. Otros documentos (Pedido/Asiento/
// Comex) la adoptan pasando su propio `tabla`/`registroId`/`tiposPermitidos`.
export function AutorizacionesTab({
  tabla,
  registroId,
  solicitudes,
  approvalsEnabled,
  tiposPermitidos,
}: Props) {
  const router = useRouter();
  const [abrir, setAbrir] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Autorizaciones</h3>
        {approvalsEnabled && tiposPermitidos.length > 0 ? (
          <Button type="button" size="sm" onClick={() => setAbrir(true)}>
            Solicitar autorización
          </Button>
        ) : null}
      </div>

      {solicitudes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin aprobaciones.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {solicitudes.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <StatusBadge estado={s.estado} label={s.estadoLabel} />
              <span className="font-medium">{s.tipoLabel}</span>
              <span className="text-muted-foreground">· {s.solicitanteNombre}</span>
              {s.valor != null ? (
                <MoneyAmount
                  value={s.valor}
                  mode="plain"
                  symbol={s.moneda ? `${s.moneda} ` : ""}
                  className="ml-auto"
                />
              ) : null}
              <span
                className={cn(
                  "text-xs",
                  s.valor == null ? "ml-auto" : "",
                  SLA_BANDA_CLASS[s.slaBanda],
                )}
              >
                {s.venceEnLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SolicitarAutorizacionWindow
        open={abrir}
        onClose={() => setAbrir(false)}
        onDone={() => {
          setAbrir(false);
          router.refresh();
        }}
        tabla={tabla}
        registroId={registroId}
        tiposPermitidos={tiposPermitidos}
      />
    </div>
  );
}
