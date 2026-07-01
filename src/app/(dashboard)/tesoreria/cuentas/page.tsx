import { listarCuentasContablesDisponibles } from "@/lib/actions/cuentas-bancarias";
import { auth } from "@/lib/auth";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarCuentasBancariasWorklist } from "@/lib/services/cuenta-bancaria-worklist";
import { Card } from "@/components/ui/card";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
import { CuentasWorklist } from "./cuentas-worklist";

type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function CuentasBancariasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const verSaldo = await puedeVerSaldo();
  const [cuentas, cuentasContables, params, session, cotizacion] = await Promise.all([
    listarCuentasBancariasWorklist(verSaldo),
    listarCuentasContablesDisponibles(),
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;
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
          <h1 className="text-[15px] font-semibold tracking-tight">Cuentas bancarias</h1>
          <p className="text-sm text-muted-foreground">
            {cuentas.length} cuenta{cuentas.length === 1 ? "" : "s"}
            {verSaldo ? " · saldos calculados desde asientos contabilizados" : ""}
          </p>
        </div>
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

      <Card className="py-0 p-3">
        <CuentasWorklist
          rows={cuentas}
          cuentasContables={cuentasContables}
          moneda={moneda}
          tc={tc}
          verSaldo={verSaldo}
        />
      </Card>
    </div>
  );
}
