import {
  generarCodigoEmbarque,
  listarDepositosParaEmbarque,
  listarProductosParaEmbarque,
  listarProveedoresParaEmbarque,
} from "@/lib/actions/embarques";

import { EmbarqueForm } from "../_components/embarque-form";

export default async function NuevoEmbarquePage() {
  const [proveedores, productos, depositos, codigoSugerido] = await Promise.all([
    listarProveedoresParaEmbarque(),
    listarProductosParaEmbarque(),
    listarDepositosParaEmbarque(),
    generarCodigoEmbarque(),
  ]);

  return (
    <EmbarqueForm
      mode="create"
      proveedores={proveedores}
      productos={productos}
      depositos={depositos}
      codigoSugerido={codigoSugerido}
    />
  );
}
