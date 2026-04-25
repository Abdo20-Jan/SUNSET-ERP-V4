"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { calcularSaldosCuentasBancarias } from "@/lib/services/cuenta-bancaria";
import {
  CuentaCategoria,
  CuentaTipo,
  Moneda,
  Prisma,
  TipoCuentaBancaria,
} from "@/generated/prisma/client";

export type CuentaBancariaRow = {
  id: string;
  banco: string;
  tipo: TipoCuentaBancaria;
  moneda: Moneda;
  numero: string;
  cbu: string | null;
  alias: string | null;
  cuentaContableCodigo: string;
  cuentaContableNombre: string;
  saldo: string;
};

export type CuentaContableOption = {
  id: number;
  codigo: string;
  nombre: string;
};

export async function listarCuentasBancariasConSaldo(): Promise<
  CuentaBancariaRow[]
> {
  const cuentas = await db.cuentaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    select: {
      id: true,
      banco: true,
      tipo: true,
      moneda: true,
      numero: true,
      cbu: true,
      alias: true,
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
    },
  });

  const saldos = await calcularSaldosCuentasBancarias(
    cuentas.map((c) => c.cuentaContable.id),
  );

  return cuentas.map((c) => ({
    id: c.id,
    banco: c.banco,
    tipo: c.tipo,
    moneda: c.moneda,
    numero: c.numero,
    cbu: c.cbu,
    alias: c.alias,
    cuentaContableCodigo: c.cuentaContable.codigo,
    cuentaContableNombre: c.cuentaContable.nombre,
    saldo: (saldos.get(c.cuentaContable.id) ?? new Prisma.Decimal(0)).toFixed(
      2,
    ),
  }));
}

export async function listarCuentasContablesDisponibles(): Promise<
  CuentaContableOption[]
> {
  const [cuentas, usadas] = await Promise.all([
    db.cuentaContable.findMany({
      where: {
        tipo: CuentaTipo.ANALITICA,
        categoria: CuentaCategoria.ACTIVO,
        activa: true,
      },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
    db.cuentaBancaria.findMany({ select: { cuentaContableId: true } }),
  ]);

  const usadasIds = new Set(usadas.map((u) => u.cuentaContableId));
  return cuentas
    .filter((c) => !usadasIds.has(c.id))
    .map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));
}

const crearInputSchema = z.object({
  banco: z.string().min(1, "El banco es obligatorio"),
  tipo: z.nativeEnum(TipoCuentaBancaria),
  moneda: z.nativeEnum(Moneda),
  numero: z.string().min(1, "El número es obligatorio"),
  cbu: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  alias: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  cuentaContableId: z.number().int().positive(),
});

export type CrearCuentaBancariaInput = z.input<typeof crearInputSchema>;

export type CrearCuentaBancariaResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function crearCuentaBancariaAction(
  raw: CrearCuentaBancariaInput,
): Promise<CrearCuentaBancariaResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = crearInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? "Datos inválidos.",
    };
  }

  const cuenta = await db.cuentaContable.findUnique({
    where: { id: parsed.data.cuentaContableId },
    select: { id: true, tipo: true, categoria: true, activa: true, codigo: true },
  });

  if (!cuenta) {
    return { ok: false, error: "La cuenta contable seleccionada no existe." };
  }
  if (!cuenta.activa) {
    return { ok: false, error: `La cuenta ${cuenta.codigo} está inactiva.` };
  }
  if (cuenta.tipo !== CuentaTipo.ANALITICA) {
    return {
      ok: false,
      error: "La cuenta contable debe ser ANALITICA (no sintética).",
    };
  }
  if (cuenta.categoria !== CuentaCategoria.ACTIVO) {
    return {
      ok: false,
      error: "La cuenta contable debe ser de categoría ACTIVO.",
    };
  }

  const yaUsada = await db.cuentaBancaria.findFirst({
    where: { cuentaContableId: parsed.data.cuentaContableId },
    select: { id: true },
  });
  if (yaUsada) {
    return {
      ok: false,
      error: "Esa cuenta contable ya está vinculada a otra cuenta bancaria.",
    };
  }

  try {
    const created = await db.cuentaBancaria.create({
      data: {
        banco: parsed.data.banco,
        tipo: parsed.data.tipo,
        moneda: parsed.data.moneda,
        numero: parsed.data.numero,
        cbu: parsed.data.cbu,
        alias: parsed.data.alias,
        cuentaContableId: parsed.data.cuentaContableId,
      },
      select: { id: true },
    });
    revalidatePath("/tesoreria/cuentas");
    return { ok: true, id: created.id };
  } catch (err) {
    console.error("crearCuentaBancariaAction failed", err);
    return { ok: false, error: "Error inesperado al crear la cuenta bancaria." };
  }
}
