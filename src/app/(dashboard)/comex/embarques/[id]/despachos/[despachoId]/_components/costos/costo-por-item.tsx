import { fmtMoney } from "@/lib/format";
import { RecordSection } from "@/components/record/record-section";

import type { ItemCostoRow } from "../costos-vista";

/** Costo landed por SKU — RESUMEN (código, cantidad, unit landed, total). La
 * memoria detallada (participación, ajuste de redondeo, [Ver memoria]) = PR-023c. */
export function CostoPorItem({ items }: { items: ItemCostoRow[] }) {
  if (items.length === 0) {
    return (
      <RecordSection title="Costo por ítem">
        <p className="text-[12px] text-muted-foreground">Sin ítems con costo landed.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Costo por ítem (landed)">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">#</th>
              <th className="px-2.5 py-1.5 text-left">Producto</th>
              <th className="px-2.5 py-1.5 text-right">Cantidad</th>
              <th className="px-2.5 py-1.5 text-right">Costo unit. landed</th>
              <th className="px-2.5 py-1.5 text-right">Costo total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((it, idx) => (
              <tr key={it.itemDespachoId}>
                <td className="px-2.5 py-1.5 text-muted-foreground">{idx + 1}</td>
                <td className="px-2.5 py-1.5">
                  <span className="font-mono text-[12px]">{it.codigo}</span>
                  <span className="text-muted-foreground"> · {it.nombre}</span>
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{it.cantidad}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {fmtMoney(it.costoUnitarioLanded)}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(it.costoTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}
