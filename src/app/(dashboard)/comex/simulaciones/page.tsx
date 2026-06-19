import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { listarSimulaciones } from "@/lib/actions/simulaciones-importacion";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import type { Moneda } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { MonedaToggle } from "../../reportes/_components/moneda-toggle";

import { SimulacionesTable } from "./simulaciones-table";

type SearchParams = Promise<{ pres?: string }>;

export const dynamic = "force-dynamic";

export default async function SimulacionesPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion, rows] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    listarSimulaciones(),
  ]);

  const pres: Moneda =
    params.pres === "ARS"
      ? "ARS"
      : params.pres === "USD"
        ? "USD"
        : session?.user.monedaPreferida === "ARS"
          ? "ARS"
          : "USD";
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Simulaciones de importación</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} simulación{rows.length === 1 ? "" : "es"} · cálculo sin asientos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={pres} tcInfo={tcInfo} param="pres" />
          <Link href="/comex/simulaciones/nueva" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nueva simulación
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <SimulacionesTable data={rows} pres={pres} tc={tc} />
      </Card>
    </div>
  );
}
