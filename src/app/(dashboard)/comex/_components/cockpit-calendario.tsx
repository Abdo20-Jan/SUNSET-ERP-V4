"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AnchorIcon,
  Calendar03Icon,
  CargoShipIcon,
  CoinsDollarIcon,
  ContainerTruckIcon,
  Exchange01Icon,
  Package01Icon,
  PackageOpenIcon,
  ShipmentTrackingIcon,
  Stamp01Icon,
  WarehouseIcon,
} from "@hugeicons/core-free-icons";

import { Card } from "@/components/ui/card";
import { EntityLink } from "@/components/data-grid/entity-link";
import { fmtDateOrDash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CalendarioData,
  CalendarioEvento,
  CalendarioEventoTab,
  CalendarioEventoTipo,
  DiaCalendario,
} from "@/lib/services/comex-cockpit-calendario";

/**
 * Calendario operacional semanal (CX-01 §9-estrutural 5 · PR-022c). Largura total
 * abajo de los 6 bloques: grilla de semanas (lunes→domingo) con íconos compactos
 * de eventos por día. Click-día expande la lista in-place; cada evento es un
 * `EntityLink`/chevron al proceso en la aba correspondiente. 100% READ-ONLY:
 * sólo fechas armazenadas, ningún valor monetario, ninguna mutación.
 */

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_ICONOS_CELDA = 4;

const ICONO_EVENTO: Record<CalendarioEventoTipo, IconSvgElement> = {
  empaque: Package01Icon,
  embarcado: CargoShipIcon,
  transbordo: Exchange01Icon,
  arribo: AnchorIcon,
  "ingreso-zpa": WarehouseIcon,
  "traslado-df": ContainerTruckIcon,
  desconsolidacion: PackageOpenIcon,
  nacionalizacion: Stamp01Icon,
  despacho: ShipmentTrackingIcon,
  "pago-exterior": CoinsDollarIcon,
};

const LABEL_EVENTO: Record<CalendarioEventoTipo, string> = {
  empaque: "Empaque",
  embarcado: "Embarcado",
  transbordo: "Transbordo",
  arribo: "Arribo",
  "ingreso-zpa": "Ingreso ZPA",
  "traslado-df": "Traslado DF",
  desconsolidacion: "Desconsolidación",
  nacionalizacion: "Nacionalización",
  despacho: "Despacho",
  "pago-exterior": "Pago exterior",
};

/** Color del ícono por aba destino (operación/aduana/finanzas). */
const COLOR_TAB: Record<CalendarioEventoTab, string> = {
  operacion: "text-process",
  aduana: "text-info",
  finanzas: "text-warning",
};

const fichaTabHref = (ev: CalendarioEvento) => `/comex/embarques/${ev.embarqueId}?tab=${ev.tab}`;

type ResumenTipo = { tipo: CalendarioEventoTipo; tab: CalendarioEventoTab; count: number };

/** Resume los eventos de un día por tipo (íconos compactos, 1 por tipo con contador). */
function resumirPorTipo(eventos: CalendarioEvento[]): ResumenTipo[] {
  const map = new Map<CalendarioEventoTipo, ResumenTipo>();
  for (const ev of eventos) {
    const prev = map.get(ev.tipo);
    if (prev) prev.count += 1;
    else map.set(ev.tipo, { tipo: ev.tipo, tab: ev.tab, count: 1 });
  }
  return [...map.values()];
}

function DiaCelda({
  dia,
  seleccionado,
  onSelect,
}: {
  dia: DiaCalendario;
  seleccionado: boolean;
  onSelect: (diaISO: string) => void;
}) {
  const resumen = resumirPorTipo(dia.eventos);
  const tieneEventos = dia.eventos.length > 0;
  const visibles = resumen.slice(0, MAX_ICONOS_CELDA);
  const extra = resumen.length - visibles.length;

  const contenido = (
    <>
      <span
        className={cn(
          "text-[11px] tabular-nums",
          dia.esHoy ? "font-bold text-primary" : "text-muted-foreground",
        )}
      >
        {dia.dia}
      </span>
      {tieneEventos ? (
        <span className="mt-1 flex flex-wrap items-center gap-0.5">
          {visibles.map((r) => (
            <span key={r.tipo} className="inline-flex items-center" title={LABEL_EVENTO[r.tipo]}>
              <HugeiconsIcon
                icon={ICONO_EVENTO[r.tipo]}
                className={cn("size-3.5", COLOR_TAB[r.tab])}
                strokeWidth={2}
              />
              {r.count > 1 ? (
                <span className="text-[9px] font-medium tabular-nums text-muted-foreground">
                  {r.count}
                </span>
              ) : null}
            </span>
          ))}
          {extra > 0 ? (
            <span className="text-[9px] font-medium text-muted-foreground">+{extra}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  const claseBase = cn(
    "flex min-h-14 flex-col items-start gap-0 border-b border-r px-1.5 py-1 text-left",
    dia.esHoy && "bg-primary/5",
    seleccionado && "ring-1 ring-inset ring-primary",
  );

  if (!tieneEventos) {
    return <div className={cn(claseBase, "text-muted-foreground/60")}>{contenido}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(dia.diaISO)}
      aria-label={`${dia.eventos.length} evento(s) el día ${dia.dia}`}
      aria-pressed={seleccionado}
      className={cn(
        claseBase,
        "transition hover:bg-muted/60 focus-visible:bg-muted/60 outline-none",
      )}
    >
      {contenido}
    </button>
  );
}

function EventoFila({ ev }: { ev: CalendarioEvento }) {
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          icon={ICONO_EVENTO[ev.tipo]}
          className={cn("size-4 shrink-0", COLOR_TAB[ev.tab])}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <EntityLink label={ev.codigo} href={fichaTabHref(ev)} tabLabel={ev.codigo} />
          <span className="truncate text-[11px] text-muted-foreground">
            {LABEL_EVENTO[ev.tipo]} · {ev.proveedorNombre}
          </span>
        </span>
      </span>
    </li>
  );
}

export function CockpitCalendario({ data }: { data: CalendarioData }) {
  const [diaSel, setDiaSel] = useState<string | null>(null);

  const dias = useMemo(() => data.semanas.flatMap((s) => s.dias), [data.semanas]);
  const diaActivo = diaSel ? dias.find((d) => d.diaISO === diaSel) : undefined;

  const toggleDia = (diaISO: string) => setDiaSel((prev) => (prev === diaISO ? null : diaISO));

  return (
    <Card size="sm" className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="size-4 text-muted-foreground"
            strokeWidth={2}
          />
          Calendario operacional
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {data.totalEventos}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          Semanal · sólo fechas registradas
        </span>
      </div>

      <div className="grid grid-cols-7 border-b bg-muted/30">
        {DIAS_SEMANA.map((d) => (
          <span
            key={d}
            className="border-r px-1.5 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase last:border-r-0"
          >
            {d}
          </span>
        ))}
      </div>

      <div className="max-h-64 overflow-y-auto">
        <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          {dias.map((dia) => (
            <DiaCelda
              key={dia.diaISO}
              dia={dia}
              seleccionado={dia.diaISO === diaSel}
              onSelect={toggleDia}
            />
          ))}
        </div>
      </div>

      {diaActivo ? (
        <div className="border-t">
          <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-1.5">
            <span className="text-[12px] font-semibold">
              Eventos · {fmtDateOrDash(diaActivo.diaISO)}
            </span>
            <button
              type="button"
              onClick={() => setDiaSel(null)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cerrar
            </button>
          </div>
          <ul className="divide-y">
            {diaActivo.eventos.map((ev, idx) => (
              <EventoFila key={`${ev.embarqueId}-${ev.tipo}-${idx}`} ev={ev} />
            ))}
          </ul>
        </div>
      ) : null}

      {data.fueraDeVentana > 0 ? (
        <p className="border-t px-3 py-1.5 text-[10.5px] text-muted-foreground">
          {data.fueraDeVentana} evento(s) fuera de la ventana visible
        </p>
      ) : null}
    </Card>
  );
}
