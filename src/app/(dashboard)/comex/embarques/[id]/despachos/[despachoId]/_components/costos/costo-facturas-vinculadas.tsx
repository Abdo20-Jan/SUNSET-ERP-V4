import { fmtMoney } from "@/lib/format";
import { RecordSection } from "@/components/record/record-section";

import type { FacturaCostoRow } from "../costos-vista";

function CapitalizableBadge({ capitalizable }: { capitalizable: boolean }) {
  return capitalizable ? (
    <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
      Capitalizable (landed)
    </span>
  ) : (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      No capitaliza (Zona Primaria)
    </span>
  );
}

/** Facturas/gastos vinculados. Sólo las DESPACHO capitalizan en el landed; las
 * ZONA_PRIMARIA se distribuyen antes del despacho y NO entran en este total
 * (filtro espejo de `obtenerMemoriaDespacho`). */
export function CostoFacturasVinculadas({ facturas }: { facturas: FacturaCostoRow[] }) {
  if (facturas.length === 0) {
    return (
      <RecordSection title="Facturas vinculadas">
        <p className="text-[12px] text-muted-foreground">Sin facturas vinculadas.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Facturas vinculadas">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Proveedor</th>
              <th className="px-2.5 py-1.5 text-left">Número</th>
              <th className="px-2.5 py-1.5 text-left">Momento</th>
              <th className="px-2.5 py-1.5 text-left">Clasificación</th>
              <th className="px-2.5 py-1.5 text-right">Total ARS</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {facturas.map((f) => (
              <tr key={f.id}>
                <td className="px-2.5 py-1.5">{f.proveedor}</td>
                <td className="px-2.5 py-1.5 font-mono text-[12px]">{f.numero ?? "—"}</td>
                <td className="px-2.5 py-1.5 text-muted-foreground">{f.momento}</td>
                <td className="px-2.5 py-1.5">
                  <CapitalizableBadge capitalizable={f.capitalizable} />
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(f.totalArs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}
