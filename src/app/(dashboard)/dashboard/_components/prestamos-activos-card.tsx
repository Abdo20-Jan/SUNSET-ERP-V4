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
import { Badge } from "@/components/ui/badge";
import { fmtMoney, fmtTipoCambio } from "@/lib/format";
import type { PrestamoActivo } from "@/lib/services/dashboard";

export function PrestamosActivosCard({
  prestamos,
}: {
  prestamos: PrestamoActivo[];
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Préstamos Vigentes</CardTitle>
        <CardDescription>
          Préstamos contabilizados con saldo deudor pendiente.
        </CardDescription>
        <CardAction>
          <Link
            href="/tesoreria/prestamos"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Ver todos →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {prestamos.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No hay préstamos vigentes.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Prestamista</TableHead>
                <TableHead>Mon.</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">TC</TableHead>
                <TableHead className="pr-6 text-right">Equiv. ARS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prestamos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-6 font-medium">
                    {p.prestamista}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.moneda}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(p.principal.toString())}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtTipoCambio(p.tipoCambio.toString())}
                  </TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">
                    {fmtMoney(p.equivalenteARS.toString())}
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
