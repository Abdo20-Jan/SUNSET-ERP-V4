"use client";

/**
 * Drill-down inline (display-only) de la worklist global de contenedores
 * (PR-024 / CX-04). Realiza la "mini-ficha" de la spec §9-estrutural 2 como
 * expansión de fila (mismo patrón que CX-02). Sub-bloques: breakdown del
 * disponible, alertas derivadas del estado y — SÓLO con `verCosto` — el costo FC
 * resumido. SIN edición. El costo (landed FC) nunca se renderiza sin permiso.
 */

import type { ReactNode } from "react";

import { fmtMoney } from "@/lib/format";
import type { ContenedorRow } from "@/lib/services/contenedor-worklist";

import { TonoChip } from "./contenedores-chips";

function SubBloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      {children}
    </div>
  );
}

function Dato({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function DisponibleBloque({ row }: { row: ContenedorRow }) {
  return (
    <SubBloque titulo="Breakdown disponible">
      <div className="flex flex-col gap-0.5">
        <Dato label="Física" value={row.cantidadFisica} />
        <Dato label="Despachada" value={row.cantidadDespachada} />
        <Dato label="En despacho" value={row.cantidadEnDespacho} />
        <Dato label="Disponible" value={row.cantidadDisponible} />
      </div>
    </SubBloque>
  );
}

// Alertas derivadas READ-ONLY del estado. NO consulta el motor de bloqueo/lock:
// sólo traduce el estado ya persistido a una señal de display.
function AlertasBloque({ row }: { row: ContenedorRow }) {
  const bloqueado = row.estado === "AGUARDANDO_INVESTIGACAO";
  return (
    <SubBloque titulo="Alertas">
      {bloqueado ? (
        <TonoChip tono="danger">Bloqueado — aguardando investigación</TonoChip>
      ) : (
        <span className="text-xs text-muted-foreground">Sin alertas.</span>
      )}
    </SubBloque>
  );
}

function CostoBloque({ row }: { row: ContenedorRow }) {
  return (
    <SubBloque titulo="Costo FC resumido">
      <span className="text-xs">
        <span className="text-muted-foreground">Costo FC total:</span>{" "}
        <span className="font-mono font-semibold">{fmtMoney(row.costoFCTotal ?? "0")} USD</span>
      </span>
    </SubBloque>
  );
}

export function ContenedoresExpandedRow({
  row,
  verCosto,
}: {
  row: ContenedorRow;
  verCosto: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 py-1 md:flex-row md:flex-wrap">
      <DisponibleBloque row={row} />
      <AlertasBloque row={row} />
      {verCosto && row.costoFCTotal != null ? <CostoBloque row={row} /> : null}
    </div>
  );
}
