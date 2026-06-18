"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoMovimientoTesoreria,
} from "@/lib/services/asiento-automatico";
import { ANTICIPO_PROVEEDOR_ROOTS } from "@/lib/services/cuenta-registry";
import {
  CuentaTipo,
  EstadoAnticipo,
  Moneda,
  MovimientoTesoreriaTipo,
  type Prisma,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Una cuenta es de "anticipo a proveedor" si es una de las raíces
 * (1.1.7.07 bienes / 1.1.5.01 servicios) o cuelga de ellas. La clasificación
 * bien/servicio la codifica la propia cuenta (no hay enum tipoAnticipo).
 */
function esCuentaAnticipo(codigo: string): boolean {
  return ANTICIPO_PROVEEDOR_ROOTS.some((raiz) => codigo === raiz || codigo.startsWith(`${raiz}.`));
}

export type CuentaAnticipoOption = {
  id: number;
  codigo: string;
  nombre: string;
  /** Nombre de la cuenta padre (rubro) — agrupa el drilldown en la UI. */
  grupo: string;
};

/**
 * Cuentas seleccionables como destino de un anticipo a proveedor, para el
 * drilldown del formulario (mismo patrón que `listarCategoriasCompra`, E18):
 * cuentas ANALÍTICAS activas bajo el subárbol de anticipo (1.1.7.07 / 1.1.5.01
 * y descendientes). `grupo` = nombre del padre, para agrupar el menú.
 */
export async function listarCuentasAnticipoProveedor(): Promise<CuentaAnticipoOption[]> {
  const todas = await db.cuentaContable.findMany({
    where: { activa: true },
    select: { id: true, codigo: true, nombre: true, padreCodigo: true, tipo: true },
    orderBy: { codigo: "asc" },
  });
  const nombrePorCodigo = new Map(todas.map((c) => [c.codigo, c.nombre]));
  return todas
    .filter((c) => c.tipo === CuentaTipo.ANALITICA && esCuentaAnticipo(c.codigo))
    .map((c) => ({
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      grupo:
        (c.padreCodigo ? nombrePorCodigo.get(c.padreCodigo) : null) ?? "Anticipos a proveedores",
    }));
}

export type RegistrarAnticipoInput = {
  proveedorId: string;
  cuentaContableId: number;
  cuentaBancariaId: string;
  fecha: Date | string;
  monto: string;
  descripcion?: string | null;
};

export type RegistrarAnticipoResult =
  | {
      ok: true;
      anticipoId: string;
      numero: string;
      movimientoId: string;
      asientoId: string;
      asientoNumero: number;
    }
  | { ok: false; error: string };

const registrarSchema = z.object({
  proveedorId: z.string().uuid("Seleccione un proveedor"),
  cuentaContableId: z.number().int().positive("Seleccione la cuenta de anticipo"),
  cuentaBancariaId: z.string().uuid("Seleccione la cuenta bancaria"),
  fecha: z.coerce.date(),
  monto: z.string().regex(MONEY_RE, "Monto inválido (máx. 2 decimales)"),
  descripcion: z
    .string()
    .trim()
    .max(255)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/** Numeración correlativa AP-AAAA-NNNN por año de la fecha del anticipo. */
async function generarNumeroAnticipo(tx: TxClient, fecha: Date): Promise<string> {
  const year = fecha.getUTCFullYear();
  const prefix = `AP-${year}-`;
  const ultimo = await tx.anticipoProveedor.findFirst({
    where: { numero: { startsWith: prefix } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let next = 1;
  if (ultimo) {
    const parsed = Number.parseInt(ultimo.numero.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/**
 * Registra un anticipo (adelanto) a proveedor LOCAL en ARS (decisión #4). El
 * egreso de caja es un MovimientoTesoreria PAGO cuya contrapartida DEBE es la
 * cuenta de anticipo elegida (1.1.7.07 bien / 1.1.5.01 servicio): el asiento
 * queda DEBE anticipo / HABER banco. El AnticipoProveedor nace VIGENTE con
 * saldoAplicadoArs = 0; se consume al aplicarlo contra una factura (PR #2).
 */
export async function registrarAnticipoProveedorAction(
  raw: RegistrarAnticipoInput,
): Promise<RegistrarAnticipoResult> {
  // El AnticipoProveedor.createdById es FK obligatoria: validar que el user del
  // JWT siga existiendo (tras un reseed el id viejo rompe con P2003).
  const userId = await requireSessionUser();

  const parsed = registrarSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }
  const { proveedorId, cuentaContableId, cuentaBancariaId, fecha, monto, descripcion } =
    parsed.data;

  if (new Decimal(monto).lte(0)) {
    return { ok: false, error: "El monto debe ser mayor a cero." };
  }
  const montoStr = new Decimal(monto).toDecimalPlaces(2).toFixed(2);

  const proveedor = await db.proveedor.findUnique({
    where: { id: proveedorId },
    select: { id: true },
  });
  if (!proveedor) return { ok: false, error: "El proveedor seleccionado no existe." };

  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: cuentaBancariaId },
    select: { id: true, moneda: true },
  });
  if (!cuentaBancaria) return { ok: false, error: "La cuenta bancaria seleccionada no existe." };
  if (cuentaBancaria.moneda !== Moneda.ARS) {
    return {
      ok: false,
      error: "Por ahora el anticipo a proveedor local sólo admite cuentas bancarias en ARS.",
    };
  }

  const cuentaAnticipo = await db.cuentaContable.findUnique({
    where: { id: cuentaContableId },
    select: { id: true, codigo: true, tipo: true, activa: true },
  });
  if (!cuentaAnticipo) return { ok: false, error: "La cuenta de anticipo seleccionada no existe." };
  if (!cuentaAnticipo.activa) {
    return { ok: false, error: `La cuenta ${cuentaAnticipo.codigo} está inactiva.` };
  }
  if (cuentaAnticipo.tipo !== CuentaTipo.ANALITICA) {
    return { ok: false, error: `La cuenta ${cuentaAnticipo.codigo} no es ANALITICA.` };
  }
  if (!esCuentaAnticipo(cuentaAnticipo.codigo)) {
    return {
      ok: false,
      error: `La cuenta ${cuentaAnticipo.codigo} no es una cuenta de anticipo a proveedor (debe colgar de ${ANTICIPO_PROVEEDOR_ROOTS.join(" o ")}).`,
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // El egreso de caja: PAGO con contrapartida = cuenta de anticipo. El
      // asiento (DEBE anticipo / HABER banco) lo arma crearAsientoMovimientoTesoreria.
      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo: MovimientoTesoreriaTipo.PAGO,
          cuentaBancariaId,
          fecha,
          monto: montoStr,
          moneda: Moneda.ARS,
          tipoCambio: "1",
          cuentaContableId,
          descripcion: descripcion ?? "Anticipo a proveedor",
        },
        select: { id: true },
      });

      const asiento = await crearAsientoMovimientoTesoreria(mov.id, tx);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      const numero = await generarNumeroAnticipo(tx, fecha);
      const anticipo = await tx.anticipoProveedor.create({
        data: {
          numero,
          proveedorId,
          cuentaContableId,
          cuentaBancariaId,
          fecha,
          moneda: Moneda.ARS,
          tipoCambio: "1",
          montoArs: montoStr,
          saldoAplicadoArs: "0",
          estado: EstadoAnticipo.VIGENTE,
          descripcion,
          movimientoTesoreriaId: mov.id,
          asientoId: contabilizado.id,
          createdById: userId,
        },
        select: { id: true, numero: true },
      });

      return {
        anticipoId: anticipo.id,
        numero: anticipo.numero,
        movimientoId: mov.id,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
      };
    });

    revalidatePath("/tesoreria/anticipos");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("registrarAnticipoProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al registrar el anticipo." };
  }
}
