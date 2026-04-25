import {
  listarCuentasBancariasConSaldo,
  listarCuentasContablesDisponibles,
} from "@/lib/actions/cuentas-bancarias";
import { Card } from "@/components/ui/card";

import { CuentasBancariasTable } from "./cuentas-table";

export default async function CuentasBancariasPage() {
  const [cuentas, cuentasContables] = await Promise.all([
    listarCuentasBancariasConSaldo(),
    listarCuentasContablesDisponibles(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Cuentas bancarias
          </h1>
          <p className="text-sm text-muted-foreground">
            {cuentas.length} cuenta{cuentas.length === 1 ? "" : "s"} · saldos
            calculados desde asientos contabilizados
          </p>
        </div>
      </div>

      <Card className="py-0">
        <CuentasBancariasTable
          data={cuentas}
          cuentasContables={cuentasContables}
        />
      </Card>
    </div>
  );
}
