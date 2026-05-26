import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProveedorExteriorSaldo } from "@/lib/services/cuentas-a-pagar";

function fmtUsd(s: string | number) {
  const n = typeof s === "string" ? Number(s) : s;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ProveedoresExteriorSection({
  proveedores,
}: {
  proveedores: ProveedorExteriorSaldo[];
}) {
  if (proveedores.length === 0) return null;

  const totalUsd = proveedores.reduce((acc, p) => acc + Number(p.saldoUsd), 0);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">Proveedores exterior (USD)</h2>
            <p className="text-xs text-muted-foreground">
              Deuda en USD con proveedores del exterior (MERCADERIA_EXTERIOR / SERVICIOS_EXTERIOR).
              El pago se registra desde{" "}
              <Link href="/comex/proveedores" className="underline underline-offset-2">
                Comex → Proveedores exterior
              </Link>{" "}
              con TC bancario y diferencia de cambio.
            </p>
          </div>
          <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums">
            USD {fmtUsd(totalUsd)}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead className="w-16">País</TableHead>
              <TableHead className="w-32 text-right">Embarques</TableHead>
              <TableHead className="text-right">Saldo USD</TableHead>
              <TableHead className="w-28 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proveedores.map((p) => {
              const cantEmbarques = p.embarques.length + (p.facturasSueltas.length > 0 ? 1 : 0);
              return (
                <TableRow key={p.proveedorId}>
                  <TableCell className="font-medium">{p.proveedorNombre}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.pais}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {cantEmbarques}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {fmtUsd(p.saldoUsd)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href="/comex/proveedores"
                      className="inline-flex h-8 items-center rounded-full border border-input bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      Ver y pagar
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
