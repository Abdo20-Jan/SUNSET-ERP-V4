import {
  generarNumeroCompra,
  listarProductosParaCompra,
  listarProveedoresParaCompra,
} from "@/lib/actions/compras";

import { CompraForm } from "../_components/compra-form";

export default async function NuevaCompraPage() {
  const [proveedores, productos, numeroSugerido] = await Promise.all([
    listarProveedoresParaCompra(),
    listarProductosParaCompra(),
    generarNumeroCompra(),
  ]);

  return (
    <CompraForm
      mode="create"
      numeroSugerido={numeroSugerido}
      proveedores={proveedores}
      productos={productos}
    />
  );
}
