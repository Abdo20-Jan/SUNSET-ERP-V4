import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import {
  listarPrestamosConSaldo,
  type PrestamoEstadoFiltro,
  type PrestamoListFilters,
} from "@/lib/actions/prestamos";
import {
  Moneda,
  PrestamoClasificacion,
} from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { PrestamosFilters } from "./prestamos-filters";
import { PrestamosTable } from "./prestamos-table";

type SearchParams = Promise<{
  clasificacion?: string;
  moneda?: string;
  estado?: string;
  prestamoId?: string;
}>;

function parseClasificacion(v: string | undefined): PrestamoClasificacion | null {
  if (v === "CORTO_PLAZO") return PrestamoClasificacion.CORTO_PLAZO;
  if (v === "LARGO_PLAZO") return PrestamoClasificacion.LARGO_PLAZO;
  return null;
}

function parseMoneda(v: string | undefined): Moneda | null {
  if (v === "ARS") return Moneda.ARS;
  if (v === "USD") return Moneda.USD;
  return null;
}

function parseEstado(v: string | undefined): PrestamoEstadoFiltro | null {
  if (v === "CONTABILIZADO" || v === "ANULADO" || v === "SIN_ASIENTO") return v;
  return null;
}

const CLASIFICACION_SHORT: Record<PrestamoClasificacion, string> = {
  [PrestamoClasificacion.CORTO_PLAZO]: "CP",
  [PrestamoClasificacion.LARGO_PLAZO]: "LP",
};

const ESTADO_SHORT: Record<PrestamoEstadoFiltro, string> = {
  CONTABILIZADO: "contabilizado",
  ANULADO: "anulado",
  SIN_ASIENTO: "sin asiento",
};

export default async function PrestamosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const clasificacion = parseClasificacion(params.clasificacion);
  const moneda = parseMoneda(params.moneda);
  const estado = parseEstado(params.estado);

  const filtros: PrestamoListFilters = {};
  if (clasificacion) filtros.clasificacion = clasificacion;
  if (moneda) filtros.moneda = moneda;
  if (estado) filtros.estado = estado;

  const rows = await listarPrestamosConSaldo(filtros);

  const prestamoIdParam =
    params.prestamoId && /^[0-9a-f-]{36}$/i.test(params.prestamoId)
      ? params.prestamoId
      : null;
  const prestamoInicial = prestamoIdParam
    ? (rows.find((r) => r.id === prestamoIdParam) ?? null)
    : null;

  const filtroTags: string[] = [];
  if (clasificacion)
    filtroTags.push(`clasificación ${CLASIFICACION_SHORT[clasificacion]}`);
  if (moneda) filtroTags.push(`moneda ${moneda}`);
  if (estado) filtroTags.push(`estado ${ESTADO_SHORT[estado]}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Préstamos</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} préstamo{rows.length === 1 ? "" : "s"}
            {filtroTags.length > 0
              ? ` · ${filtroTags.join(" · ")}`
              : " · saldo calculado desde los asientos contabilizados"}
          </p>
        </div>
        <Link
          href="/tesoreria/prestamos/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo préstamo
        </Link>
      </div>

      <PrestamosFilters
        selectedClasificacion={clasificacion ?? "all"}
        selectedMoneda={moneda ?? "all"}
        selectedEstado={estado ?? "all"}
      />

      <Card className="py-0">
        <PrestamosTable data={rows} prestamoInicial={prestamoInicial} />
      </Card>
    </div>
  );
}
