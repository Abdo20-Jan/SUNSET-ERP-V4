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
import { fmtMoney } from "@/lib/format";
import type { SaldoBancario } from "@/lib/services/dashboard";

export function SaldosBancosCard({ saldos }: { saldos: SaldoBancario[] }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Saldos por Banco / Caja</CardTitle>
        <CardDescription>
          Saldo contable de cada cuenta analítica de Caja y Bancos.
        </CardDescription>
        <CardAction>
          <Link
            href="/tesoreria"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Ver tesorería →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {saldos.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No hay cuentas de Caja o Bancos registradas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Cuenta</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="pr-6 text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {saldos.map((s) => (
                <TableRow key={s.cuentaId}>
                  <TableCell className="pl-6">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {s.banco ?? s.nombre}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.codigo}
                        {s.banco ? ` · ${s.nombre}` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.moneda}</Badge>
                  </TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">
                    {fmtMoney(s.saldo.toString())}
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
