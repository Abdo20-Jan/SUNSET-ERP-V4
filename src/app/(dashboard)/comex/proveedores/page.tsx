import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { getSaldosExteriorPorProveedor } from "@/lib/services/cuentas-a-pagar";

import { ProveedoresExteriorTable } from "./proveedores-exterior-table";

export const dynamic = "force-dynamic";

export default async function ComexProveedoresPage() {
  const [proveedores, cuentasBancariasTodas, defaultFecha] = await Promise.all([
    getSaldosExteriorPorProveedor(),
    listarCuentasBancariasParaMovimiento(),
    getDefaultFecha(),
  ]);

  // El pago USD se debita siempre de una cuenta ARS con TC del banco —
  // las cuentas USD no aplican a este flujo (ver pagarFacturaExteriorAction).
  const cuentasBancariasArs = cuentasBancariasTodas.filter((c) => c.moneda === "ARS");

  const totalUsd = proveedores.reduce((acc, p) => acc + Number(p.saldoUsd), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Proveedores exterior</h1>
          <p className="text-sm text-muted-foreground">
            {proveedores.length} proveedor
            {proveedores.length === 1 ? "" : "es"} con saldo · Total{" "}
            <strong>USD {totalUsd.toFixed(2)}</strong>
          </p>
        </div>
      </div>

      <ProveedoresExteriorTable
        proveedores={proveedores}
        cuentasBancariasArs={cuentasBancariasArs}
        defaultFecha={defaultFecha}
      />
    </div>
  );
}
