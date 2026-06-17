import {
  generarNumeroCompra,
  listarCategoriasCompra,
  listarDepositosNacionales,
  listarProductosParaCompra,
  listarProveedoresParaCompra,
} from "@/lib/actions/compras";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { CompraForm } from "../_components/compra-form";

export const dynamic = "force-dynamic";

export default async function NuevaCompraPage() {
  const [proveedores, productos, categorias, depositos, numeroSugerido, defaultFecha] =
    await Promise.all([
      listarProveedoresParaCompra(),
      listarProductosParaCompra(),
      listarCategoriasCompra(),
      listarDepositosNacionales(),
      generarNumeroCompra(),
      getDefaultFecha(),
    ]);

  return (
    <CompraForm
      mode="create"
      numeroSugerido={numeroSugerido}
      proveedores={proveedores}
      productos={productos}
      categorias={categorias}
      depositos={depositos}
      defaultFecha={defaultFecha}
    />
  );
}
