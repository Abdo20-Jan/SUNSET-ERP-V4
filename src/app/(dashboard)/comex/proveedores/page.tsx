import { getSaldosExteriorPorProveedor } from "@/lib/services/cuentas-a-pagar";

import { ProveedoresExteriorTable } from "./proveedores-exterior-table";

export default async function ComexProveedoresPage() {
  const proveedores = await getSaldosExteriorPorProveedor();

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

      <ProveedoresExteriorTable proveedores={proveedores} />
    </div>
  );
}
