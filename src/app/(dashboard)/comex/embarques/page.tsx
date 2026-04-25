import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import {
  listarEmbarques,
  type EmbarqueListFilters,
} from "@/lib/actions/embarques";
import {
  EmbarqueEstado,
  Moneda,
} from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { EmbarquesFilters } from "./embarques-filters";
import { EmbarquesTable } from "./embarques-table";

type SearchParams = Promise<{
  estado?: string;
  moneda?: string;
}>;

function parseEstado(v: string | undefined): EmbarqueEstado | null {
  if (!v) return null;
  const values = Object.values(EmbarqueEstado) as string[];
  return values.includes(v) ? (v as EmbarqueEstado) : null;
}

function parseMoneda(v: string | undefined): Moneda | null {
  if (v === "ARS") return Moneda.ARS;
  if (v === "USD") return Moneda.USD;
  return null;
}

const ESTADO_SHORT: Record<EmbarqueEstado, string> = {
  BORRADOR: "borrador",
  EN_TRANSITO: "en tránsito",
  EN_PUERTO: "en puerto",
  EN_ADUANA: "en aduana",
  DESPACHADO: "despachado",
  EN_DEPOSITO: "en depósito",
  CERRADO: "cerrado",
};

export default async function EmbarquesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const estado = parseEstado(params.estado);
  const moneda = parseMoneda(params.moneda);

  const filtros: EmbarqueListFilters = {};
  if (estado) filtros.estado = estado;
  if (moneda) filtros.moneda = moneda;

  const rows = await listarEmbarques(filtros);

  const filtroTags: string[] = [];
  if (estado) filtroTags.push(`estado ${ESTADO_SHORT[estado]}`);
  if (moneda) filtroTags.push(`moneda ${moneda}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Embarques</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} embarque{rows.length === 1 ? "" : "s"}
            {filtroTags.length > 0
              ? ` · ${filtroTags.join(" · ")}`
              : " · importaciones registradas"}
          </p>
        </div>
        <Link
          href="/comex/embarques/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo embarque
        </Link>
      </div>

      <EmbarquesFilters
        selectedEstado={estado ?? "all"}
        selectedMoneda={moneda ?? "all"}
      />

      <Card className="py-0">
        <EmbarquesTable data={rows} />
      </Card>
    </div>
  );
}
