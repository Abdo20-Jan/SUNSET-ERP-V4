import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, FileImportIcon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ImportacionExtractoStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_VARIANT: Record<
  ImportacionExtractoStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDIENTE: "outline",
  PARCIAL: "secondary",
  COMPLETADO: "default",
  CANCELADO: "destructive",
};

const STATUS_LABEL: Record<ImportacionExtractoStatus, string> = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Parcial",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export default async function ExtractosPage() {
  const importaciones = await db.importacionExtracto.findMany({
    orderBy: [{ periodoYear: "desc" }, { periodoMonth: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      periodoYear: true,
      periodoMonth: true,
      saldoInicial: true,
      saldoFinal: true,
      status: true,
      totalLineas: true,
      lineasAprobadas: true,
      archivoNombre: true,
      createdAt: true,
      cuentaBancaria: { select: { banco: true, moneda: true, numero: true } },
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Extractos bancarios
          </h1>
          <p className="text-sm text-muted-foreground">
            Importá un PDF de extracto, revisá las sugerencias del sistema y
            aprobalas para generar movimientos contables.
          </p>
        </div>
        <Link
          href="/tesoreria/extractos/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Importar PDF
        </Link>
      </div>

      {importaciones.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Sin importaciones aún</p>
              <p className="text-xs text-muted-foreground">
                Subí el primer PDF para que el sistema sugiera los asientos.
              </p>
            </div>
            <Link
              href="/tesoreria/extractos/nuevo"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Importar PDF
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Saldo inicial</TableHead>
                <TableHead className="text-right">Saldo final</TableHead>
                <TableHead className="text-right">Líneas</TableHead>
                <TableHead>Importado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importaciones.map((imp) => {
                const periodo = `${String(imp.periodoMonth).padStart(2, "0")}/${imp.periodoYear}`;
                return (
                  <TableRow key={imp.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        href={`/tesoreria/extractos/${imp.id}`}
                        className="block w-full"
                      >
                        {periodo}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/tesoreria/extractos/${imp.id}`}
                        className="block w-full"
                      >
                        {imp.cuentaBancaria.banco}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({imp.cuentaBancaria.moneda}
                          {imp.cuentaBancaria.numero ? ` · ${imp.cuentaBancaria.numero}` : ""})
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[imp.status]}>
                        {STATUS_LABEL[imp.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(imp.saldoInicial.toString())}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(imp.saldoFinal.toString())}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {imp.lineasAprobadas} / {imp.totalLineas}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(imp.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
