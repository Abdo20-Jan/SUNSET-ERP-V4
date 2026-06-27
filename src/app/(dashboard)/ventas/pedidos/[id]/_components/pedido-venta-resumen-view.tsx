import Link from "next/link";

import type { PedidoVentaDetalle } from "@/lib/actions/pedidos-venta";
import type { MargenPedidoResumen } from "@/lib/services/margen-pedido-resumen";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import { EntityLink } from "@/components/data-grid/entity-link";
import { DateBadge } from "@/components/ui/date-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import type { Moneda } from "../../../../reportes/_components/moneda-toggle";

/*
 * PedidoVentaResumenView (PR-019) — aba "Resumen" (primeira, PAGE-STD-02) do record
 * de Pedido. Espejo de `venta-resumen-view.tsx`. Duas colunas: esquerda = operação
 * (próxima ação, cliente, comercial, preview de itens, CONVERSIÓN); direita =
 * financeiro autorizado (total estimado + margem gated por PR-011). APRESENTACIONAL:
 * a página resolve moeda/TC/margem/próxima ação/conversão; aqui só formatamos.
 *
 * NOTA (PR-019): o pedido NÃO tem campos de reserva no schema. No lugar do badge
 * tri-estado de reserva/"expira em X dias" da OD-02 (sem dado), exibimos rastreio de
 * CONVERSIÓN derivado das ventas vinculadas (solicitada/convertida/pendiente).
 */
export type ClienteResumen = {
  id: string;
  nombre: string;
  cuit: string | null;
  estado: string;
  condicionLabel: string;
};

export type ProximaAccion = {
  titulo: string;
  descripcion: string;
  href?: string;
  hrefLabel?: string;
} | null;

export type ConversionResumen = {
  solicitadaTotal: number;
  convertidaTotal: number;
  pendienteTotal: number;
  /** % convertido (0-100, 1 decimal). */
  pct: number;
  ventas: Array<{ id: string; numero: string; estado: string }>;
};

type Props = {
  pedido: PedidoVentaDetalle;
  cliente: ClienteResumen;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  moneda: Moneda;
  tc: string | null;
  margen: MargenPedidoResumen | null;
  verMargen: boolean;
  proximaAccion: ProximaAccion;
  conversion: ConversionResumen;
  totalEstimado: string;
};

const PREVIEW_ITEMS = 5;

function ProximaAccionBlock({ accion }: { accion: ProximaAccion }) {
  if (!accion) {
    return (
      <RecordSection title="Próxima acción">
        <p className="text-sm text-warning">Sin próxima acción — definir.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Próxima acción">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{accion.titulo}</p>
        <p className="text-xs text-muted-foreground">{accion.descripcion}</p>
        {accion.href && (
          <Link
            href={accion.href}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {accion.hrefLabel ?? "Ejecutar"} →
          </Link>
        )}
      </div>
    </RecordSection>
  );
}

function ClienteBlock({ cliente }: { cliente: ClienteResumen }) {
  return (
    <RecordSection title="Datos del cliente">
      <RecordFieldGrid className="grid gap-3 sm:grid-cols-2">
        <RecordField label="Cliente">
          <EntityLink label={cliente.nombre} href={`/maestros/clientes/${cliente.id}`} />
        </RecordField>
        <RecordField label="CUIT">{cliente.cuit ?? "—"}</RecordField>
        <RecordField label="Condición de pago">{cliente.condicionLabel}</RecordField>
        <RecordField label="Estado financiero">
          <span className={cliente.estado === "activo" ? "" : "text-warning"}>
            {cliente.estado === "activo" ? "Activo" : "Bloqueado / inactivo"}
          </span>
        </RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

function ComercialBlock({ pedido }: { pedido: PedidoVentaDetalle }) {
  return (
    <RecordSection title="Datos comerciales">
      <RecordFieldGrid className="grid gap-3 sm:grid-cols-2">
        <RecordField label="Fecha">{fmtDate(new Date(pedido.fecha))}</RecordField>
        <RecordField label="Fecha prevista">
          <DateBadge fecha={pedido.fechaPrevista} relative />
        </RecordField>
        <RecordField label="Moneda">{pedido.moneda}</RecordField>
        <RecordField label="Tipo de cambio">
          {pedido.moneda === "ARS" ? "—" : `1 USD = ${fmtTipoCambio(pedido.tipoCambio)} ARS`}
        </RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

function ItemsPreviewBlock({
  pedido,
  productosMap,
  moneda,
  tc,
}: {
  pedido: PedidoVentaDetalle;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  moneda: Moneda;
  tc: string | null;
}) {
  const total = pedido.items.length;
  const visibles = pedido.items.slice(0, PREVIEW_ITEMS);
  return (
    <RecordSection
      title="Items"
      actions={
        total > PREVIEW_ITEMS ? (
          <Link href="?tab=items" className="text-xs font-medium text-primary hover:underline">
            Ver todos ({total})
          </Link>
        ) : null
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {visibles.map((it) => {
          const p = productosMap[it.productoId];
          const sub = (Number(it.precioUnitario) * it.cantidad).toFixed(2);
          return (
            <li key={it.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">
                {p ? (
                  <>
                    <span className="font-mono text-xs text-muted-foreground">{p.codigo}</span>{" "}
                    {p.nombre}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {it.cantidad} ×
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {fmtMontoPres(sub, pedido.moneda, moneda, tc)} {moneda}
              </span>
            </li>
          );
        })}
      </ul>
    </RecordSection>
  );
}

function ConversionBlock({ conversion }: { conversion: ConversionResumen }) {
  const { solicitadaTotal, convertidaTotal, pendienteTotal, pct, ventas } = conversion;
  return (
    <RecordSection title="Conversión a venta">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Convertido {pct.toFixed(0)}%</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {convertidaTotal} / {solicitadaTotal} un
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {pendienteTotal > 0
            ? `Pendiente ${pendienteTotal} un de facturar.`
            : "Sin unidades pendientes de facturar."}
        </p>
        {ventas.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Facturas creadas desde este pedido
            </span>
            <div className="flex flex-wrap gap-2">
              {ventas.map((v) => (
                <Link
                  key={v.id}
                  href={`/ventas/${v.id}`}
                  className="inline-flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1 text-sm hover:bg-muted/40"
                >
                  <span className="font-mono">{v.numero}</span>
                  <StatusBadge estado={v.estado} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </RecordSection>
  );
}

function MargenBlock({
  pedido,
  margen,
  verMargen,
  moneda,
  tc,
}: {
  pedido: PedidoVentaDetalle;
  margen: MargenPedidoResumen | null;
  verMargen: boolean;
  moneda: Moneda;
  tc: string | null;
}) {
  if (!verMargen) {
    return (
      <RecordField label="Margen total">
        <span className="text-muted-foreground">— · requiere permiso de margen</span>
      </RecordField>
    );
  }
  if (!margen) {
    return (
      <RecordField label="Margen total">
        <span className="text-muted-foreground">— (sin costo)</span>
      </RecordField>
    );
  }
  const positivo = Number(margen.margenNetoValor) >= 0;
  return (
    <RecordField label="Margen total (neto)">
      <span
        className={
          positivo
            ? "font-mono tabular-nums text-emerald-700 dark:text-emerald-400"
            : "font-mono tabular-nums text-rose-700 dark:text-rose-400"
        }
      >
        {positivo ? "+" : ""}
        {fmtMontoPres(margen.margenNetoValor, pedido.moneda, moneda, tc)} {moneda}
        <span className="ml-1 text-xs text-muted-foreground">({margen.margenNetoPct}%)</span>
      </span>
    </RecordField>
  );
}

function FinancieroBlock({
  pedido,
  totalEstimado,
  moneda,
  tc,
  margen,
  verMargen,
}: {
  pedido: PedidoVentaDetalle;
  totalEstimado: string;
  moneda: Moneda;
  tc: string | null;
  margen: MargenPedidoResumen | null;
  verMargen: boolean;
}) {
  return (
    <RecordSection title="Resumen financiero autorizado">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Total estimado (sin IVA)
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {fmtMontoPres(totalEstimado, pedido.moneda, moneda, tc)} {moneda}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          El IVA y el total fiscal se calculan al convertir el pedido a venta.
        </p>
        <div className="mt-2 border-t border-border pt-2">
          <MargenBlock
            pedido={pedido}
            margen={margen}
            verMargen={verMargen}
            moneda={moneda}
            tc={tc}
          />
        </div>
      </div>
    </RecordSection>
  );
}

export function PedidoVentaResumenView({
  pedido,
  cliente,
  productosMap,
  moneda,
  tc,
  margen,
  verMargen,
  proximaAccion,
  conversion,
  totalEstimado,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <ProximaAccionBlock accion={proximaAccion} />
        <ClienteBlock cliente={cliente} />
        <ComercialBlock pedido={pedido} />
        <ItemsPreviewBlock pedido={pedido} productosMap={productosMap} moneda={moneda} tc={tc} />
        <ConversionBlock conversion={conversion} />
      </div>
      <div className="flex flex-col gap-4">
        <FinancieroBlock
          pedido={pedido}
          totalEstimado={totalEstimado}
          moneda={moneda}
          tc={tc}
          margen={margen}
          verMargen={verMargen}
        />
      </div>
    </div>
  );
}
