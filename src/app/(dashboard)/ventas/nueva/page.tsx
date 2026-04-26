import {
  generarNumeroVenta,
  listarClientesParaVenta,
  listarProductosParaVenta,
} from "@/lib/actions/ventas";

import { VentaForm } from "../_components/venta-form";

export default async function NuevaVentaPage() {
  const [clientes, productos, numeroSugerido] = await Promise.all([
    listarClientesParaVenta(),
    listarProductosParaVenta(),
    generarNumeroVenta(),
  ]);

  return (
    <VentaForm
      mode="create"
      numeroSugerido={numeroSugerido}
      clientes={clientes}
      productos={productos}
    />
  );
}
