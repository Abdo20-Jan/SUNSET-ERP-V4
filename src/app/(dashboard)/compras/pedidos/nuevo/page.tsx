import {
  generarNumeroPedidoCompra,
  listarProductosParaPedidoCompra,
  listarProveedoresParaPedidoCompra,
} from "@/lib/actions/pedidos-compra";

import { PedidoCompraForm } from "../_components/pedido-compra-form";

export default async function NuevoPedidoCompraPage() {
  const [proveedores, productos, numero] = await Promise.all([
    listarProveedoresParaPedidoCompra(),
    listarProductosParaPedidoCompra(),
    generarNumeroPedidoCompra(),
  ]);

  return (
    <PedidoCompraForm
      mode="create"
      numeroSugerido={numero}
      proveedores={proveedores}
      productos={productos}
    />
  );
}
