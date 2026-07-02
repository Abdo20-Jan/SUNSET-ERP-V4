import { getHistoricoPagos } from "@/lib/services/historico-pagos";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { fmtMontoPres } from "@/lib/format";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { Moneda } from "@/generated/prisma/client";

import { Card } from "@/components/ui/card";

import { MonedaToggle, type Moneda as MonedaPres } from "../../reportes/_components/moneda-toggle";
// TES-02 · PR-025b: la page monta la worklist (EnterpriseDataGrid). La tabla
// legada `pagos-historial-table.tsx` sigue VIVA — la consume la pestaña Pagos
// de la ficha de proveedor (maestros/proveedores/[id]).
import { PagosHistorialWorklist } from "./pagos-historial-worklist";
import { PagosHistorialFilters } from "./pagos-historial-filters";

type SearchParams = Promise<{
  proveedorId?: string;
  moneda?: string;
  cuentaBancariaId?: string;
  desde?: string;
  hasta?: string;
  pres?: string;
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

export const dynamic = "force-dynamic";

export default async function PagosHistorialPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const desde = parseDate(params.desde);
  const hasta = parseDate(params.hasta);
  const moneda = parseMoneda(params.moneda);

  const [pagos, proveedores, cuentasBancarias, session, cotizacion] = await Promise.all([
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
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  // Moneda de PRESENTACIÓN del total agregado (toggle). Usa `pres` para no
  // pisar el filtro de datos `moneda`. La tabla es registro histórico (moneda
  // original + ARS contable + TC aplicado) y NO se convierte.
  const monedaPreferida: MonedaPres = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const monedaPres: MonedaPres =
    params.pres === "ARS" ? "ARS" : params.pres === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const totalArs = pagos.reduce((acc, p) => acc + Number(p.montoArs), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Histórico de pagos</h1>
          <p className="text-sm text-muted-foreground">
            {pagos.length} pago{pagos.length === 1 ? "" : "s"} · Total{" "}
            <strong>
              {fmtMontoPres(totalArs.toFixed(2), "ARS", monedaPres, tc)} {monedaPres}
            </strong>
          </p>
        </div>
        <MonedaToggle current={monedaPres} tcInfo={tcInfo} param="pres" />
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

      <Card className="py-0 p-3">
        <PagosHistorialWorklist pagos={pagos} />
      </Card>
    </div>
  );
}
