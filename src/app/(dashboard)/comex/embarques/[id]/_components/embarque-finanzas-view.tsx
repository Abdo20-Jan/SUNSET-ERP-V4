import Link from "next/link";

import { fmtDateOrDash } from "@/lib/format";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";

import type { EmbarqueFinanciero, EmbarqueVista } from "./embarque-vista";

/*
 * EmbarqueFinanzasView (PR-021, CX-03 §9.7) — aba "Finanzas": Costos · Pagos ·
 * Cierre. Costos é GATED (vem só em `financiero`); a memória de rateio NÃO é
 * recalculada aqui (CRIT-04/05) — exibe os valores já gravados. Cierre mostra o
 * status read-only (asientos ZP/cierre); as AÇÕES (confirmar ZP / cerrar) vivem nos
 * diálogos dentro do form hospedado ("Editar embarque"), byte-idênticos. Pagos
 * exteriores se registram desde Tesorería (no rebuild).
 */
type Props = {
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
  proveedoresMap: Record<string, string>;
};

const MOMENTO_LABEL: Record<"ZONA_PRIMARIA" | "DESPACHO", string> = {
  ZONA_PRIMARIA: "Zona primaria",
  DESPACHO: "Despacho",
};

function CostosBlock({
  financiero,
  proveedoresMap,
}: {
  financiero: EmbarqueFinanciero | null;
  proveedoresMap: Record<string, string>;
}) {
  if (!financiero) {
    return (
      <RecordSection title="Costos">
        <p className="text-sm text-muted-foreground">
          — · requiere permiso de costo landed (<code className="text-xs">costos.verLanded</code>).
        </p>
      </RecordSection>
    );
  }
  if (financiero.costos.length === 0) {
    return (
      <RecordSection title="Costos">
        <p className="text-sm text-muted-foreground">Sin facturas de costo cargadas.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection
      title={`Costos (${financiero.costos.length})`}
      description="Memoria de rateio no se recalcula aquí — valores almacenados."
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Proveedor</th>
              <th className="px-2.5 py-1.5 text-left">Momento</th>
              <th className="px-2.5 py-1.5 text-left">Factura</th>
              <th className="px-2.5 py-1.5 text-right">Líneas</th>
              <th className="px-2.5 py-1.5 text-left">Estado</th>
              <th className="px-2.5 py-1.5 text-left">Asiento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {financiero.costos.map((c) => (
              <tr key={c.id}>
                <td className="px-2.5 py-1.5">{proveedoresMap[c.proveedorId] ?? c.proveedorId}</td>
                <td className="px-2.5 py-1.5 text-xs">{MOMENTO_LABEL[c.momento]}</td>
                <td className="px-2.5 py-1.5 font-mono text-xs">
                  {c.facturaNumero ?? "—"}
                  {c.fechaFactura ? ` · ${fmtDateOrDash(c.fechaFactura)}` : ""}
                </td>
                <td className="px-2.5 py-1.5 text-right">{c.lineas.length}</td>
                <td className="px-2.5 py-1.5 text-xs">{c.estado}</td>
                <td className="px-2.5 py-1.5 font-mono text-xs">
                  {c.asientoNumero != null ? `#${c.asientoNumero}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}

function PagosBlock() {
  return (
    <RecordSection title="Pagos">
      <p className="text-sm text-muted-foreground">
        Los pagos exteriores y locales del proceso se registran desde Tesorería / la ficha del
        proveedor. No se reconstruyen en este Record (diferido).
      </p>
    </RecordSection>
  );
}

function AsientoCell({ asiento }: { asiento: EmbarqueVista["asiento"] }) {
  if (!asiento) return <span className="text-muted-foreground">Pendiente</span>;
  return (
    <Link
      href={`/contabilidad/asientos/${asiento.id}`}
      className="font-mono text-primary underline-offset-2 hover:underline"
    >
      #{asiento.numero} ({asiento.estado})
    </Link>
  );
}

function CierreBlock({ vista }: { vista: EmbarqueVista }) {
  return (
    <RecordSection
      title="Cierre"
      description="Confirmar zona primaria / cerrar y contabilizar se hace desde «Editar embarque»."
    >
      <RecordFieldGrid>
        <RecordField label="Estado">{vista.estado.replace(/_/g, " ")}</RecordField>
        <RecordField label="Asiento zona primaria">
          <AsientoCell asiento={vista.asientoZonaPrimaria} />
        </RecordField>
        <RecordField label="Asiento cierre">
          <AsientoCell asiento={vista.asiento} />
        </RecordField>
        <RecordField label="Despachos activos">{vista.despachosActivosCount}</RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

export function EmbarqueFinanzasView({ vista, financiero, proveedoresMap }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <CostosBlock financiero={financiero} proveedoresMap={proveedoresMap} />
      <PagosBlock />
      <CierreBlock vista={vista} />
    </div>
  );
}
