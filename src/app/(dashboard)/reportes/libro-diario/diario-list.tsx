"use client";

import Link from "next/link";
import { useState } from "react";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import type { AsientoOrigen, Moneda } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { convertirAUsd } from "@/lib/format";

import { fmtMoney } from "../_components/money";

export type SerializedLineaDiario = {
  id: number;
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  descripcion: string | null;
  debe: string;
  haber: string;
};

export type SerializedAsientoDiario = {
  id: string;
  numero: number;
  fecha: string;
  descripcion: string;
  origen: AsientoOrigen;
  moneda: Moneda;
  totalDebe: string;
  totalHaber: string;
  lineas: SerializedLineaDiario[];
};

const ORIGEN_VARIANT: Record<AsientoOrigen, "default" | "secondary" | "outline"> =
  {
    MANUAL: "outline",
    TESORERIA: "secondary",
    COMEX: "default",
    AJUSTE: "outline",
    GASTO: "secondary",
  };

function AsientoCard({
  asiento,
  tcParaUsd,
}: {
  asiento: SerializedAsientoDiario;
  tcParaUsd?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const cuadra = asiento.totalDebe === asiento.totalHaber;
  const fmt = (v: string) => fmtMoney(convertirAUsd(v, tcParaUsd));

  return (
    <Card size="sm" className="py-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="w-16 shrink-0 font-mono text-xs tabular-nums">
          #{asiento.numero}
        </span>
        <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
          {format(new Date(asiento.fecha), "yyyy-MM-dd")}
        </span>
        <Badge variant={ORIGEN_VARIANT[asiento.origen]}>{asiento.origen}</Badge>
        <span className="flex-1 truncate text-sm">{asiento.descripcion}</span>
        <Badge variant="outline" className="font-mono">
          {asiento.moneda}
        </Badge>
        <span
          className={cn(
            "w-28 shrink-0 text-right font-mono text-xs tabular-nums",
            !cuadra && "text-destructive",
          )}
        >
          {fmt(asiento.totalDebe)}
        </span>
        <span
          className={cn(
            "w-28 shrink-0 text-right font-mono text-xs tabular-nums",
            !cuadra && "text-destructive",
          )}
        >
          {fmt(asiento.totalHaber)}
        </span>
      </button>
      {open ? (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Código</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="w-32 text-right">Debe</TableHead>
                <TableHead className="w-32 text-right">Haber</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {asiento.lineas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="py-2 font-mono text-xs">
                    {l.cuentaCodigo}
                  </TableCell>
                  <TableCell className="py-2">{l.cuentaNombre}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {l.descripcion ?? "—"}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                    {fmt(l.debe)}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                    {fmt(l.haber)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs">
            <Link
              href={`/contabilidad/asientos/${asiento.id}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              Ver asiento completo →
            </Link>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function DiarioList({
  asientos,
  tcParaUsd,
}: {
  asientos: SerializedAsientoDiario[];
  tcParaUsd?: string | null;
}) {
  if (asientos.length === 0) {
    return (
      <Card className="py-12">
        <p className="text-center text-sm text-muted-foreground">
          Sin asientos contabilizados en este período.
        </p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {asientos.map((a) => (
        <AsientoCard key={a.id} asiento={a} tcParaUsd={tcParaUsd} />
      ))}
    </div>
  );
}
