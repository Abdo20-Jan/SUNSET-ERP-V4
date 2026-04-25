"use client";

import { Fragment } from "react";

import type { FlujoDireccion, FlujoSeccionId } from "@/lib/services/reportes";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmtMoney, fmtSigno } from "../_components/money";
import { formatMesLabel } from "./flujo-filters";

export type SerializedCelula = {
  monto: string;
  origen: "REALIZADO" | "PROYECTADO";
};

export type SerializedItem = {
  label: string;
  cuentaCodigos: string[];
  valores: Record<string, SerializedCelula>;
};

export type SerializedSubseccion = {
  label: string;
  items: SerializedItem[];
};

export type SerializedSeccion = {
  id: FlujoSeccionId;
  label: string;
  direccion: FlujoDireccion;
  subsecciones: SerializedSubseccion[];
};

export type SerializedTotales = {
  totalSalidasPorMes: Record<string, string>;
  totalIngresosPorMes: Record<string, string>;
  saldoMensalPorMes: Record<string, string>;
  saldoInicial: string;
  saldoAcumuladoPorMes: Record<string, string>;
};

type Props = {
  meses: string[];
  secciones: SerializedSeccion[];
  totales: SerializedTotales;
};

export function FlujoMatriz({ meses, secciones, totales }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-10 min-w-72 bg-background">
            Concepto
          </TableHead>
          {meses.map((m) => (
            <TableHead key={m} className="min-w-28 text-right">
              {formatMesLabel(m)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {secciones.map((sec) => (
          <SeccionRows key={sec.id} sec={sec} meses={meses} />
        ))}

        {/* Total Salidas */}
        <TotalRow
          label="Total Salidas"
          meses={meses}
          valores={totales.totalSalidasPorMes}
          tone="negative-when-positive"
          className="border-t-2"
        />
        {/* Total Ingresos */}
        <TotalRow
          label="Total Ingresos"
          meses={meses}
          valores={totales.totalIngresosPorMes}
          tone="positive-when-positive"
        />
        {/* Saldo Mensual */}
        <TotalRow
          label="Saldo Mensual"
          meses={meses}
          valores={totales.saldoMensalPorMes}
          tone="signed"
          emphasis
        />
        {/* Saldo Inicial */}
        <TableRow className="border-t bg-muted/30 hover:bg-muted/30">
          <TableCell className="sticky left-0 z-10 bg-muted/30 font-semibold">
            Saldo Inicial (Caja + Bancos)
          </TableCell>
          <TableCell
            colSpan={Math.max(meses.length, 1)}
            className="text-right font-mono text-xs tabular-nums"
          >
            {fmtMoney(totales.saldoInicial)}
          </TableCell>
        </TableRow>
        {/* Saldo Acumulado */}
        <TotalRow
          label="Saldo Acumulado"
          meses={meses}
          valores={totales.saldoAcumuladoPorMes}
          tone="signed"
          emphasis
        />
      </TableBody>
    </Table>
  );
}

function SeccionRows({
  sec,
  meses,
}: {
  sec: SerializedSeccion;
  meses: string[];
}) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell className="sticky left-0 z-10 bg-muted/50 py-2">
          <div className="flex items-center gap-2 font-bold uppercase tracking-wide text-xs">
            {sec.label}
            <Badge
              variant={sec.direccion === "SALIDA" ? "destructive" : "secondary"}
              className="text-[10px]"
            >
              {sec.direccion === "SALIDA" ? "Salida" : "Ingreso"}
            </Badge>
          </div>
        </TableCell>
        {meses.map((m) => (
          <TableCell key={m} className="py-2" />
        ))}
      </TableRow>
      {sec.subsecciones.map((sub) => (
        <Fragment key={`${sec.id}-${sub.label}`}>
          <TableRow className="bg-muted/20">
            <TableCell className="sticky left-0 z-10 bg-muted/20 py-1.5 pl-6 font-semibold text-xs">
              {sub.label}
            </TableCell>
            {meses.map((m) => (
              <TableCell key={m} className="py-1.5" />
            ))}
          </TableRow>
          {sub.items.map((item) => (
            <TableRow key={`${sec.id}-${sub.label}-${item.label}`}>
              <TableCell className="sticky left-0 z-10 bg-background py-1.5 pl-10 text-xs">
                {item.label}
              </TableCell>
              {meses.map((m) => {
                const celula = item.valores[m];
                if (!celula) {
                  return (
                    <TableCell
                      key={m}
                      className="py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground"
                    >
                      {fmtMoney("0.00")}
                    </TableCell>
                  );
                }
                const isProjected = celula.origen === "PROYECTADO";
                const isZero = Number.parseFloat(celula.monto) === 0;
                return (
                  <TableCell
                    key={m}
                    className={cn(
                      "py-1.5 text-right font-mono text-xs tabular-nums",
                      isZero && "text-muted-foreground",
                      isProjected && !isZero && "italic text-sky-700 dark:text-sky-400",
                    )}
                    title={isProjected ? "Proyectado" : "Realizado"}
                  >
                    {fmtMoney(celula.monto)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </Fragment>
      ))}
    </>
  );
}

type TotalRowProps = {
  label: string;
  meses: string[];
  valores: Record<string, string>;
  tone: "signed" | "positive-when-positive" | "negative-when-positive";
  emphasis?: boolean;
  className?: string;
};

function TotalRow({
  label,
  meses,
  valores,
  tone,
  emphasis,
  className,
}: TotalRowProps) {
  return (
    <TableRow
      className={cn(
        "bg-muted/40 hover:bg-muted/40 font-medium",
        emphasis && "font-bold",
        className,
      )}
    >
      <TableCell className={cn("sticky left-0 z-10 bg-muted/40")}>
        {label}
      </TableCell>
      {meses.map((m) => {
        const raw = valores[m] ?? "0.00";
        const signo = fmtSigno(raw);
        let colorClass = "";
        if (tone === "signed") {
          if (signo === "positive")
            colorClass = "text-emerald-700 dark:text-emerald-400";
          else if (signo === "negative") colorClass = "text-destructive";
        } else if (tone === "positive-when-positive") {
          if (signo === "positive")
            colorClass = "text-emerald-700 dark:text-emerald-400";
        } else if (tone === "negative-when-positive") {
          if (signo === "positive") colorClass = "text-destructive";
        }
        return (
          <TableCell
            key={m}
            className={cn(
              "text-right font-mono text-xs tabular-nums",
              colorClass,
            )}
          >
            {fmtMoney(raw)}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
