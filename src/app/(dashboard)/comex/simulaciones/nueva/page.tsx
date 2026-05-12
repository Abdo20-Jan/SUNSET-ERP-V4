import {
  generarCodigoSimulacion,
  listarProductosParaSimulacion,
  listarProveedoresParaSimulacion,
} from "@/lib/actions/simulaciones-importacion";

import { SimulacionForm } from "../_components/simulacion-form";

export default async function NuevaSimulacionPage() {
  const [proveedores, productos, codigoSugerido] = await Promise.all([
    listarProveedoresParaSimulacion(),
    listarProductosParaSimulacion(),
    generarCodigoSimulacion(),
  ]);

  return (
    <SimulacionForm
      mode="create"
      proveedores={proveedores}
      productos={productos}
      codigoSugerido={codigoSugerido}
    />
  );
}
