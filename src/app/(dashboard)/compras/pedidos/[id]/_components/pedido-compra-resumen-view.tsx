import Link from "next/link";

import type { PedidoCompraDetalle } from "@/lib/actions/pedidos-compra";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import { EntityLink } from "@/components/data-grid/entity-link";
import { DateBadge } from "@/components/ui/date-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import type { Moneda } from "../../../../reportes/_components/moneda-toggle";
import type { FacturacionResumen } from "./pedido-compra-items-view";

/*
 * PedidoCompraResumenView (PR-029) — aba "Resumen" (primeira, PAGE-STD-02) do record
 * da OC. Espejo de `pedido-venta-resumen-view.tsx` (PR-019). Duas colunas: esquerda =
 * operação (próxima ação, proveedor, datos del pedido, preview de itens, FACTURACIÓN);
 * direita = financeiro (total estimado — a OC não modela margen) + vínculo Comex.
 * APRESENTACIONAL: a página resolve moeda/TC/próxima ação/facturación; aqui só
 * formatamos.
 */
export type ProveedorResumen = {
  id: string;
  nombre: string;
  pais: string | null;
  condicionLabel: string;
};

export type ProximaAccion = {
  titulo: string;
  descripcion: string;
  href?: string;
  hrefLabel?: string;
} | null;

export type ComexResumen = {
  embarques: Array<{ id: string; codigo: string; estado: string }>;
};

type Props = {
  pedido: PedidoCompraDetalle;
  proveedor: ProveedorResumen;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  moneda: Moneda;
  tc: string | null;
  proximaAccion: ProximaAccion;
  facturacion: FacturacionResumen;
  comex: ComexResumen;
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

function ProveedorBlock({ proveedor }: { proveedor: ProveedorResumen }) {
  return (
    <RecordSection title="Datos del proveedor">
      <RecordFieldGrid className="grid gap-3 sm:grid-cols-2">
        <RecordField label="Proveedor">
          <EntityLink label={proveedor.nombre} href={`/maestros/proveedores/${proveedor.id}`} />
        </RecordField>
        <RecordField label="País">{proveedor.pais ?? "—"}</RecordField>
        <RecordField label="Condición de pago (default)">{proveedor.condicionLabel}</RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

function PedidoBlock({ pedido }: { pedido: PedidoCompraDetalle }) {
  return (
    <RecordSection title="Datos del pedido">
      <RecordFieldGrid className="grid gap-3 sm:grid-cols-2">
        <RecordField label="Fecha">{fmtDate(new Date(pedido.fecha))}</RecordField>
        <RecordField label="Fecha prevista">
          <DateBadge fecha={pedido.fechaPrevista} relative />
        </RecordField>
        <RecordField label="Moneda">{pedido.moneda}</RecordField>
        <RecordField label="Tipo de cambio">
          {pedido.moneda === "ARS" ? "—" : `1 USD = ${fmtTipoCambio(pedido.tipoCambio)} ARS`}
        </RecordField>
        <RecordField label="Observaciones">{pedido.observaciones ?? "—"}</RecordField>
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
  pedido: PedidoCompraDetalle;
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

function FacturacionBlock({ facturacion }: { facturacion: FacturacionResumen }) {
  const { pedidaTotal, facturadaTotal, pendienteTotal, pct, compras } = facturacion;
  return (
    <RecordSection title="Facturación">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Facturado {pct.toFixed(0)}%</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {facturadaTotal} / {pedidaTotal} un
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {pendienteTotal > 0
            ? `Pendiente ${pendienteTotal} un de facturar.`
            : "Sin unidades pendientes de facturar."}
        </p>
        {compras.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Facturas creadas desde este pedido
            </span>
            <div className="flex flex-wrap gap-2">
              {compras.map((c) => (
                <Link
                  key={c.id}
                  href={`/compras/${c.id}`}
                  className="inline-flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1 text-sm hover:bg-muted/40"
                >
                  <span className="font-mono">{c.numero}</span>
                  <StatusBadge estado={c.estado} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </RecordSection>
  );
}

function FinancieroBlock({
  pedido,
  totalEstimado,
  moneda,
  tc,
}: {
  pedido: PedidoCompraDetalle;
  totalEstimado: string;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <RecordSection title="Resumen financiero">
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
          El IVA y el total fiscal se calculan al crear la factura desde el pedido.
        </p>
      </div>
    </RecordSection>
  );
}

function ComexBlock({ comex }: { comex: ComexResumen }) {
  return (
    <RecordSection
      title="Proceso Comex"
      actions={
        <Link href="?tab=comex" className="text-xs font-medium text-primary hover:underline">
          Ver pestaña →
        </Link>
      }
    >
      {comex.embarques.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin procesos Comex vinculados.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {comex.embarques.map((e) => (
            <Link
              key={e.id}
              href={`/comex/embarques/${e.id}`}
              className="inline-flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1 text-sm hover:bg-muted/40"
            >
              <span className="font-mono">{e.codigo}</span>
              <StatusBadge estado={e.estado} />
            </Link>
          ))}
        </div>
      )}
    </RecordSection>
  );
}

export function PedidoCompraResumenView({
  pedido,
  proveedor,
  productosMap,
  moneda,
  tc,
  proximaAccion,
  facturacion,
  comex,
  totalEstimado,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <ProximaAccionBlock accion={proximaAccion} />
        <ProveedorBlock proveedor={proveedor} />
        <PedidoBlock pedido={pedido} />
        <ItemsPreviewBlock pedido={pedido} productosMap={productosMap} moneda={moneda} tc={tc} />
        <FacturacionBlock facturacion={facturacion} />
      </div>
      <div className="flex flex-col gap-4">
        <FinancieroBlock pedido={pedido} totalEstimado={totalEstimado} moneda={moneda} tc={tc} />
        <ComexBlock comex={comex} />
      </div>
    </div>
  );
}
