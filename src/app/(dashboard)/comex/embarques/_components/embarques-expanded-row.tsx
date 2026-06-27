"use client";

/**
 * Drill-down inline (display-only) de la worklist Comex (PR-020 / CX-02). Tres
 * sub-bloques: contenedores, facturas locales de nacionalización y últimas
 * acciones. SIN edición. El bloque de **costo** (Costo Total + FOB) sólo se
 * renderiza con `verCosto` (gate `VER_COSTO_LANDED`) — y la mini-tabla de
 * facturas NUNCA muestra importes (campos monetarios no viajan al cliente).
 */

import type { ReactNode } from "react";

import { fmtMoney } from "@/lib/format";
import type { EmbarqueWorklistRow } from "@/lib/actions/embarques";

import { ContainerChip, TonoChip } from "./embarques-chips";

const DASH = "—";

function fmtFechaIso(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DASH
    : new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(d);
}

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

function ContenedoresBloque({ row }: { row: EmbarqueWorklistRow }) {
  if (row.contenedores.length === 0) {
    return (
      <SubBloque titulo="Contenedores">
        <span className="text-xs text-muted-foreground">Sin contenedores.</span>
      </SubBloque>
    );
  }
  return (
    <SubBloque titulo={`Contenedores (${row.contenedores.length})`}>
      <div className="flex flex-wrap gap-1">
        {row.contenedores.map((c) => (
          <ContainerChip key={c.numero} numero={c.numero} estado={c.estado} />
        ))}
      </div>
    </SubBloque>
  );
}

function FacturasLocalesBloque({ row }: { row: EmbarqueWorklistRow }) {
  if (row.facturasLocales.length === 0) {
    return (
      <SubBloque titulo="Facturas locales">
        <span className="text-xs text-muted-foreground">Sin facturas de nacionalización.</span>
      </SubBloque>
    );
  }
  return (
    <SubBloque titulo="Facturas locales (nacionalización)">
      <ul className="flex flex-col gap-1 text-xs">
        {row.facturasLocales.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <span className="font-mono">{f.numero ?? "s/n"}</span>
            <TonoChip tono="neutral">{f.estado}</TonoChip>
            <span className="text-muted-foreground">
              vto. {fmtFechaIso(f.fechaVencimiento)} ·{" "}
              {f.momento === "ZONA_PRIMARIA" ? "ZP" : "Desp."}
            </span>
          </li>
        ))}
      </ul>
    </SubBloque>
  );
}

function AccionesBloque() {
  return (
    <SubBloque titulo="Últimas acciones">
      <span className="text-xs text-muted-foreground">
        Sin historial (Fase 1 — sin auditoría de usuario en el embarque).
      </span>
    </SubBloque>
  );
}

function CostoBloque({ row }: { row: EmbarqueWorklistRow }) {
  return (
    <SubBloque titulo="Costo resumido">
      <div className="flex flex-col gap-0.5 text-xs">
        <span>
          <span className="text-muted-foreground">FOB:</span>{" "}
          <span className="font-mono">{fmtMoney(row.fobUsd)} USD</span>
        </span>
        <span>
          <span className="text-muted-foreground">Costo Total:</span>{" "}
          <span className="font-mono font-semibold">{fmtMoney(row.costoTotal ?? "0")} ARS</span>
        </span>
      </div>
    </SubBloque>
  );
}

export function EmbarquesExpandedRow({
  row,
  verCosto,
}: {
  row: EmbarqueWorklistRow;
  verCosto: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 py-1 md:flex-row md:flex-wrap">
      <ContenedoresBloque row={row} />
      <FacturasLocalesBloque row={row} />
      <AccionesBloque />
      {verCosto && row.costoTotal != null ? <CostoBloque row={row} /> : null}
    </div>
  );
}
