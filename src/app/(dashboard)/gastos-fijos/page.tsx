import {
  listarCuentasParaGastoFijo,
  listarGastosFijos,
  listarProveedoresParaGastoFijo,
} from "@/lib/actions/gastos-fijos";
import { Card } from "@/components/ui/card";

import { GastosFijosTable } from "./gastos-fijos-table";

export default async function GastosFijosPage() {
  const [gastos, proveedores, cuentas] = await Promise.all([
    listarGastosFijos(),
    listarProveedoresParaGastoFijo(),
    listarCuentasParaGastoFijo(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Gastos fijos</h1>
        <p className="text-sm text-muted-foreground">
          Templates de gastos recurrentes (alquiler, contador, internet, etc).
          Configurá una vez y registrá cada mes — genera asiento contable y
          deja la cuenta a pagar lista para ser pagada vía Tesorería.
        </p>
      </div>

      <Card className="py-0">
        <GastosFijosTable
          gastos={gastos}
          proveedores={proveedores}
          cuentas={cuentas}
        />
      </Card>
    </div>
  );
}
