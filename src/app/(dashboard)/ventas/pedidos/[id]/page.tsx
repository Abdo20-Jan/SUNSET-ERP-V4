import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApprovalsEnabled } from "@/lib/features";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import { TIPOS_VENTA } from "@/lib/services/aprobaciones-constants";
import {
  type AprobacionRow,
  listarAprobacionesDeDocumento,
} from "@/lib/services/aprobaciones-query";
import {
  type MargenPedidoResumen,
  obtenerMargenPedidoParaResumen,
} from "@/lib/services/margen-pedido-resumen";
import { puedeVerMargen } from "@/lib/permisos-masking";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getAuditLog } from "@/lib/services/auditoria";
import { resolveActiveTab } from "@/lib/record-tabs";
import {
  listarClientesParaPedidoVenta,
  listarProductosParaPedidoVenta,
  obtenerPedidoVentaPorId,
  type PedidoVentaDetalle,
} from "@/lib/actions/pedidos-venta";
import type { PedidoEstado } from "@/generated/prisma/client";
import { AutorizacionesTab } from "@/components/aprobaciones/autorizaciones-tab";
import { AuditTrail } from "@/components/ui/audit-trail";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordTabs } from "@/components/ui/record-tabs";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { EntityLink } from "@/components/data-grid/entity-link";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";
import { type VentaAlerta, VentaAlertasBand } from "../../[id]/_components/venta-alertas-band";
import { PedidoDetailActions } from "./_components/pedido-detail-actions";
import { PedidoEditWindow } from "./_components/pedido-edit-window";
import {
  type ClienteResumen,
  type ConversionResumen,
  PedidoVentaResumenView,
  type ProximaAccion,
} from "./_components/pedido-venta-resumen-view";
import {
  derivarLineasPedido,
  type LineaPedidoDerivada,
  PedidoVentaItemsView,
  resumirConversion,
} from "./_components/pedido-venta-items-view";

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

type ProductoSel = {
  id: string;
  codigo: string;
  nombre: string;
  costoPromedio: { toString(): string };
};

function construirMapas(productos: ProductoSel[]): {
  productosMap: Record<string, { codigo: string; nombre: string }>;
  costoMap: Map<string, string | null>;
} {
  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  const costoMap = new Map<string, string | null>();
  for (const p of productos) {
    productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };
    costoMap.set(p.id, p.costoPromedio.toString());
  }
  return { productosMap, costoMap };
}

type VentaVinculada = {
  id: string;
  numero: string;
  estado: string;
  items: Array<{ productoId: string; cantidad: number }>;
};

// Σ ItemVenta.cantidad por productoId, ignorando ventas CANCELADAS (conversión real).
function construirConvertidasMap(ventas: VentaVinculada[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of ventas) {
    if (v.estado === "CANCELADA") continue;
    for (const it of v.items) {
      map.set(it.productoId, (map.get(it.productoId) ?? 0) + it.cantidad);
    }
  }
  return map;
}

function construirClienteResumen(
  clienteId: string,
  cliente: {
    nombre: string;
    cuit: string | null;
    estado: string;
    condicionPagoDefault: string;
  } | null,
): ClienteResumen {
  const condicion = cliente?.condicionPagoDefault ?? "CUENTA_CORRIENTE";
  return {
    id: clienteId,
    nombre: cliente?.nombre ?? "—",
    cuit: cliente?.cuit ?? null,
    estado: cliente?.estado ?? "activo",
    condicionLabel: CONDICION_LABELS[condicion] ?? condicion,
  };
}

// Alertas SÓLO de datos ya cargados (sin motor nuevo): cancelado, autorización
// pendiente, cliente bloqueado, unidades pendientes de facturar.
function derivarAlertasPedido(args: {
  estado: PedidoEstado;
  clienteEstado: string;
  pendientesAprobacion: number;
  pendienteConversion: number;
}): VentaAlerta[] {
  const alertas: VentaAlerta[] = [];
  if (args.estado === "CANCELADO") {
    alertas.push({ nivel: "critical", mensaje: "Pedido cancelado — registro de sólo lectura." });
  }
  if (args.pendientesAprobacion > 0) {
    alertas.push({
      nivel: "warning",
      mensaje: `${args.pendientesAprobacion} autorización(es) pendiente(s) de resolución.`,
      href: "?tab=autorizaciones",
      hrefLabel: "Ver",
    });
  }
  if (args.clienteEstado !== "activo") {
    alertas.push({ nivel: "warning", mensaje: "Cliente bloqueado / inactivo." });
  }
  if (args.pendienteConversion > 0 && esConvertible(args.estado)) {
    alertas.push({
      nivel: "info",
      mensaje: `${args.pendienteConversion} unidad(es) pendiente(s) de facturar.`,
      href: "?tab=items",
      hrefLabel: "Ver",
    });
  }
  return alertas;
}

function esConvertible(estado: PedidoEstado): boolean {
  return estado === "ENVIADO" || estado === "CONFIRMADO" || estado === "PARCIAL";
}

function derivarProximaAccionPedido(estado: PedidoEstado): ProximaAccion {
  if (estado === "BORRADOR") {
    return {
      titulo: "Completar y enviar el pedido",
      descripcion: "Edite los ítems y marque el pedido como enviado (botón Editar).",
    };
  }
  if (estado === "ENVIADO") {
    return {
      titulo: "Confirmar el pedido",
      descripcion: "Confirme el pedido cuando el cliente lo acepte.",
    };
  }
  if (estado === "CONFIRMADO" || estado === "PARCIAL") {
    return {
      titulo: "Facturar el pedido",
      descripcion: "Convierta el pedido a venta para generar la factura.",
    };
  }
  if (estado === "COMPLETADO") {
    return { titulo: "Pedido completado", descripcion: "Sin acciones pendientes." };
  }
  return { titulo: "Sin próxima acción", descripcion: "Pedido cancelado (sólo lectura)." };
}

async function cargarDatosFormPedido() {
  const [clientes, productos] = await Promise.all([
    listarClientesParaPedidoVenta(),
    listarProductosParaPedidoVenta(),
  ]);
  return { clientes, productos };
}

export default async function PedidoVentaDetailPage({
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

  const pedido = await obtenerPedidoVentaPorId(id);
  if (!pedido) notFound();

  const approvalsOn = isApprovalsEnabled();
  const editable = pedido.estado === "BORRADOR" || pedido.estado === "ENVIADO";
  const activeTab = resolveActiveTab(
    sp.tab,
    ["resumen", "items", "autorizaciones", "historial"],
    "resumen",
  );

  const [
    cliente,
    productos,
    ventasVinculadas,
    historialCount,
    session,
    cotizacion,
    solicitudes,
    verMargen,
    margen,
  ] = await Promise.all([
    db.cliente.findUnique({
      where: { id: pedido.clienteId },
      select: { nombre: true, cuit: true, estado: true, condicionPagoDefault: true },
    }),
    db.producto.findMany({
      where: { id: { in: pedido.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true, costoPromedio: true },
    }),
    db.venta.findMany({
      where: { pedidoVentaId: id },
      select: {
        id: true,
        numero: true,
        estado: true,
        items: { select: { productoId: true, cantidad: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.count({ where: { tabla: "PedidoVenta", registroId: String(id) } }),
    auth(),
    getCotizacionParaFecha(new Date()),
    // INERTE con APPROVALS_ENABLED off: la query cortocircuita a [] sin tocar la DB.
    listarAprobacionesDeDocumento("PedidoVenta", String(id)),
    puedeVerMargen(),
    // PR-011: el reader strip-ea (null) sin `costos.ver`; el render se gatea con verMargen.
    obtenerMargenPedidoParaResumen(id),
  ]);

  const formData = editable ? await cargarDatosFormPedido() : null;

  const { productosMap, costoMap } = construirMapas(productos);
  const convertidasMap = construirConvertidasMap(ventasVinculadas);
  const lineas = derivarLineasPedido({
    items: pedido.items,
    productosMap,
    convertidasMap,
    costoMap,
    verMargen,
    pedidoCancelado: pedido.estado === "CANCELADO",
  });
  const conversion = resumirConversion(
    lineas,
    ventasVinculadas.map((v) => ({ id: v.id, numero: v.numero, estado: v.estado })),
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

  const clienteResumen = construirClienteResumen(pedido.clienteId, cliente);
  const pendientesAprobacion = solicitudes.filter((s) => s.estado === "PENDIENTE").length;
  const alertas = derivarAlertasPedido({
    estado: pedido.estado,
    clienteEstado: clienteResumen.estado,
    pendientesAprobacion,
    pendienteConversion: conversion.pendienteTotal,
  });
  const proximaAccion = derivarProximaAccionPedido(pedido.estado);

  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "Ventas", href: "/ventas" },
            { label: "Pedidos", href: "/ventas/pedidos" },
            { label: `Pedido ${pedido.numero}` },
          ]}
          codigo={`Pedido ${pedido.numero}`}
          status={<StatusBadge estado={pedido.estado} />}
          entidad={
            <EntityLink
              label={clienteResumen.nombre}
              href={`/maestros/clientes/${pedido.clienteId}`}
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
            { label: "Última actualización", value: fmtFechaHora(new Date(pedido.updatedAt)) },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link
              href="/ventas/pedidos"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          {editable && formData && (
            <PedidoEditWindow
              pedido={pedido}
              clientes={formData.clientes}
              productos={formData.productos}
            />
          )}
          <PedidoDetailActions
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
          { value: "autorizaciones", label: "Autorizaciones", count: solicitudes.length },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      <PedidoTabContent
        activeTab={activeTab}
        pedido={pedido}
        clienteResumen={clienteResumen}
        productosMap={productosMap}
        lineas={lineas}
        conversion={conversion}
        totalEstimado={totalEstimado}
        moneda={moneda}
        tc={tc}
        margen={margen}
        verMargen={verMargen}
        proximaAccion={proximaAccion}
        approvalsOn={approvalsOn}
        solicitudes={solicitudes}
      />
    </RecordLayout>
  );
}

function PedidoTabContent({
  activeTab,
  pedido,
  clienteResumen,
  productosMap,
  lineas,
  conversion,
  totalEstimado,
  moneda,
  tc,
  margen,
  verMargen,
  proximaAccion,
  approvalsOn,
  solicitudes,
}: {
  activeTab: string;
  pedido: PedidoVentaDetalle;
  clienteResumen: ClienteResumen;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  lineas: LineaPedidoDerivada[];
  conversion: ConversionResumen;
  totalEstimado: string;
  moneda: Moneda;
  tc: string | null;
  margen: MargenPedidoResumen | null;
  verMargen: boolean;
  proximaAccion: ProximaAccion;
  approvalsOn: boolean;
  solicitudes: AprobacionRow[];
}) {
  if (activeTab === "resumen") {
    return (
      <PedidoVentaResumenView
        pedido={pedido}
        cliente={clienteResumen}
        productosMap={productosMap}
        moneda={moneda}
        tc={tc}
        margen={margen}
        verMargen={verMargen}
        proximaAccion={proximaAccion}
        conversion={conversion}
        totalEstimado={totalEstimado}
      />
    );
  }
  if (activeTab === "items") {
    return (
      <PedidoVentaItemsView
        lineas={lineas}
        pedidoMoneda={pedido.moneda}
        moneda={moneda}
        tc={tc}
        verMargen={verMargen}
        numero={pedido.numero}
      />
    );
  }
  if (activeTab === "autorizaciones") {
    return (
      <AutorizacionesTab
        tabla="PedidoVenta"
        registroId={String(pedido.id)}
        solicitudes={solicitudes}
        approvalsEnabled={approvalsOn}
        tiposPermitidos={TIPOS_VENTA}
      />
    );
  }
  if (activeTab === "historial") {
    return <HistorialTab registroId={String(pedido.id)} />;
  }
  return null;
}

async function HistorialTab({ registroId }: { registroId: string }) {
  const entries = await getAuditLog("PedidoVenta", registroId);
  return <AuditTrail entries={entries} />;
}
