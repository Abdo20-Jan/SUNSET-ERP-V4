import {
  generarNumeroVenta,
  listarClientesParaVenta,
  listarDepositosParaVenta,
  listarProductosParaVenta,
} from "@/lib/actions/ventas";

import { VentaForm } from "../_components/venta-form";

export default async function NuevaVentaPage() {
  const [clientes, productos, depositos, numeroSugerido] = await Promise.all([
    listarClientesParaVenta(),
    listarProductosParaVenta(),
    listarDepositosParaVenta(),
    generarNumeroVenta(),
  ]);

  return (
    <VentaForm
      mode="create"
      numeroSugerido={numeroSugerido}
      clientes={clientes}
      productos={productos}
      depositos={depositos}
    />
  );
}
