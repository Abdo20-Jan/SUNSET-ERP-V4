import Link from "next/link";

import type { VentaDetalle } from "@/lib/actions/ventas";
import type { MargenVentaResumen } from "@/lib/services/margen-venta-resumen";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import { EntityLink } from "@/components/data-grid/entity-link";
import { DateBadge } from "@/components/ui/date-badge";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import type { Moneda } from "../../../reportes/_components/moneda-toggle";

/*
 * VentaResumenView (PR-018) — aba "Resumen" (primeira, PAGE-STD-02): a
 * "fotografia" do registro em duas colunas. Esquerda = operação (próxima ação,
 * cliente, comercial, preview de itens); direita = financeiro autorizado (resumo
 * armazenado + margem gated por PR-011). APRESENTACIONAL: a página resolve moeda,
 * TC, margem (já gated) e a próxima ação; aqui só formatamos.
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

type Props = {
  venta: VentaDetalle;
  cliente: ClienteResumen;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  depositosMap: Record<string, string>;
  asientoNumero: number | null;
  moneda: Moneda;
  tc: string | null;
  margen: MargenVentaResumen | null;
  verMargen: boolean;
  proximaAccion: ProximaAccion;
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

function ComercialBlock({
  venta,
  depositosLabel,
}: {
  venta: VentaDetalle;
  depositosLabel: string;
}) {
  return (
    <RecordSection title="Datos comerciales">
      <RecordFieldGrid className="grid gap-3 sm:grid-cols-2">
        <RecordField label="Depósito">{depositosLabel}</RecordField>
        <RecordField label="Fecha">{fmtDate(new Date(venta.fecha))}</RecordField>
        <RecordField label="Vencimiento">
          <DateBadge fecha={venta.fechaVencimiento} relative />
        </RecordField>
        <RecordField label="Moneda">{venta.moneda}</RecordField>
        <RecordField label="Tipo de cambio">
          {venta.moneda === "ARS" ? "—" : `1 USD = ${fmtTipoCambio(venta.tipoCambio)} ARS`}
        </RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

function ItemsPreviewBlock({
  venta,
  productosMap,
  moneda,
  tc,
}: {
  venta: VentaDetalle;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  moneda: Moneda;
  tc: string | null;
}) {
  const total = venta.items.length;
  const visibles = venta.items.slice(0, PREVIEW_ITEMS);
  return (
    <RecordSection
      title="Items"
      actions={
        total > PREVIEW_ITEMS ? (
          <Link href="?tab=general" className="text-xs font-medium text-primary hover:underline">
            Ver todos ({total})
          </Link>
        ) : null
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {visibles.map((it) => {
          const p = productosMap[it.productoId];
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
                {fmtMontoPres(it.total, venta.moneda, moneda, tc)} {moneda}
              </span>
            </li>
          );
        })}
      </ul>
    </RecordSection>
  );
}

function FinancieroRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "negative";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={
          tone === "negative"
            ? "font-mono text-sm tabular-nums text-rose-700 dark:text-rose-400"
            : "font-mono text-sm tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function MargenBlock({
  venta,
  margen,
  verMargen,
  moneda,
  tc,
}: {
  venta: VentaDetalle;
  margen: MargenVentaResumen | null;
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
        {fmtMontoPres(margen.margenNetoValor, venta.moneda, moneda, tc)} {moneda}
        <span className="ml-1 text-xs text-muted-foreground">({margen.margenNetoPct}%)</span>
      </span>
    </RecordField>
  );
}

function FinancieroBlock({
  venta,
  asientoNumero,
  moneda,
  tc,
  margen,
  verMargen,
}: {
  venta: VentaDetalle;
  asientoNumero: number | null;
  moneda: Moneda;
  tc: string | null;
  margen: MargenVentaResumen | null;
  verMargen: boolean;
}) {
  const otros = Number(venta.iibb) + Number(venta.otros);
  return (
    <RecordSection title="Resumen financiero autorizado">
      <div className="flex flex-col gap-1.5">
        <FinancieroRow
          label="Subtotal"
          value={`${fmtMontoPres(venta.subtotal, venta.moneda, moneda, tc)} ${moneda}`}
        />
        <FinancieroRow
          label="IVA"
          value={`${fmtMontoPres(venta.iva, venta.moneda, moneda, tc)} ${moneda}`}
        />
        <FinancieroRow
          label="IIBB + Otros"
          value={`${fmtMontoPres(otros.toFixed(2), venta.moneda, moneda, tc)} ${moneda}`}
        />
        {Number(venta.flete) > 0 && (
          <FinancieroRow
            label="Flete"
            value={`-${fmtMontoPres(venta.flete, venta.moneda, moneda, tc)} ${moneda}`}
            tone="negative"
          />
        )}
        <div className="my-1 border-t border-border" />
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Total</span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {fmtMontoPres(venta.total, venta.moneda, moneda, tc)} {moneda}
          </span>
        </div>
        <div className="mt-2 border-t border-border pt-2">
          <MargenBlock
            venta={venta}
            margen={margen}
            verMargen={verMargen}
            moneda={moneda}
            tc={tc}
          />
        </div>
        <RecordField label="Asiento contable" className="mt-2">
          {asientoNumero != null ? (
            <span className="font-mono">Nº {asientoNumero}</span>
          ) : (
            <span className="text-muted-foreground">Sin asiento</span>
          )}
        </RecordField>
      </div>
    </RecordSection>
  );
}

function resolverDepositosLabel(venta: VentaDetalle, depositosMap: Record<string, string>): string {
  const nombres = new Set<string>();
  for (const it of venta.items) {
    nombres.add(
      it.depositoId ? (depositosMap[it.depositoId] ?? it.depositoId) : "Default (NACIONAL)",
    );
  }
  return nombres.size > 0 ? Array.from(nombres).join(" · ") : "Default (NACIONAL)";
}

export function VentaResumenView({
  venta,
  cliente,
  productosMap,
  depositosMap,
  asientoNumero,
  moneda,
  tc,
  margen,
  verMargen,
  proximaAccion,
}: Props) {
  const depositosLabel = resolverDepositosLabel(venta, depositosMap);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <ProximaAccionBlock accion={proximaAccion} />
        <ClienteBlock cliente={cliente} />
        <ComercialBlock venta={venta} depositosLabel={depositosLabel} />
        <ItemsPreviewBlock venta={venta} productosMap={productosMap} moneda={moneda} tc={tc} />
      </div>
      <div className="flex flex-col gap-4">
        <FinancieroBlock
          venta={venta}
          asientoNumero={asientoNumero}
          moneda={moneda}
          tc={tc}
          margen={margen}
          verMargen={verMargen}
        />
      </div>
    </div>
  );
}
