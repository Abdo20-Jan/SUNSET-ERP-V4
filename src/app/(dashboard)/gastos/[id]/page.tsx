import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarCuentasGasto,
  listarProveedoresParaGasto,
  obtenerGastoPorId,
} from "@/lib/actions/gastos";

import { GastoForm } from "../_components/gasto-form";
import { GastoDetailView } from "../_components/gasto-detail-view";

type PageParams = Promise<{ id: string }>;

export default async function GastoDetailPage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;

  const gasto = await obtenerGastoPorId(id);
  if (!gasto) notFound();

  if (gasto.estado === "BORRADOR") {
    const [proveedores, cuentas] = await Promise.all([
      listarProveedoresParaGasto(),
      listarCuentasGasto(),
    ]);
    return (
      <GastoForm
        mode="edit"
        initialData={gasto}
        proveedores={proveedores}
        cuentas={cuentas}
      />
    );
  }

  const [proveedor, cuentas, asiento] = await Promise.all([
    db.proveedor.findUnique({
      where: { id: gasto.proveedorId },
      select: { nombre: true },
    }),
    db.cuentaContable.findMany({
      where: {
        id: { in: gasto.lineas.map((l) => l.cuentaContableGastoId) },
      },
      select: { id: true, codigo: true, nombre: true },
    }),
    gasto.asientoId
      ? db.asiento.findUnique({
          where: { id: gasto.asientoId },
          select: { numero: true },
        })
      : Promise.resolve(null),
  ]);

  const cuentasMap: Record<number, { codigo: string; nombre: string }> = {};
  for (const c of cuentas) {
    cuentasMap[c.id] = { codigo: c.codigo, nombre: c.nombre };
  }

  return (
    <GastoDetailView
      gasto={gasto}
      proveedorNombre={proveedor?.nombre ?? "—"}
      cuentasMap={cuentasMap}
      asientoNumero={asiento?.numero ?? null}
    />
  );
}
