"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PagoHistorico } from "@/lib/services/historico-pagos";

function fmtMoney(s: string | number) {
  const n = typeof s === "string" ? Number(s) : s;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function PagosHistorialTable({ pagos }: { pagos: PagoHistorico[] }) {
  if (pagos.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Sin pagos para los filtros seleccionados.
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto py-0">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Proveedor</th>
            <th className="px-3 py-2">Factura / Ref</th>
            <th className="px-3 py-2">Banco</th>
            <th className="px-3 py-2">Método</th>
            <th className="px-3 py-2 text-right">Moneda</th>
            <th className="px-3 py-2 text-right">TC</th>
            <th className="px-3 py-2 text-right">Monto</th>
            <th className="px-3 py-2 text-right">ARS</th>
            <th className="px-3 py-2 text-right">Dif. cambio</th>
            <th className="px-3 py-2 text-right">Asiento</th>
          </tr>
        </thead>
        <tbody>
          {pagos.map((p) => (
            <tr key={p.movimientoId} className="border-t hover:bg-muted/30">
              <td className="px-3 py-2 whitespace-nowrap">{fmtFecha(p.fecha)}</td>
              <td className="px-3 py-2">
                {p.proveedorId ? (
                  <Link href={`/maestros/proveedores/${p.proveedorId}`} className="hover:underline">
                    {p.proveedorNombre}
                  </Link>
                ) : (
                  <span className="text-muted-foreground italic">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {p.facturas.length === 0 ? (
                  <span className="text-muted-foreground">{p.descripcion ?? "—"}</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {p.facturas.map((f) => (
                      <Badge
                        key={`${f.origen}::${f.id}`}
                        variant={f.origen === "embarque" ? "secondary" : "outline"}
                      >
                        {f.embarqueCodigo ? `${f.embarqueCodigo} · ` : ""}
                        {f.numero}
                      </Badge>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-xs">{p.cuentaBancariaLabel}</td>
              <td className="px-3 py-2 text-xs">{p.metodo}</td>
              <td className="px-3 py-2 text-right text-xs font-mono">{p.moneda}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                {Number(p.tipoCambio).toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtMoney(p.monto)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {fmtMoney(p.montoArs)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                {p.diferenciaCambiaria === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span
                    className={
                      p.diferenciaCambiariaSigno === "gain" ? "text-emerald-700" : "text-amber-700"
                    }
                  >
                    {p.diferenciaCambiariaSigno === "gain" ? "+" : "-"}
                    {fmtMoney(p.diferenciaCambiaria)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-xs">
                {p.asientoNumero ? (
                  <Link
                    href={`/contabilidad/asientos/${p.asientoId}`}
                    className="font-mono text-primary hover:underline"
                  >
                    #{p.asientoNumero}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
