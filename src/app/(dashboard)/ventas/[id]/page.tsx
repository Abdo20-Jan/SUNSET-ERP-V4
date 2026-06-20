import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";
import { listarProveedoresParaGasto } from "@/lib/actions/gastos";
import {
  listarClientesParaVenta,
  listarDepositosParaVenta,
  listarProductosParaVenta,
  obtenerVentaPorId,
  type VentaDetalle,
} from "@/lib/actions/ventas";
import { listarEntregasDeVenta } from "@/lib/actions/entregas";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getAuditLog } from "@/lib/services/auditoria";
import { resolveActiveTab } from "@/lib/record-tabs";
import { AuditTrail } from "@/components/ui/audit-trail";
import { RecordHeader } from "@/components/layout/record-header";
import { RecordTabs } from "@/components/ui/record-tabs";
import { StatusBadge } from "@/components/ui/status-badge";

import type { Moneda } from "../../reportes/_components/moneda-toggle";
import { VentaForm } from "../_components/venta-form";
import { VentaDetailActions } from "../_components/venta-detail-actions";
import { VentaGeneralView } from "../_components/venta-general-view";
import { VentaEntregasView } from "../_components/venta-entregas-view";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ moneda?: string; tab?: string }>;

const CONDICION_LABELS: Record<string, string> = {
  CONTADO: "Contado",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
};

export const dynamic = "force-dynamic";

export default async function VentaDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const venta = await obtenerVentaPorId(id);
  if (!venta) notFound();

  if (venta.estado === "BORRADOR") {
    const [clientes, productos, depositos, proveedores] = await Promise.all([
      listarClientesParaVenta(),
      listarProductosParaVenta(),
      listarDepositosParaVenta(),
      listarProveedoresParaGasto(),
    ]);
    return (
      <VentaForm
        mode="edit"
        initialData={venta}
        clientes={clientes}
        productos={productos}
        depositos={depositos}
        proveedores={proveedores}
      />
    );
  }

  const stockDualOn = isStockDualEnabled();
  // La pestaña Historial aparece siempre; Entregas sólo con stock dual.
  const tabsDisponibles = stockDualOn
    ? ["general", "entregas", "historial"]
    : ["general", "historial"];
  const activeTab = resolveActiveTab(sp.tab, tabsDisponibles, "general");

  const depositoIds = venta.items.map((it) => it.depositoId).filter((d): d is string => d !== null);

  const [
    cliente,
    productos,
    depositos,
    asiento,
    entregasCount,
    historialCount,
    session,
    cotizacion,
  ] = await Promise.all([
    db.cliente.findUnique({ where: { id: venta.clienteId }, select: { nombre: true } }),
    db.producto.findMany({
      where: { id: { in: venta.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true },
    }),
    depositoIds.length > 0
      ? db.deposito.findMany({
          where: { id: { in: depositoIds } },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([]),
    venta.asientoId
      ? db.asiento.findUnique({ where: { id: venta.asientoId }, select: { numero: true } })
      : Promise.resolve(null),
    stockDualOn ? db.entregaVenta.count({ where: { ventaId: id } }) : Promise.resolve(0),
    db.auditLog.count({ where: { tabla: "Venta", registroId: id } }),
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };

  const depositosMap: Record<string, string> = {};
  for (const d of depositos) depositosMap[d.id] = d.nombre;

  const clienteNombre = cliente?.nombre ?? "—";
  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    sp.moneda === "ARS" ? "ARS" : sp.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const puedeAnular = venta.estado === "EMITIDA" && venta.asientoId !== null;

  return (
    <div className="flex flex-col gap-3">
      <RecordHeader
        breadcrumb={[{ label: "Ventas", href: "/ventas" }, { label: `Venta ${venta.numero}` }]}
        title={`Venta ${venta.numero}`}
        status={<StatusBadge estado={venta.estado} />}
        subtitle={`${clienteNombre} · ${fmtDate(new Date(venta.fecha))} · ${
          CONDICION_LABELS[venta.condicionPago] ?? venta.condicionPago
        }`}
        actions={
          <VentaDetailActions
            ventaId={venta.id}
            numero={venta.numero}
            moneda={moneda}
            tcInfo={tcInfo}
            puedeAnular={puedeAnular}
          />
        }
      />

      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "general", label: "General" },
          ...(stockDualOn ? [{ value: "entregas", label: "Entregas", count: entregasCount }] : []),
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      {activeTab === "general" && (
        <VentaGeneralView
          venta={venta}
          productosMap={productosMap}
          depositosMap={depositosMap}
          asientoNumero={asiento?.numero ?? null}
          moneda={moneda}
          tc={tc}
        />
      )}
      {activeTab === "entregas" && (
        <EntregasTab ventaId={venta.id} numero={venta.numero} estado={venta.estado} />
      )}
      {activeTab === "historial" && <HistorialTab ventaId={venta.id} />}
    </div>
  );
}

async function HistorialTab({ ventaId }: { ventaId: string }) {
  const entries = await getAuditLog("Venta", ventaId);
  return <AuditTrail entries={entries} />;
}

async function EntregasTab({
  ventaId,
  numero,
  estado,
}: {
  ventaId: string;
  numero: string;
  estado: VentaDetalle["estado"];
}) {
  const entregas = await listarEntregasDeVenta(ventaId);
  return (
    <VentaEntregasView ventaId={ventaId} numero={numero} estado={estado} entregas={entregas} />
  );
}
