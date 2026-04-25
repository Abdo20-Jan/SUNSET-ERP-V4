import Link from "next/link";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { UltimoAsiento } from "@/lib/services/dashboard";

export function UltimosAsientosCard({
  asientos,
}: {
  asientos: UltimoAsiento[];
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Últimos Asientos</CardTitle>
        <CardDescription>
          10 últimos asientos contabilizados.
        </CardDescription>
        <CardAction>
          <Link
            href="/contabilidad/asientos"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Ver libro diario →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {asientos.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No hay asientos contabilizados.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Fecha</TableHead>
                <TableHead>N°</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="pr-6 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {asientos.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-6 text-muted-foreground">
                    {fmtDate(a.fecha)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/contabilidad/asientos/${a.id}`}
                      className="font-medium tabular-nums underline-offset-2 hover:underline"
                    >
                      #{a.numero}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate" title={a.descripcion}>
                    {a.descripcion}
                  </TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">
                    {fmtMoney(a.total.toString())}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
