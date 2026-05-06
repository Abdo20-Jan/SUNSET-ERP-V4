import {
  generarNumeroVenta,
  listarClientesParaVenta,
  listarDepositosParaVenta,
  listarProductosParaVenta,
} from "@/lib/actions/ventas";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { VentaForm } from "../_components/venta-form";

export default async function NuevaVentaPage() {
  const [clientes, productos, depositos, numeroSugerido, defaultFecha] = await Promise.all([
    listarClientesParaVenta(),
    listarProductosParaVenta(),
    listarDepositosParaVenta(),
    generarNumeroVenta(),
    getDefaultFecha(),
  ]);

  return (
    <VentaForm
      mode="create"
      numeroSugerido={numeroSugerido}
      clientes={clientes}
      productos={productos}
      depositos={depositos}
      defaultFecha={defaultFecha}
    />
  );
}
