import Link from "next/link";

import { fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RetencionPracticadaRow } from "@/lib/actions/retenciones";

const CONCEPTO_LABEL: Record<string, string> = {
  BIENES_DE_CAMBIO: "Bienes de cambio",
  HONORARIOS: "Honorarios",
  ALQUILERES: "Alquileres",
  SERVICIOS_GENERALES: "Servicios generales",
  LOCACIONES_SERVICIOS: "Locaciones / servicios",
};

/**
 * Alerta de retenciones de Ganancias practicadas que todavía no se
 * depositaron en ARCA (estado PENDIENTE_ARCA). Cada una vence ~15 días
 * después de la fecha de retención (RG 830). Resalta las vencidas / que
 * vencen pronto para recordar emitir el VEP. No descuenta nada: es un
 * recordatorio. `hoy` llega como YYYY-MM-DD (UTC) desde el server.
 */
export function RetencionesPorDepositar({
  rows,
  hoy,
}: {
  rows: RetencionPracticadaRow[];
  hoy: string;
}) {
  if (rows.length === 0) return null;

  const ordered = [...rows].sort((a, b) =>
    a.fechaVencimientoArca.localeCompare(b.fechaVencimientoArca),
  );
  const total = rows.reduce((s, r) => s + Number(r.importeRetenido), 0);
  const vencidas = rows.filter((r) => r.fechaVencimientoArca <= hoy);
  const hayVencidas = vencidas.length > 0;

  const enMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
  const diasRestantes = (venc: string) => Math.round((enMs(venc) - enMs(hoy)) / 86_400_000);

  return (
    <Card
      className={
        hayVencidas
          ? "border-rose-300 dark:border-rose-800"
          : "border-amber-300 dark:border-amber-800"
      }
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">Retenciones de Ganancias por depositar (VEP)</h2>
            <p className="text-xs text-muted-foreground">
              Practicadas y pendientes de depósito en ARCA (cta. 2.1.3.07).
              {hayVencidas
                ? ` ⚠️ ${vencidas.length} vencida${vencidas.length === 1 ? "" : "s"} — generá el VEP.`
                : " Depositá cada una antes de su vencimiento (RG 830)."}
            </p>
          </div>
          <span className="font-mono text-base font-semibold tabular-nums">
            ARS {fmtMoney(total.toFixed(2))}
          </span>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certificado</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Retención</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Vence (depósito ARCA)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((r) => {
                const dias = diasRestantes(r.fechaVencimientoArca);
                const vencida = r.fechaVencimientoArca <= hoy;
                const proxima = !vencida && dias <= 3;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/api/retenciones/${r.id}/certificado`}
                        className="underline underline-offset-2"
                        target="_blank"
                      >
                        {r.certificadoNumero}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.proveedorNombre}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {CONCEPTO_LABEL[r.concepto] ?? r.concepto}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.fechaRetencion}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtMoney(r.importeRetenido)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-mono">{r.fechaVencimientoArca}</span>{" "}
                      {vencida ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {dias === 0 ? "vence hoy" : `${Math.abs(dias)}d vencida`}
                        </Badge>
                      ) : proxima ? (
                        <Badge variant="outline" className="text-[10px] text-amber-700">
                          en {dias}d
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">en {dias}d</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
