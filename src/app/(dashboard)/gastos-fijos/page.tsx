import {
  listarCuentasParaGastoFijo,
  listarGastosFijos,
  listarProveedoresParaGastoFijo,
} from "@/lib/actions/gastos-fijos";
import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { Card } from "@/components/ui/card";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";
import { GastosFijosTable } from "./gastos-fijos-table";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ moneda?: string }>;

export default async function GastosFijosPage({ searchParams }: { searchParams: SearchParams }) {
  const [gastos, proveedores, cuentas, params, session, cotizacion] = await Promise.all([
    listarGastosFijos(),
    listarProveedoresParaGastoFijo(),
    listarCuentasParaGastoFijo(),
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
          <h1 className="text-[15px] font-semibold tracking-tight">Gastos fijos</h1>
          <p className="text-sm text-muted-foreground">
            Templates de gastos recurrentes (alquiler, contador, internet, etc). Configurá una vez y
            registrá cada mes — genera asiento contable y deja la cuenta a pagar lista para ser
            pagada vía Tesorería.
          </p>
        </div>
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

      <Card className="py-0">
        <GastosFijosTable
          gastos={gastos}
          proveedores={proveedores}
          cuentas={cuentas}
          moneda={moneda}
          tc={tc}
        />
      </Card>
    </div>
  );
}
