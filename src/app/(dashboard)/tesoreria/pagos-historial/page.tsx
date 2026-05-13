import { getHistoricoPagos } from "@/lib/services/historico-pagos";
import { db } from "@/lib/db";
import { Moneda } from "@/generated/prisma/client";

import { PagosHistorialTable } from "./pagos-historial-table";
import { PagosHistorialFilters } from "./pagos-historial-filters";

type SearchParams = Promise<{
  proveedorId?: string;
  moneda?: string;
  cuentaBancariaId?: string;
  desde?: string;
  hasta?: string;
}>;

function parseMoneda(v: string | undefined): Moneda | undefined {
  if (v === "ARS") return Moneda.ARS;
  if (v === "USD") return Moneda.USD;
  return undefined;
}

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function PagosHistorialPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const desde = parseDate(params.desde);
  const hasta = parseDate(params.hasta);
  const moneda = parseMoneda(params.moneda);

  const [pagos, proveedores, cuentasBancarias] = await Promise.all([
    getHistoricoPagos({
      proveedorId: params.proveedorId,
      desde,
      hasta,
      moneda,
      cuentaBancariaId: params.cuentaBancariaId,
    }),
    db.proveedor.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    db.cuentaBancaria.findMany({
      select: { id: true, banco: true, alias: true, moneda: true },
      orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    }),
  ]);

  const totalArs = pagos.reduce((acc, p) => acc + Number(p.montoArs), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Histórico de pagos</h1>
          <p className="text-sm text-muted-foreground">
            {pagos.length} pago{pagos.length === 1 ? "" : "s"} · Total ARS{" "}
            <strong>
              {totalArs.toLocaleString("es-AR", {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
              })}
            </strong>
          </p>
        </div>
      </div>

      <PagosHistorialFilters
        proveedores={proveedores}
        cuentasBancarias={cuentasBancarias.map((c) => ({
          id: c.id,
          label: c.alias ? `${c.banco} (${c.alias})` : `${c.banco} ${c.moneda}`,
        }))}
        selectedProveedorId={params.proveedorId ?? ""}
        selectedMoneda={params.moneda ?? ""}
        selectedCuentaBancariaId={params.cuentaBancariaId ?? ""}
        selectedDesde={params.desde ?? ""}
        selectedHasta={params.hasta ?? ""}
      />

      <PagosHistorialTable pagos={pagos} />
    </div>
  );
}
