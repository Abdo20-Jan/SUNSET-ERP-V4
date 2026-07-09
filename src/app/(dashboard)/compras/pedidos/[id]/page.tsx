import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getAuditLog } from "@/lib/services/auditoria";
import {
  obtenerRecepcionPedidoCompra,
  type RecepcionLinea,
} from "@/lib/services/pedido-compra-recepcion";
import { resolveActiveTab } from "@/lib/record-tabs";
import {
  listarProductosParaPedidoCompra,
  listarProveedoresParaPedidoCompra,
  obtenerPedidoCompraPorId,
  type PedidoCompraDetalle,
} from "@/lib/actions/pedidos-compra";
import type { PedidoEstado } from "@/generated/prisma/client";
import { AuditTrail } from "@/components/ui/audit-trail";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordTabs } from "@/components/ui/record-tabs";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { EntityLink } from "@/components/data-grid/entity-link";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";
import {
  type VentaAlerta,
  VentaAlertasBand,
} from "../../../ventas/[id]/_components/venta-alertas-band";
import { PedidoCompraDetailActions } from "./_components/pedido-compra-detail-actions";
import { PedidoCompraEditWindow } from "./_components/pedido-compra-edit-window";
import {
  type ComexResumen,
  PedidoCompraResumenView,
  type ProveedorResumen,
  type ProximaAccion,
} from "./_components/pedido-compra-resumen-view";
import {
  derivarLineasPedidoCompra,
  type FacturacionResumen,
  type LineaPedidoCompraDerivada,
  PedidoCompraItemsView,
  resumirFacturacion,
} from "./_components/pedido-compra-items-view";
import {
  type CompraVinculadaRow,
  PedidoCompraComprasTab,
} from "./_components/pedido-compra-compras-tab";
import {
  type EmbarqueVinculadoRow,
  PedidoCompraComexTab,
} from "./_components/pedido-compra-comex-tab";
import { PedidoCompraRecepcionTab } from "./_components/pedido-compra-recepcion-tab";

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

function resolverMonedaPres(spMoneda: string | undefined, monedaPreferida: Moneda): Moneda {
  if (spMoneda === "ARS") return "ARS";
  if (spMoneda === "USD") return "USD";
  return monedaPreferida;
}

function fmtFechaHora(fecha: Date): string {
  const hora = fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fmtDate(fecha)} ${hora}`;
}

function resolverTc(cotizacion: Awaited<ReturnType<typeof getCotizacionParaFecha>>): {
  tc: string | null;
  tcInfo: { valor: string; fecha: string; fuente: string | null } | null;
} {
  if (!cotizacion) return { tc: null, tcInfo: null };
  const valor = cotizacion.valor.toString();
  return {
    tc: valor,
    tcInfo: {
      valor,
      fecha: cotizacion.fecha.toISOString().slice(0, 10),
      fuente: cotizacion.fuente,
    },
  };
}

function construirProveedorResumen(
  proveedorId: string,
  proveedor: { nombre: string; pais: string | null; condicionPagoDefault: string } | null,
): ProveedorResumen {
  const condicion = proveedor?.condicionPagoDefault ?? "CUENTA_CORRIENTE";
  return {
    id: proveedorId,
    nombre: proveedor?.nombre ?? "—",
    pais: proveedor?.pais ?? null,
    condicionLabel: CONDICION_LABELS[condicion] ?? condicion,
  };
}

// Alertas SÓLO de datos ya cargados (sin motor nuevo): cancelado, unidades
// pendientes de facturar, productos fuera de pedido en documentos vinculados.
function derivarAlertasPedidoCompra(args: {
  estado: PedidoEstado;
  pendienteFacturar: number;
  fueraDePedido: number;
}): VentaAlerta[] {
  const alertas: VentaAlerta[] = [];
  if (args.estado === "CANCELADO") {
    alertas.push({ nivel: "critical", mensaje: "Pedido cancelado — registro de sólo lectura." });
  }
  if (args.fueraDePedido > 0) {
    alertas.push({
      nivel: "warning",
      mensaje: `${args.fueraDePedido} producto(s) en documentos vinculados fuera del pedido.`,
      href: "?tab=recepcion",
      hrefLabel: "Ver",
    });
  }
  if (args.pendienteFacturar > 0 && args.estado !== "CANCELADO" && args.estado !== "COMPLETADO") {
    alertas.push({
      nivel: "info",
      mensaje: `${args.pendienteFacturar} unidad(es) pendiente(s) de facturar.`,
      href: "?tab=items",
      hrefLabel: "Ver",
    });
  }
  return alertas;
}

function derivarProximaAccionPedidoCompra(estado: PedidoEstado): ProximaAccion {
  if (estado === "BORRADOR") {
    return {
      titulo: "Completar y enviar el pedido",
      descripcion: "Edite los ítems y marque el pedido como enviado (botón Editar).",
    };
  }
  if (estado === "ENVIADO") {
    return {
      titulo: "Confirmar el pedido",
      descripcion: "Confirme el pedido cuando el proveedor lo acepte.",
    };
  }
  if (estado === "CONFIRMADO" || estado === "PARCIAL") {
    return {
      titulo: "Facturar el pedido",
      descripcion: "Cree la factura de compra desde el pedido para registrar la CxP.",
    };
  }
  if (estado === "COMPLETADO") {
    return { titulo: "Pedido completado", descripcion: "Sin acciones pendientes." };
  }
  return { titulo: "Sin próxima acción", descripcion: "Pedido cancelado (sólo lectura)." };
}

async function cargarDatosFormPedido() {
  const [proveedores, productos] = await Promise.all([
    listarProveedoresParaPedidoCompra(),
    listarProductosParaPedidoCompra(),
  ]);
  return { proveedores, productos };
}

// productosMap cubre ítems de la OC Y productos "fuera de pedido" que sólo
// aparecen en documentos vinculados (líneas de recepción con pedida=0).
async function cargarProductosMap(
  pedido: PedidoCompraDetalle,
  recepcion: RecepcionLinea[],
): Promise<Record<string, { codigo: string; nombre: string }>> {
  const ids = new Set<string>(pedido.items.map((it) => it.productoId));
  for (const l of recepcion) ids.add(l.productoId);
  const productos = await db.producto.findMany({
    where: { id: { in: Array.from(ids) } },
    select: { id: true, codigo: true, nombre: true },
  });
  const map: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) map[p.id] = { codigo: p.codigo, nombre: p.nombre };
  return map;
}

export default async function PedidoCompraDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number.parseInt(idStr, 10);
  if (Number.isNaN(id)) notFound();

  const pedido = await obtenerPedidoCompraPorId(id);
  if (!pedido) notFound();

  const editable = pedido.estado === "BORRADOR" || pedido.estado === "ENVIADO";
  const activeTab = resolveActiveTab(
    sp.tab,
    ["resumen", "items", "compras", "comex", "recepcion", "historial"],
    "resumen",
  );

  const [
    proveedor,
    comprasVinculadas,
    embarquesVinculados,
    recepcion,
    // updatedAt vía query paralela page-level: `PedidoCompraDetalle` no lo expone
    // y las actions quedan SIN tocar (ni el DTO — más estricto que el PR-019).
    pedidoRow,
    historialCount,
    session,
    cotizacion,
  ] = await Promise.all([
    db.proveedor.findUnique({
      where: { id: pedido.proveedorId },
      select: { nombre: true, pais: true, condicionPagoDefault: true },
    }),
    db.compra.findMany({
      where: { pedidoCompraId: id },
      select: {
        id: true,
        numero: true,
        fecha: true,
        estado: true,
        moneda: true,
        total: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.embarque.findMany({
      where: { pedidoCompraId: id },
      select: {
        id: true,
        codigo: true,
        estado: true,
        moneda: true,
        fobTotal: true,
        fechaSalida: true,
        fechaLlegada: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    obtenerRecepcionPedidoCompra(id),
    db.pedidoCompra.findUnique({ where: { id }, select: { updatedAt: true } }),
    db.auditLog.count({ where: { tabla: "PedidoCompra", registroId: String(id) } }),
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const formData = editable ? await cargarDatosFormPedido() : null;
  const productosMap = await cargarProductosMap(pedido, recepcion);

  // Fuente única de "facturada" (Σ bruta por producto) = líneas de recepción →
  // paridad garantizada entre las pestañas Items, Resumen y Recepción.
  const facturadasMap = new Map(recepcion.map((l) => [l.productoId, l.facturadaBruta]));
  const lineas = derivarLineasPedidoCompra({
    items: pedido.items,
    productosMap,
    facturadasMap,
    pedidoCancelado: pedido.estado === "CANCELADO",
  });
  const facturacion = resumirFacturacion(
    lineas,
    comprasVinculadas.map((c) => ({ id: c.id, numero: c.numero, estado: c.estado })),
  );

  const totalEstimado = pedido.items
    .reduce(
      (acc, it) => acc.plus(new Decimal(it.precioUnitario).times(it.cantidad)),
      new Decimal(0),
    )
    .toDecimalPlaces(2)
    .toString();

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda = resolverMonedaPres(sp.moneda, monedaPreferida);
  const { tc, tcInfo } = resolverTc(cotizacion);

  const proveedorResumen = construirProveedorResumen(pedido.proveedorId, proveedor);
  const alertas = derivarAlertasPedidoCompra({
    estado: pedido.estado,
    pendienteFacturar: facturacion.pendienteTotal,
    fueraDePedido: recepcion.filter((l) => l.pedida === 0).length,
  });
  const proximaAccion = derivarProximaAccionPedidoCompra(pedido.estado);

  const comprasRows: CompraVinculadaRow[] = comprasVinculadas.map((c) => ({
    id: c.id,
    numero: c.numero,
    fecha: c.fecha.toISOString(),
    estado: c.estado,
    moneda: c.moneda,
    total: c.total.toString(),
  }));
  const embarquesRows: EmbarqueVinculadoRow[] = embarquesVinculados.map((e) => ({
    id: e.id,
    codigo: e.codigo,
    estado: e.estado,
    fechaSalida: e.fechaSalida ? e.fechaSalida.toISOString() : null,
    fechaLlegada: e.fechaLlegada ? e.fechaLlegada.toISOString() : null,
    moneda: e.moneda,
    fobTotal: e.fobTotal.toString(),
  }));
  const comex: ComexResumen = {
    embarques: embarquesRows.map((e) => ({ id: e.id, codigo: e.codigo, estado: e.estado })),
  };

  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "Compras", href: "/compras" },
            { label: "Pedidos", href: "/compras/pedidos" },
            { label: `Pedido ${pedido.numero}` },
          ]}
          codigo={`Pedido ${pedido.numero}`}
          status={<StatusBadge estado={pedido.estado} />}
          entidad={
            <EntityLink
              label={proveedorResumen.nombre}
              href={`/maestros/proveedores/${pedido.proveedorId}`}
            />
          }
          valor={
            <>
              <span>{fmtMontoPres(totalEstimado, pedido.moneda, "ARS", tc)} ARS</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {fmtMontoPres(totalEstimado, pedido.moneda, "USD", tc)} USD
              </span>
            </>
          }
          responsable="—"
          meta={[
            { label: "Fecha", value: fmtDate(new Date(pedido.fecha)) },
            {
              label: "Fecha prevista",
              value: pedido.fechaPrevista ? fmtDate(new Date(pedido.fechaPrevista)) : "—",
            },
            {
              label: "Moneda",
              value:
                pedido.moneda === "ARS" ? "ARS" : `USD · TC ${fmtTipoCambio(pedido.tipoCambio)}`,
            },
            {
              label: "Última actualización",
              value: pedidoRow ? fmtFechaHora(pedidoRow.updatedAt) : "—",
            },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link
              href="/compras/pedidos"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          {editable && formData && (
            <PedidoCompraEditWindow
              pedido={pedido}
              proveedores={formData.proveedores}
              productos={formData.productos}
            />
          )}
          <PedidoCompraDetailActions
            pedidoId={pedido.id}
            numero={pedido.numero}
            estado={pedido.estado}
            moneda={moneda}
            tcInfo={tcInfo}
          />
        </RecordActionBar>
      }
    >
      <VentaAlertasBand alertas={alertas} />

      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "items", label: "Items / Operación" },
          { value: "compras", label: "Compras vinculadas", count: comprasRows.length },
          { value: "comex", label: "Comex", count: embarquesRows.length },
          { value: "recepcion", label: "Recepción" },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      <PedidoCompraTabContent
        activeTab={activeTab}
        pedido={pedido}
        proveedor={proveedorResumen}
        productosMap={productosMap}
        lineas={lineas}
        facturacion={facturacion}
        totalEstimado={totalEstimado}
        moneda={moneda}
        tc={tc}
        proximaAccion={proximaAccion}
        comprasRows={comprasRows}
        embarquesRows={embarquesRows}
        comex={comex}
        recepcion={recepcion}
      />
    </RecordLayout>
  );
}

function PedidoCompraTabContent({
  activeTab,
  pedido,
  proveedor,
  productosMap,
  lineas,
  facturacion,
  totalEstimado,
  moneda,
  tc,
  proximaAccion,
  comprasRows,
  embarquesRows,
  comex,
  recepcion,
}: {
  activeTab: string;
  pedido: PedidoCompraDetalle;
  proveedor: ProveedorResumen;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  lineas: LineaPedidoCompraDerivada[];
  facturacion: FacturacionResumen;
  totalEstimado: string;
  moneda: Moneda;
  tc: string | null;
  proximaAccion: ProximaAccion;
  comprasRows: CompraVinculadaRow[];
  embarquesRows: EmbarqueVinculadoRow[];
  comex: ComexResumen;
  recepcion: RecepcionLinea[];
}) {
  if (activeTab === "resumen") {
    return (
      <PedidoCompraResumenView
        pedido={pedido}
        proveedor={proveedor}
        productosMap={productosMap}
        moneda={moneda}
        tc={tc}
        proximaAccion={proximaAccion}
        facturacion={facturacion}
        comex={comex}
        totalEstimado={totalEstimado}
      />
    );
  }
  if (activeTab === "items") {
    return (
      <PedidoCompraItemsView
        lineas={lineas}
        pedidoMoneda={pedido.moneda}
        moneda={moneda}
        tc={tc}
        numero={pedido.numero}
      />
    );
  }
  if (activeTab === "compras") {
    return <PedidoCompraComprasTab compras={comprasRows} moneda={moneda} tc={tc} />;
  }
  if (activeTab === "comex") {
    return <PedidoCompraComexTab embarques={embarquesRows} />;
  }
  if (activeTab === "recepcion") {
    return <PedidoCompraRecepcionTab lineas={recepcion} productosMap={productosMap} />;
  }
  if (activeTab === "historial") {
    return <HistorialTab registroId={String(pedido.id)} />;
  }
  return null;
}

async function HistorialTab({ registroId }: { registroId: string }) {
  const entries = await getAuditLog("PedidoCompra", registroId);
  return <AuditTrail entries={entries} />;
}
