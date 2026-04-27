import Link from "next/link";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  CuentaTipo,
  ImportacionExtractoStatus,
  LineaExtractoStatus,
} from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { LineasReview, type LineaRow, type CuentaOption, type ProveedorOption, type ClienteOption } from "./lineas-review";

const STATUS_LABEL: Record<ImportacionExtractoStatus, string> = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Parcial",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export default async function ExtractoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const imp = await db.importacionExtracto.findUnique({
    where: { id },
    include: {
      cuentaBancaria: {
        select: { banco: true, moneda: true, numero: true, cuentaContableId: true },
      },
      lineas: {
        orderBy: { ordenLinea: "asc" },
        include: {
          cuentaSugerida: { select: { id: true, codigo: true, nombre: true } },
          proveedor: { select: { id: true, nombre: true, cuit: true } },
          cliente: { select: { id: true, nombre: true, cuit: true } },
        },
      },
    },
  });

  if (!imp) notFound();

  const [cuentas, proveedores, clientes] = await Promise.all([
    db.cuentaContable.findMany({
      where: { tipo: CuentaTipo.ANALITICA, activa: true },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
    db.proveedor.findMany({
      where: { estado: "activo" },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, cuit: true, cuentaContableId: true },
    }),
    db.cliente.findMany({
      where: { estado: "activo" },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, cuit: true, cuentaContableId: true },
    }),
  ]);

  const cuentasFiltradas: CuentaOption[] = cuentas
    .filter((c) => c.id !== imp.cuentaBancaria.cuentaContableId)
    .map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));

  const proveedoresOpts: ProveedorOption[] = proveedores.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    cuit: p.cuit,
    cuentaContableId: p.cuentaContableId,
  }));

  const clientesOpts: ClienteOption[] = clientes.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    cuit: c.cuit,
    cuentaContableId: c.cuentaContableId,
  }));

  const lineasRows: LineaRow[] = imp.lineas.map((l) => ({
    id: l.id,
    ordenLinea: l.ordenLinea,
    fecha: l.fecha.toISOString(),
    descripcion: l.descripcion,
    comprobante: l.comprobante,
    referenciaBanco: l.referenciaBanco,
    monto: l.monto.toString(),
    saldoExtracto: l.saldoExtracto?.toString() ?? null,
    cuentaSugeridaId: l.cuentaSugeridaId,
    cuentaSugeridaCodigo: l.cuentaSugerida?.codigo ?? null,
    cuentaSugeridaNombre: l.cuentaSugerida?.nombre ?? null,
    proveedorSugeridoId: l.proveedorSugeridoId,
    proveedorNombre: l.proveedor?.nombre ?? null,
    clienteSugeridoId: l.clienteSugeridoId,
    clienteNombre: l.cliente?.nombre ?? null,
    descripcionAsiento: l.descripcionAsiento,
    confianza: (l.confianza as "ALTA" | "MEDIA" | "BAJA" | null) ?? null,
    razonSugerencia: l.razonSugerencia,
    notas: l.notas,
    status: l.status,
  }));

  const periodo = `${String(imp.periodoMonth).padStart(2, "0")}/${imp.periodoYear}`;
  const totalDebitos = imp.lineas
    .filter((l) => Number(l.monto) < 0)
    .reduce((acc, l) => acc + Number(l.monto), 0);
  const totalCreditos = imp.lineas
    .filter((l) => Number(l.monto) > 0)
    .reduce((acc, l) => acc + Number(l.monto), 0);

  const counts = {
    pendientes: imp.lineas.filter((l) => l.status === LineaExtractoStatus.PENDIENTE).length,
    aprobadas: imp.lineas.filter((l) => l.status === LineaExtractoStatus.APROBADA).length,
    rechazadas: imp.lineas.filter((l) => l.status === LineaExtractoStatus.RECHAZADA).length,
    ignoradas: imp.lineas.filter((l) => l.status === LineaExtractoStatus.IGNORADA).length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/tesoreria/extractos"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
          Volver a extractos
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {imp.cuentaBancaria.banco} · {periodo}
            </h1>
            <p className="text-sm text-muted-foreground">
              {imp.cuentaBancaria.moneda}
              {imp.cuentaBancaria.numero ? ` · cuenta ${imp.cuentaBancaria.numero}` : ""} ·{" "}
              importado {fmtDate(imp.createdAt)} ·{" "}
              {imp.archivoNombre ?? "(sin nombre)"}
            </p>
          </div>
          <Badge variant="outline">{STATUS_LABEL[imp.status]}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Saldo inicial
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold tabular-nums">
              {fmtMoney(imp.saldoInicial.toString())}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Saldo final
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold tabular-nums">
              {fmtMoney(imp.saldoFinal.toString())}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total créditos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold tabular-nums text-green-700 dark:text-green-400">
              {fmtMoney(totalCreditos.toFixed(2))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total débitos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold tabular-nums text-red-700 dark:text-red-400">
              {fmtMoney(totalDebitos.toFixed(2))}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-md border px-2 py-1">
          Pendientes: <strong>{counts.pendientes}</strong>
        </span>
        <span className="rounded-md border px-2 py-1">
          Aprobadas: <strong>{counts.aprobadas}</strong>
        </span>
        <span className="rounded-md border px-2 py-1">
          Rechazadas: <strong>{counts.rechazadas}</strong>
        </span>
        <span className="rounded-md border px-2 py-1">
          Ignoradas: <strong>{counts.ignoradas}</strong>
        </span>
      </div>

      <LineasReview
        importacionId={imp.id}
        lineas={lineasRows}
        cuentas={cuentasFiltradas}
        proveedores={proveedoresOpts}
        clientes={clientesOpts}
      />
    </div>
  );
}
