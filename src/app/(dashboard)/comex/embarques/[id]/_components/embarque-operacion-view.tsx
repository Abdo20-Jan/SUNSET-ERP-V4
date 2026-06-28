import { fmtDateOrDash, fmtMoney } from "@/lib/format";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";

import type { ContenedorVista, EmbarqueFinanciero, EmbarqueVista } from "./embarque-vista";

/*
 * EmbarqueOperacionView (PR-021, CX-03 §9.5) — aba "Operación": Items · Transporte
 * (embarque) · Containers · (Timeline vive no Resumen). Read-only e denso. O preço
 * FOB unitário por ítem é GATED (vem só em `financiero`); sem permiso muestra "—".
 * Zero recálculo (CRIT-04/05): tudo de `obtenerEmbarquePorId`.
 */
type ProductosMap = Record<string, { codigo: string; nombre: string }>;

type Props = {
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
  productosMap: ProductosMap;
  contenedores: ContenedorVista[];
};

function ItemsBlock({
  vista,
  financiero,
  productosMap,
}: {
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
  productosMap: ProductosMap;
}) {
  return (
    <RecordSection title={`Ítems (${vista.items.length})`}>
      {vista.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin ítems cargados.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 text-left">Código</th>
                <th className="px-2.5 py-1.5 text-left">Producto</th>
                <th className="px-2.5 py-1.5 text-right">Cantidad</th>
                <th className="px-2.5 py-1.5 text-right">FOB unit.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vista.items.map((it, idx) => {
                const p = productosMap[it.productoId];
                const fob = financiero?.itemsFob[idx];
                return (
                  <tr key={it.id}>
                    <td className="px-2.5 py-1.5 font-mono text-xs">{p?.codigo ?? "—"}</td>
                    <td className="px-2.5 py-1.5">{p?.nombre ?? it.productoId}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {it.cantidad}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {fob ? `${vista.moneda} ${fmtMoney(fob.precioUnitarioFob)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!financiero && (
        <p className="mt-2 text-xs text-muted-foreground">
          Precio FOB unitario oculto — requiere <code className="text-xs">costos.verLanded</code>.
        </p>
      )}
    </RecordSection>
  );
}

function TransporteBlock({ vista }: { vista: EmbarqueVista }) {
  return (
    <RecordSection title="Transporte / embarque">
      <RecordFieldGrid>
        <RecordField label="Buque">{vista.nombreBuque ?? "—"}</RecordField>
        <RecordField label="Línea marítima">{vista.lineaMaritima ?? "—"}</RecordField>
        <RecordField label="Incoterm">
          {vista.incoterm
            ? `${vista.incoterm}${vista.lugarIncoterm ? ` · ${vista.lugarIncoterm}` : ""}`
            : "—"}
        </RecordField>
        <RecordField label="Empaque">{fmtDateOrDash(vista.fechaEmpaque)}</RecordField>
        <RecordField label="Salida">{fmtDateOrDash(vista.fechaSalida)}</RecordField>
        <RecordField label="Transbordo">
          {vista.lugarTransbordo
            ? `${vista.lugarTransbordo} · ${fmtDateOrDash(vista.fechaTransbordo)}`
            : fmtDateOrDash(vista.fechaTransbordo)}
        </RecordField>
        <RecordField label="Llegada (ETA)">{fmtDateOrDash(vista.fechaLlegada)}</RecordField>
        <RecordField label="Días pago post-llegada">
          {vista.diasPagoDespuesLlegada != null ? `${vista.diasPagoDespuesLlegada} días` : "—"}
        </RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

function ContainersDetailBlock({ contenedores }: { contenedores: ContenedorVista[] }) {
  if (contenedores.length === 0) {
    return (
      <RecordSection title="Containers">
        <p className="text-sm text-muted-foreground">
          Sin contenedores desconsolidados (o feature desactivada).
        </p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title={`Containers (${contenedores.length})`}>
      <div className="flex flex-col gap-3">
        {contenedores.map((c) => {
          const unidades = c.items.reduce((acc, it) => acc + it.cantidadDeclarada, 0);
          return (
            <div key={c.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium">{c.numeroContenedor}</span>
                <span className="text-xs text-muted-foreground">
                  {c.tipo ?? "—"} · {c.estado.replace(/_/g, " ")} · {unidades} u.
                </span>
              </div>
              {(c.numeroBL || c.numeroHBL) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  BL: {c.numeroBL ?? "—"} · HBL: {c.numeroHBL ?? "—"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </RecordSection>
  );
}

export function EmbarqueOperacionView({ vista, financiero, productosMap, contenedores }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <ItemsBlock vista={vista} financiero={financiero} productosMap={productosMap} />
      <TransporteBlock vista={vista} />
      <ContainersDetailBlock contenedores={contenedores} />
    </div>
  );
}
