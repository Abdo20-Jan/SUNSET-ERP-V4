import {
  generarCodigoEmbarque,
  listarCuentasParaCostoLogistico,
  listarDepositosParaEmbarque,
  listarProductosParaEmbarque,
  listarProveedoresParaEmbarque,
} from "@/lib/actions/embarques";

import { EmbarqueForm } from "../_components/embarque-form";

export default async function NuevoEmbarquePage() {
  const [proveedores, productos, depositos, cuentasGasto, codigoSugerido] =
    await Promise.all([
      listarProveedoresParaEmbarque(),
      listarProductosParaEmbarque(),
      listarDepositosParaEmbarque(),
      listarCuentasParaCostoLogistico(),
      generarCodigoEmbarque(),
    ]);

  return (
    <EmbarqueForm
      mode="create"
      proveedores={proveedores}
      productos={productos}
      depositos={depositos}
      cuentasGasto={cuentasGasto}
      codigoSugerido={codigoSugerido}
    />
  );
}
