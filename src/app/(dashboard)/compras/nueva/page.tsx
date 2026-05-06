import {
  generarNumeroCompra,
  listarProductosParaCompra,
  listarProveedoresParaCompra,
} from "@/lib/actions/compras";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { CompraForm } from "../_components/compra-form";

export default async function NuevaCompraPage() {
  const [proveedores, productos, numeroSugerido, defaultFecha] = await Promise.all([
    listarProveedoresParaCompra(),
    listarProductosParaCompra(),
    generarNumeroCompra(),
    getDefaultFecha(),
  ]);

  return (
    <CompraForm
      mode="create"
      numeroSugerido={numeroSugerido}
      proveedores={proveedores}
      productos={productos}
      defaultFecha={defaultFecha}
    />
  );
}
