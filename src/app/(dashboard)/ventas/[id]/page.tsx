import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApprovalsEnabled, isStockDualEnabled } from "@/lib/features";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import { TIPOS_VENTA } from "@/lib/services/aprobaciones-constants";
import {
  type AprobacionRow,
  listarAprobacionesDeDocumento,
} from "@/lib/services/aprobaciones-query";
import { resolverFaixaMargenVenta } from "@/lib/services/margen-aprobacion";
import {
  type MargenVentaResumen,
  obtenerMargenVentaParaResumen,
} from "@/lib/services/margen-venta-resumen";
import { puedeVerMargen } from "@/lib/permisos-masking";
import { AutorizacionesTab } from "@/components/aprobaciones/autorizaciones-tab";
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
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordTabs } from "@/components/ui/record-tabs";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { EntityLink } from "@/components/data-grid/entity-link";

import type { Moneda } from "../../reportes/_components/moneda-toggle";
import { VentaDetailActions } from "../_components/venta-detail-actions";
import { VentaGeneralView } from "../_components/venta-general-view";
import { VentaEntregasView } from "../_components/venta-entregas-view";
import { VentaEditWindow } from "./_components/venta-edit-window";
import {
  type ClienteResumen,
  type ProximaAccion,
  VentaResumenView,
} from "./_components/venta-resumen-view";
import { type VentaAlerta, VentaAlertasBand } from "./_components/venta-alertas-band";

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

// Alertas activas SÓLO de datos ya cargados (sin motor nuevo): anulada, autorización
// pendiente, cliente bloqueado, emitida sin asiento. "costo no cerrado" / "documento
// pendiente" (CX-07) no derivan de los datos actuales → omitidas (fuera de alcance).
function derivarAlertas(args: {
  venta: VentaDetalle;
  clienteEstado: string;
  pendientes: number;
}): VentaAlerta[] {
  const alertas: VentaAlerta[] = [];
  if (args.venta.estado === "CANCELADA") {
    alertas.push({ nivel: "critical", mensaje: "Venta anulada — registro de sólo lectura." });
  }
  if (args.pendientes > 0) {
    alertas.push({
      nivel: "warning",
      mensaje: `${args.pendientes} autorización(es) pendiente(s) de resolución.`,
      href: "?tab=autorizaciones",
      hrefLabel: "Ver",
    });
  }
  if (args.clienteEstado !== "activo") {
    alertas.push({ nivel: "warning", mensaje: "Cliente bloqueado / inactivo." });
  }
  if (args.venta.estado === "EMITIDA" && args.venta.asientoId === null) {
    alertas.push({ nivel: "info", mensaje: "Venta emitida sin asiento contable vinculado." });
  }
  return alertas;
}

function derivarProximaAccion(args: {
  venta: VentaDetalle;
  stockDualOn: boolean;
  entregasCount: number;
  pendientes: number;
}): ProximaAccion {
  if (args.venta.estado === "BORRADOR") {
    return {
      titulo: "Completar y emitir la venta",
      descripcion: "Edite los ítems y emita para generar el asiento contable (botón Editar).",
    };
  }
  if (args.venta.estado === "CANCELADA") {
    return { titulo: "Sin próxima acción", descripcion: "Venta anulada (sólo lectura)." };
  }
  if (args.pendientes > 0) {
    return {
      titulo: "Esperando autorización",
      descripcion: "Hay solicitudes pendientes de aprobación.",
      href: "?tab=autorizaciones",
      hrefLabel: "Ver autorizaciones",
    };
  }
  if (args.stockDualOn && args.entregasCount === 0) {
    return {
      titulo: "Generar entrega",
      descripcion: "La venta emitida aún no registró entregas.",
      href: "?tab=entregas",
      hrefLabel: "Ver entregas",
    };
  }
  return { titulo: "Venta emitida", descripcion: "Sin acciones pendientes." };
}

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

  const stockDualOn = isStockDualEnabled();
  const approvalsOn = isApprovalsEnabled();
  const esBorrador = venta.estado === "BORRADOR";

  // Resumen primero, Historial última (06_RECORD_PATTERN). Entregas sólo con stock
  // dual; Autorizaciones aditiva (PR-013) siempre presente.
  const tabsDisponibles = stockDualOn
    ? ["resumen", "general", "entregas", "autorizaciones", "historial"]
    : ["resumen", "general", "autorizaciones", "historial"];
  const activeTab = resolveActiveTab(sp.tab, tabsDisponibles, "resumen");

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
    solicitudesVenta,
    ventaMeta,
    creacionLog,
    ultimoLog,
    verMargen,
    margen,
  ] = await Promise.all([
    db.cliente.findUnique({
      where: { id: venta.clienteId },
      select: { nombre: true, cuit: true, estado: true },
    }),
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
    // INERTE con APPROVALS_ENABLED off: la query cortocircuita a [] sin tocar la DB.
    listarAprobacionesDeDocumento("Venta", id),
    db.venta.findUnique({ where: { id }, select: { updatedAt: true } }),
    db.auditLog.findFirst({
      where: { tabla: "Venta", registroId: id },
      orderBy: { fecha: "asc" },
      select: { usuario: { select: { nombre: true } }, fecha: true },
    }),
    db.auditLog.findFirst({
      where: { tabla: "Venta", registroId: id },
      orderBy: { fecha: "desc" },
      select: { usuario: { select: { nombre: true } }, fecha: true },
    }),
    puedeVerMargen(),
    // PR-011: el reader strip-ea (null) cuando falta `costos.ver`; el render se gatea
    // además con `verMargen`. DISPLAY de un cálculo canónico, no recálculo de motor.
    obtenerMargenVentaParaResumen(id),
  ]);

  // Datos del form sólo para BORRADOR (alimentan la FloatingWorkWindow de edición).
  const formData = esBorrador ? await cargarDatosFormVenta(id, approvalsOn) : null;

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };

  const depositosMap: Record<string, string> = {};
  for (const d of depositos) depositosMap[d.id] = d.nombre;

  const clienteNombre = cliente?.nombre ?? "—";
  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda = resolverMonedaPres(sp.moneda, monedaPreferida);
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const condicionLabel = CONDICION_LABELS[venta.condicionPago] ?? venta.condicionPago;
  const clienteResumen: ClienteResumen = {
    id: venta.clienteId,
    nombre: clienteNombre,
    cuit: cliente?.cuit ?? null,
    estado: cliente?.estado ?? "activo",
    condicionLabel,
  };

  const pendientes = solicitudesVenta.filter((s) => s.estado === "PENDIENTE").length;
  const alertas = derivarAlertas({ venta, clienteEstado: clienteResumen.estado, pendientes });
  const proximaAccion = derivarProximaAccion({ venta, stockDualOn, entregasCount, pendientes });

  const updatedAt = ventaMeta?.updatedAt ?? ultimoLog?.fecha ?? new Date(venta.fecha);
  const responsable = creacionLog?.usuario.nombre ?? "—";
  const ultimaActualizacion = ultimoLog?.usuario.nombre
    ? `${fmtFechaHora(updatedAt)} por ${ultimoLog.usuario.nombre}`
    : fmtFechaHora(updatedAt);

  const puedeAnular = venta.estado === "EMITIDA" && venta.asientoId !== null;

  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[{ label: "Ventas", href: "/ventas" }, { label: `Venta ${venta.numero}` }]}
          codigo={`Venta ${venta.numero}`}
          status={<StatusBadge estado={venta.estado} />}
          entidad={
            <EntityLink label={clienteNombre} href={`/maestros/clientes/${venta.clienteId}`} />
          }
          valor={
            <>
              <span>{fmtMontoPres(venta.total, venta.moneda, "ARS", tc)} ARS</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {fmtMontoPres(venta.total, venta.moneda, "USD", tc)} USD
              </span>
            </>
          }
          responsable={responsable}
          meta={[
            { label: "Fecha", value: fmtDate(new Date(venta.fecha)) },
            {
              label: "Vencimiento",
              value: venta.fechaVencimiento ? fmtDate(new Date(venta.fechaVencimiento)) : "—",
            },
            {
              label: "Moneda",
              value: venta.moneda === "ARS" ? "ARS" : `USD · TC ${fmtTipoCambio(venta.tipoCambio)}`,
            },
            { label: "Última actualización", value: ultimaActualizacion },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link href="/ventas" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Volver
            </Link>
          }
        >
          {esBorrador && formData && (
            <VentaEditWindow
              venta={venta}
              clientes={formData.clientes}
              productos={formData.productos}
              depositos={formData.depositos}
              proveedores={formData.proveedores}
              approvalsEnabled={approvalsOn}
              tipoMargenRequerido={formData.faixaMargen?.tipo ?? null}
            />
          )}
          <VentaDetailActions
            ventaId={venta.id}
            numero={venta.numero}
            moneda={moneda}
            tcInfo={tcInfo}
            puedeAnular={puedeAnular}
          />
        </RecordActionBar>
      }
    >
      <VentaAlertasBand alertas={alertas} />

      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "general", label: "Items / Operación" },
          ...(stockDualOn ? [{ value: "entregas", label: "Entregas", count: entregasCount }] : []),
          { value: "autorizaciones", label: "Autorizaciones", count: solicitudesVenta.length },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      <VentaTabContent
        activeTab={activeTab}
        venta={venta}
        clienteResumen={clienteResumen}
        productosMap={productosMap}
        depositosMap={depositosMap}
        asientoNumero={asiento?.numero ?? null}
        moneda={moneda}
        tc={tc}
        margen={margen}
        verMargen={verMargen}
        proximaAccion={proximaAccion}
        approvalsOn={approvalsOn}
        solicitudesVenta={solicitudesVenta}
      />
    </RecordLayout>
  );
}

// Datos para la edición del BORRADOR (clientes/productos/depósitos/proveedores +
// faixa de margen INERTE si APPROVALS off). Extraído para mantener la complejidad
// del page component ≤ 8.
async function cargarDatosFormVenta(id: string, approvalsOn: boolean) {
  const [clientes, productos, depositos, proveedores, faixaMargen] = await Promise.all([
    listarClientesParaVenta(),
    listarProductosParaVenta(),
    listarDepositosParaVenta(),
    listarProveedoresParaGasto(),
    approvalsOn ? resolverFaixaMargenVenta(id) : Promise.resolve(null),
  ]);
  return { clientes, productos, depositos, proveedores, faixaMargen };
}

// Renderiza el contenido de la pestaña activa. Extraído del page component para
// concentrar las ramas (cyclomatic ≤ 8 en ambas funciones).
function VentaTabContent({
  activeTab,
  venta,
  clienteResumen,
  productosMap,
  depositosMap,
  asientoNumero,
  moneda,
  tc,
  margen,
  verMargen,
  proximaAccion,
  approvalsOn,
  solicitudesVenta,
}: {
  activeTab: string;
  venta: VentaDetalle;
  clienteResumen: ClienteResumen;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  depositosMap: Record<string, string>;
  asientoNumero: number | null;
  moneda: Moneda;
  tc: string | null;
  margen: MargenVentaResumen | null;
  verMargen: boolean;
  proximaAccion: ProximaAccion;
  approvalsOn: boolean;
  solicitudesVenta: AprobacionRow[];
}) {
  if (activeTab === "resumen") {
    return (
      <VentaResumenView
        venta={venta}
        cliente={clienteResumen}
        productosMap={productosMap}
        depositosMap={depositosMap}
        asientoNumero={asientoNumero}
        moneda={moneda}
        tc={tc}
        margen={margen}
        verMargen={verMargen}
        proximaAccion={proximaAccion}
      />
    );
  }
  if (activeTab === "general") {
    return (
      <VentaGeneralView
        venta={venta}
        productosMap={productosMap}
        depositosMap={depositosMap}
        asientoNumero={asientoNumero}
        moneda={moneda}
        tc={tc}
      />
    );
  }
  if (activeTab === "entregas") {
    return <EntregasTab ventaId={venta.id} numero={venta.numero} estado={venta.estado} />;
  }
  if (activeTab === "autorizaciones") {
    return (
      <AutorizacionesTab
        tabla="Venta"
        registroId={venta.id}
        solicitudes={solicitudesVenta}
        approvalsEnabled={approvalsOn}
        tiposPermitidos={TIPOS_VENTA}
      />
    );
  }
  if (activeTab === "historial") {
    return <HistorialTab ventaId={venta.id} />;
  }
  return null;
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
