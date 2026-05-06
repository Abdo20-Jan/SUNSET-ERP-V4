import {
  generarNumeroGasto,
  listarCuentasGasto,
  listarProveedoresParaGasto,
} from "@/lib/actions/gastos";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { GastoForm } from "../_components/gasto-form";

export default async function NuevoGastoPage() {
  const [proveedores, cuentas, numeroSugerido, defaultFecha] = await Promise.all([
    listarProveedoresParaGasto(),
    listarCuentasGasto(),
    generarNumeroGasto(),
    getDefaultFecha(),
  ]);

  return (
    <GastoForm
      mode="create"
      numeroSugerido={numeroSugerido}
      proveedores={proveedores}
      cuentas={cuentas}
      defaultFecha={defaultFecha}
    />
  );
}
