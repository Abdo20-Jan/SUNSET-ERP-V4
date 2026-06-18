"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  anularAsiento,
  AsientoError,
  contabilizarAsiento,
  crearAsientoManual,
  crearAsientoMovimientoTesoreria,
} from "@/lib/services/asiento-automatico";
import { getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { ANTICIPO_PROVEEDOR_ROOTS, COMPRA_CODIGOS } from "@/lib/services/cuenta-registry";
import {
  AsientoOrigen,
  CuentaTipo,
  EstadoAnticipo,
  Moneda,
  MovimientoTesoreriaTipo,
  type Prisma,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Error de dominio para abortar la transacción de aplicación/anulación con un
 * mensaje amigable (se traduce a `{ ok: false, error }` en el catch).
 */
class AnticipoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnticipoError";
  }
}

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

export type AplicarAnticipoInput = {
  anticipoId: string;
  compraId?: string | null;
  gastoId?: string | null;
  montoArs: string;
  fecha?: Date | string | null;
};

export type AplicarAnticipoResult =
  | {
      ok: true;
      aplicacionId: number;
      asientoId: string;
      asientoNumero: number;
      saldoPendienteArs: string;
      estado: EstadoAnticipo;
    }
  | { ok: false; error: string };

const aplicarSchema = z
  .object({
    anticipoId: z.string().uuid("Anticipo inválido"),
    compraId: z.string().uuid().optional().nullable(),
    gastoId: z.string().uuid().optional().nullable(),
    montoArs: z.string().regex(MONEY_RE, "Monto inválido (máx. 2 decimales)"),
    fecha: z.coerce.date().optional().nullable(),
  })
  .refine((d) => Boolean(d.compraId) !== Boolean(d.gastoId), {
    message: "Indique exactamente una factura (compra o gasto).",
  });

/**
 * Aplica un AnticipoProveedor VIGENTE contra una factura (Compra o Gasto) del
 * MISMO proveedor (decisión #4, PR #2). Cancela parte del pasivo del proveedor
 * y baja el activo-anticipo: asiento **DEBE pasivo-proveedor (2.1.1.0x) / HABER
 * cuenta-anticipo** (la cuenta del anticipo — 1.1.7.07 bien | 1.1.5.01 servicio
 * — elegida al registrarlo). Incrementa `saldoAplicadoArs`; al consumir todo el
 * saldo el anticipo pasa a APLICADO_TOTAL. Reusa `crearAsientoManual` +
 * `contabilizarAsiento`; no toca caja (la salida ya se registró al crear el
 * anticipo). La cuenta de pasivo es la misma que usa la factura:
 * `proveedor.cuentaContableId ?? PROVEEDOR_FALLBACK`.
 */
export async function aplicarAnticipoProveedorAction(
  raw: AplicarAnticipoInput,
): Promise<AplicarAnticipoResult> {
  await requireSessionUser();

  const parsed = aplicarSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }
  const { anticipoId, compraId, gastoId, montoArs, fecha } = parsed.data;

  if (new Decimal(montoArs).lte(0)) {
    return { ok: false, error: "El monto a aplicar debe ser mayor a cero." };
  }
  const montoAplicar = new Decimal(montoArs).toDecimalPlaces(2);
  const montoStr = montoAplicar.toFixed(2);

  try {
    const result = await db.$transaction(async (tx) => {
      const anticipo = await tx.anticipoProveedor.findUnique({
        where: { id: anticipoId },
        select: {
          id: true,
          numero: true,
          proveedorId: true,
          cuentaContableId: true,
          montoArs: true,
          saldoAplicadoArs: true,
          estado: true,
          fecha: true,
        },
      });
      if (!anticipo) throw new AnticipoError("El anticipo seleccionado no existe.");
      if (anticipo.estado !== EstadoAnticipo.VIGENTE) {
        throw new AnticipoError(
          `El anticipo ${anticipo.numero} no está vigente (estado: ${anticipo.estado}).`,
        );
      }

      const totalAnticipo = new Decimal(anticipo.montoArs);
      const saldoPendiente = totalAnticipo.minus(anticipo.saldoAplicadoArs);
      if (montoAplicar.gt(saldoPendiente)) {
        throw new AnticipoError(
          `El monto excede el saldo pendiente del anticipo (${saldoPendiente.toFixed(2)}).`,
        );
      }

      // Validar la factura: existe, es del MISMO proveedor y está emitida.
      let facturaTotal: Decimal;
      let facturaLabel: string;
      if (compraId) {
        const compra = await tx.compra.findUnique({
          where: { id: compraId },
          select: { id: true, numero: true, proveedorId: true, total: true, estado: true },
        });
        if (!compra) throw new AnticipoError("La compra seleccionada no existe.");
        if (compra.proveedorId !== anticipo.proveedorId) {
          throw new AnticipoError("La compra pertenece a otro proveedor.");
        }
        if (compra.estado === "BORRADOR" || compra.estado === "CANCELADA") {
          throw new AnticipoError(`La compra ${compra.numero} no está emitida.`);
        }
        facturaTotal = new Decimal(compra.total);
        facturaLabel = `compra ${compra.numero}`;
      } else {
        const gasto = await tx.gasto.findUnique({
          where: { id: gastoId as string },
          select: { id: true, numero: true, proveedorId: true, total: true, estado: true },
        });
        if (!gasto) throw new AnticipoError("El gasto seleccionado no existe.");
        if (gasto.proveedorId !== anticipo.proveedorId) {
          throw new AnticipoError("El gasto pertenece a otro proveedor.");
        }
        if (gasto.estado !== "CONTABILIZADO") {
          throw new AnticipoError(`El gasto ${gasto.numero} no está contabilizado.`);
        }
        facturaTotal = new Decimal(gasto.total);
        facturaLabel = `gasto ${gasto.numero}`;
      }
      if (montoAplicar.gt(facturaTotal)) {
        throw new AnticipoError(
          `El monto excede el total de la factura (${facturaTotal.toFixed(2)}).`,
        );
      }

      // Cuenta de pasivo del proveedor — la MISMA que acredita la factura:
      // proveedor.cuentaContableId con fallback al genérico (2.1.1.01.01).
      const proveedor = await tx.proveedor.findUniqueOrThrow({
        where: { id: anticipo.proveedorId },
        select: { cuentaContableId: true },
      });
      const pasivoCuentaId =
        proveedor.cuentaContableId ??
        (await getOrCreateCuenta(tx, COMPRA_CODIGOS.PROVEEDOR_FALLBACK));

      const asiento = await crearAsientoManual(
        {
          fecha: fecha ?? anticipo.fecha,
          descripcion: `Aplicación anticipo ${anticipo.numero} a ${facturaLabel}`,
          origen: AsientoOrigen.AJUSTE,
          moneda: Moneda.ARS,
          lineas: [
            {
              cuentaId: pasivoCuentaId,
              debe: montoStr,
              haber: 0,
              descripcion: `Cancelación parcial ${facturaLabel}`,
            },
            {
              cuentaId: anticipo.cuentaContableId,
              debe: 0,
              haber: montoStr,
              descripcion: `Baja anticipo ${anticipo.numero}`,
            },
          ],
        },
        tx,
      );
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      const nuevoSaldoAplicado = new Decimal(anticipo.saldoAplicadoArs).plus(montoAplicar);
      const nuevoEstado = nuevoSaldoAplicado.gte(totalAnticipo)
        ? EstadoAnticipo.APLICADO_TOTAL
        : EstadoAnticipo.VIGENTE;
      await tx.anticipoProveedor.update({
        where: { id: anticipoId },
        data: { saldoAplicadoArs: nuevoSaldoAplicado.toFixed(2), estado: nuevoEstado },
      });

      const apl = await tx.aplicacionAnticipoProveedor.create({
        data: {
          anticipoId,
          compraId: compraId ?? null,
          gastoId: gastoId ?? null,
          montoArs: montoStr,
          asientoId: contabilizado.id,
        },
        select: { id: true },
      });

      return {
        aplicacionId: apl.id,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
        saldoPendienteArs: totalAnticipo.minus(nuevoSaldoAplicado).toFixed(2),
        estado: nuevoEstado,
      };
    });

    revalidatePath("/tesoreria/anticipos");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AnticipoError || err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("aplicarAnticipoProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al aplicar el anticipo." };
  }
}

export type AnularAnticipoResult =
  | { ok: true; anticipoId: string; asientoAnuladoId: string | null }
  | { ok: false; error: string };

/**
 * Anula un AnticipoProveedor VIGENTE sin aplicaciones (decisión #4, PR #2):
 * revierte el asiento del registro (DEBE anticipo / HABER banco) → como el saldo
 * bancario se deriva del ledger CONTABILIZADO, el banco vuelve a su saldo previo.
 * Rechaza si el anticipo ya tiene aplicaciones (revertirlas primero). El
 * MovimientoTesoreria queda desvinculado del asiento por `anularAsiento` (sin
 * efecto en el saldo, que sale de los asientos).
 */
export async function anularAnticipoProveedorAction(raw: {
  anticipoId: string;
}): Promise<AnularAnticipoResult> {
  await requireSessionUser();

  const parsed = z.string().uuid().safeParse(raw?.anticipoId);
  if (!parsed.success) return { ok: false, error: "Anticipo inválido." };

  try {
    const result = await db.$transaction(async (tx) => {
      const anticipo = await tx.anticipoProveedor.findUnique({
        where: { id: parsed.data },
        select: {
          id: true,
          numero: true,
          estado: true,
          asientoId: true,
          saldoAplicadoArs: true,
          _count: { select: { aplicaciones: true } },
        },
      });
      if (!anticipo) throw new AnticipoError("El anticipo seleccionado no existe.");
      if (anticipo.estado === EstadoAnticipo.ANULADO) {
        throw new AnticipoError(`El anticipo ${anticipo.numero} ya está anulado.`);
      }
      if (anticipo._count.aplicaciones > 0 || new Decimal(anticipo.saldoAplicadoArs).gt(0)) {
        throw new AnticipoError(
          "No se puede anular un anticipo con aplicaciones. Revierta las aplicaciones primero.",
        );
      }

      if (anticipo.asientoId) {
        await anularAsiento(anticipo.asientoId, tx);
      }
      await tx.anticipoProveedor.update({
        where: { id: anticipo.id },
        data: { estado: EstadoAnticipo.ANULADO },
      });

      return { anticipoId: anticipo.id, asientoAnuladoId: anticipo.asientoId };
    });

    revalidatePath("/tesoreria/anticipos");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AnticipoError || err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("anularAnticipoProveedorAction failed", err);
    return { ok: false, error: "Error inesperado al anular el anticipo." };
  }
}
