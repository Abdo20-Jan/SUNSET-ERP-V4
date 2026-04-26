import {
  generarNumeroPedidoVenta,
  listarClientesParaPedidoVenta,
  listarProductosParaPedidoVenta,
} from "@/lib/actions/pedidos-venta";

import { PedidoVentaForm } from "../_components/pedido-venta-form";

export default async function NuevoPedidoVentaPage() {
  const [clientes, productos, numero] = await Promise.all([
    listarClientesParaPedidoVenta(),
    listarProductosParaPedidoVenta(),
    generarNumeroPedidoVenta(),
  ]);

  return (
    <PedidoVentaForm
      mode="create"
      numeroSugerido={numero}
      clientes={clientes}
      productos={productos}
    />
  );
}
