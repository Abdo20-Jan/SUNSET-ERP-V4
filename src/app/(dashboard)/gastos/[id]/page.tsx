import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarCuentasGasto,
  listarProveedoresParaGasto,
  obtenerGastoPorId,
} from "@/lib/actions/gastos";
import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

import type { Moneda } from "../../reportes/_components/moneda-toggle";
import { GastoForm } from "../_components/gasto-form";
import { GastoDetailView } from "../_components/gasto-detail-view";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function GastoDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
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
      <GastoForm mode="edit" initialData={gasto} proveedores={proveedores} cuentas={cuentas} />
    );
  }

  const [proveedor, cuentas, asiento, params2, session, cotizacion] = await Promise.all([
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
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const cuentasMap: Record<number, { codigo: string; nombre: string }> = {};
  for (const c of cuentas) {
    cuentasMap[c.id] = { codigo: c.codigo, nombre: c.nombre };
  }

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params2.moneda === "ARS" ? "ARS" : params2.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <GastoDetailView
      gasto={gasto}
      proveedorNombre={proveedor?.nombre ?? "—"}
      cuentasMap={cuentasMap}
      asientoNumero={asiento?.numero ?? null}
      moneda={moneda}
      tc={tc}
      tcInfo={tcInfo}
    />
  );
}
