import { listarProveedoresParaGasto } from "@/lib/actions/gastos";
import {
  generarNumeroVenta,
  listarClientesParaVenta,
  listarDepositosParaVenta,
  listarProductosParaVenta,
} from "@/lib/actions/ventas";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { VentaForm } from "../_components/venta-form";

export const dynamic = "force-dynamic";

export default async function NuevaVentaPage() {
  const [clientes, productos, depositos, proveedores, numeroSugerido, defaultFecha] =
    await Promise.all([
      listarClientesParaVenta(),
      listarProductosParaVenta(),
      listarDepositosParaVenta(),
      listarProveedoresParaGasto(),
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
      proveedores={proveedores}
      defaultFecha={defaultFecha}
    />
  );
}
