import {
  generarCodigoEmbarque,
  listarCuentasParaCostoLogistico,
  listarDepositosParaEmbarque,
  listarProductosParaEmbarque,
  listarProveedoresParaEmbarque,
} from "@/lib/actions/embarques";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { EmbarqueForm } from "../_components/embarque-form";

export const dynamic = "force-dynamic";

export default async function NuevoEmbarquePage() {
  const [proveedores, productos, depositos, cuentasGasto, codigoSugerido, defaultFecha] =
    await Promise.all([
      listarProveedoresParaEmbarque(),
      listarProductosParaEmbarque(),
      listarDepositosParaEmbarque(),
      listarCuentasParaCostoLogistico(),
      generarCodigoEmbarque(),
      getDefaultFecha(),
    ]);

  return (
    <EmbarqueForm
      mode="create"
      proveedores={proveedores}
      productos={productos}
      depositos={depositos}
      cuentasGasto={cuentasGasto}
      codigoSugerido={codigoSugerido}
      defaultFecha={defaultFecha}
    />
  );
}
