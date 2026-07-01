import { fmtMoney } from "@/lib/format";
import { RecordSection } from "@/components/record/record-section";

import type { ComponentesCosto } from "../costos-vista";

type Fila = { label: string; valor: string; total?: boolean };

/** Descomposición top-level del landed por componente (escalares del motor —
 * nivel resumen, sin romper el prorrateo por línea que vive en PR-023c). */
export function CostoTotalesComponente({ componentes }: { componentes: ComponentesCosto }) {
  const filas: Fila[] = [
    { label: "FOB nacionalizado", valor: componentes.nacionalizado },
    {
      label: "Tributos capitalizables (DIE + Tasa + Arancel)",
      valor: componentes.tributosCapitalizables,
    },
    { label: "Facturas DESPACHO capitalizables", valor: componentes.facturasCapitalizables },
    { label: "= Capitalizables totales", valor: componentes.capitalizables },
    { label: "Costo total landed", valor: componentes.total, total: true },
  ];
  return (
    <RecordSection title="Totales por componente">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Componente</th>
              <th className="px-2.5 py-1.5 text-right">ARS</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filas.map((f) => (
              <tr key={f.label} className={f.total ? "font-medium" : undefined}>
                <td className="px-2.5 py-1.5">{f.label}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(f.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}
