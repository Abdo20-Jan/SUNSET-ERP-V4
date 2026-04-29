import {
  generarNumeroGasto,
  listarCuentasGasto,
  listarProveedoresParaGasto,
} from "@/lib/actions/gastos";

import { GastoForm } from "../_components/gasto-form";

export default async function NuevoGastoPage() {
  const [proveedores, cuentas, numeroSugerido] = await Promise.all([
    listarProveedoresParaGasto(),
    listarCuentasGasto(),
    generarNumeroGasto(),
  ]);

  return (
    <GastoForm
      mode="create"
      numeroSugerido={numeroSugerido}
      proveedores={proveedores}
      cuentas={cuentas}
    />
  );
}
