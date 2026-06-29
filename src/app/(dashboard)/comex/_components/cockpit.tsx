import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CargoShipIcon,
  Clock01Icon,
  Coins01Icon,
  CoinsDollarIcon,
  File01Icon,
} from "@hugeicons/core-free-icons";

import { fmtDateOrDash, fmtMoney } from "@/lib/format";
import {
  TONO_STATUS_COSTO,
  type EtaTono,
  type Tono,
} from "@/lib/services/comex-worklist-derivaciones";
import type {
  CockpitData,
  CostoPendienteItem,
  DocumentoProxyItem,
  PagoExteriorItem,
  ProcesoCriticoItem,
  SinActualizacionItem,
} from "@/lib/services/comex-cockpit";
import type { ArriboItem } from "@/lib/services/comex-cockpit";
import type { Moneda } from "@/generated/prisma/client";

import { CockpitAlertasBand } from "./cockpit-alertas-band";
import { CockpitBloque, type CockpitBloqueRow } from "./cockpit-bloque";
import { CockpitIndicadores } from "./cockpit-indicadores";

/**
 * Composición del Cockpit Operacional Comex (CX-01 §9): banda de alertas →
 * 4 indicadores → 6 bloques de pendencias (2×3). 100% read-only con drill-down
 * a la ficha del proceso (`/comex/embarques/[id]`) y [Ver todos] a la worklist.
 * Server component: NINGÚN valor financiero llega sin el strip server-side (el
 * payload ya viene enmascarado).
 */

const fichaHref = (id: string) => `/comex/embarques/${id}`;

function etaToTono(t: EtaTono): Tono {
  if (t === "overdue") return "danger";
  if (t === "soon") return "warning";
  return "neutral";
}

function rowsCriticos(items: ProcesoCriticoItem[]): CockpitBloqueRow[] {
  return items.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    href: fichaHref(i.id),
    proveedorNombre: i.proveedorNombre,
    detalle: i.proximaAccion,
    metric: i.motivo,
    metricTono: "danger",
  }));
}

function rowsArribos(items: ArriboItem[]): CockpitBloqueRow[] {
  return items.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    href: fichaHref(i.id),
    proveedorNombre: i.proveedorNombre,
    detalle: i.fobUsd ? `FOB ${fmtMoney(i.fobUsd)} USD · ${i.proximaAccion}` : i.proximaAccion,
    metric: fmtDateOrDash(i.fechaLlegada),
    metricTono: etaToTono(i.etaTono),
  }));
}

function rowsSinActualizacion(items: SinActualizacionItem[]): CockpitBloqueRow[] {
  return items.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    href: fichaHref(i.id),
    proveedorNombre: i.proveedorNombre,
    detalle: i.proximaAccion,
    metric: `${i.dias}d sin mover`,
    metricTono: i.banda === "red" ? "danger" : "warning",
  }));
}

function rowsPagos(items: PagoExteriorItem[]): CockpitBloqueRow[] {
  return items.map((i, idx) => ({
    id: `${i.embarqueId ?? "suelta"}-${idx}`,
    codigo: i.embarqueCodigo ?? i.proveedorNombre,
    href: i.embarqueId ? fichaHref(i.embarqueId) : "/comex/proveedores",
    proveedorNombre: i.proveedorNombre,
    detalle: `Vence ${fmtDateOrDash(i.fechaVencimiento)}`,
    metric: `${fmtMoney(i.saldoUsd)} USD`,
    metricTono: "warning",
  }));
}

function rowsCostos(items: CostoPendienteItem[]): CockpitBloqueRow[] {
  return items.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    href: fichaHref(i.id),
    proveedorNombre: i.proveedorNombre,
    detalle: "Costo aún sin facturar",
    metric: i.statusCosto,
    metricTono: TONO_STATUS_COSTO[i.statusCosto],
  }));
}

function rowsDocumentos(items: DocumentoProxyItem[]): CockpitBloqueRow[] {
  return items.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    href: fichaHref(i.id),
    proveedorNombre: i.proveedorNombre,
    detalle: "Contenedores sin BL",
    metric: `${i.contenedoresSinBL} sin BL`,
    metricTono: "warning",
  }));
}

/** Placeholder honesto cuando la sección Financeiro fue OMITIDA server-side (sin permiso). */
function SeccionSinPermiso({ title, icon }: { title: string; icon: IconSvgElement }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center">
      <HugeiconsIcon icon={icon} className="size-5 text-muted-foreground" strokeWidth={2} />
      <span className="text-[13px] font-semibold text-muted-foreground">{title}</span>
      <span className="text-[11px] text-muted-foreground">
        Requiere permiso de valores financieros
      </span>
    </div>
  );
}

export function Cockpit({
  data,
  moneda,
  tc,
}: {
  data: CockpitData;
  moneda: Moneda;
  tc: string | null;
}) {
  const { indicadores, operacion, documentos, custos, financeiro } = data;
  return (
    <div className="flex flex-col gap-3">
      <CockpitAlertasBand criticos={operacion.procesosCriticos} />
      <CockpitIndicadores indicadores={indicadores} moneda={moneda} tc={tc} />

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
        <CockpitBloque
          title="Procesos críticos"
          icon={AlertCircleIcon}
          count={operacion.procesosCriticos.length}
          rows={rowsCriticos(operacion.procesosCriticos)}
          emptyMsg="Sin procesos críticos"
          footnote="Demurrage / free-time omitidos: sin datos en el sistema"
        />
        <CockpitBloque
          title="Próximos arribos ≤15d"
          icon={CargoShipIcon}
          count={operacion.proximosArribos.length}
          verTodosHref="/comex/embarques?vista=proximos"
          rows={rowsArribos(operacion.proximosArribos)}
          emptyMsg="Sin arribos en 15 días"
        />
        <CockpitBloque
          title="Sin actualización ≥5d"
          icon={Clock01Icon}
          count={operacion.sinActualizacion.length}
          rows={rowsSinActualizacion(operacion.sinActualizacion)}
          emptyMsg="Todo actualizado (≤5 días)"
        />

        {financeiro ? (
          <CockpitBloque
            title="Pagos exteriores ≤30d"
            icon={CoinsDollarIcon}
            count={financeiro.pagosExteriores.length}
            verTodosHref="/comex/proveedores"
            rows={rowsPagos(financeiro.pagosExteriores)}
            emptyMsg="Sin pagos exteriores ≤30 días"
            footnote={
              financeiro.sinFechaCount > 0
                ? `${financeiro.sinFechaCount} factura(s) exterior sin fecha de vencimiento`
                : undefined
            }
          />
        ) : (
          <SeccionSinPermiso title="Pagos exteriores ≤30d" icon={CoinsDollarIcon} />
        )}

        <CockpitBloque
          title="Costos pendientes"
          icon={Coins01Icon}
          count={custos.length}
          rows={rowsCostos(custos)}
          emptyMsg="Sin costos provisionales"
          footnote="Gap vs costo final omitido: lo provee el motor de rateio (no se recalcula)"
        />
        <CockpitBloque
          title="Documentos pendientes"
          icon={File01Icon}
          count={documentos.length}
          rows={rowsDocumentos(documentos)}
          emptyMsg="Sin documentos pendientes"
          footnote="Proxy: contenedores sin BL (no hay modelo de documentos)"
        />
      </div>
    </div>
  );
}
