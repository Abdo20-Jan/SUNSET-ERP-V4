"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { isRetencionGananciasEnabled } from "@/lib/features";
import { DIAS_VENCIMIENTO_RETENCION_ARCA } from "@/lib/services/cuenta-registry";
import { resolverRetencionGananciasParaPago } from "@/lib/services/retencion-ganancias-pago";
import { Moneda, MovimientoTesoreriaTipo, Prisma, Role } from "@/generated/prisma/client";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

function addDays(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 86_400_000);
}

// ============================================================
// Simular retención antes de confirmar el pago (preview UI)
// ============================================================

export type SimulacionRetencion =
  | { aplica: false }
  | {
      aplica: true;
      base: string;
      importeRetenido: string;
      importeNetoAPagar: string;
      alicuota: string;
      minimoNoSujeto: string;
      baseAcumuladaMesPrevio: string;
      fechaVencimientoArca: string;
      detalleCalculo: string;
    };

const simularSchema = z.object({
  cuentaContableId: z.number().int().positive(),
  fecha: z.coerce.date(),
  base: z.string().regex(MONEY_RE, "Base inválida"),
});

export type SimularRetencionInput = z.input<typeof simularSchema>;

/**
 * Calcula (sin persistir) la retención de Ganancias que se aplicaría al
 * pagar `base` a la cuenta de proveedor indicada, en la `fecha` dada.
 * Devuelve `{ aplica: false }` si la flag está apagada o no corresponde
 * retención. Pensado para mostrar el preview en el diálogo de pago.
 */
export async function simularRetencionGananciasAction(
  raw: SimularRetencionInput,
): Promise<SimulacionRetencion> {
  const session = await auth();
  if (!session) return { aplica: false };
  if (!isRetencionGananciasEnabled()) return { aplica: false };

  const parsed = simularSchema.safeParse(raw);
  if (!parsed.success) return { aplica: false };

  const ctx = await resolverRetencionGananciasParaPago({
    tipo: MovimientoTesoreriaTipo.PAGO,
    moneda: Moneda.ARS,
    fecha: parsed.data.fecha,
    lineas: [{ cuentaContableId: parsed.data.cuentaContableId }],
    base: new Decimal(parsed.data.base),
  });
  if (!ctx) return { aplica: false };

  const r = ctx.resultado;
  return {
    aplica: true,
    base: r.base.toFixed(2),
    importeRetenido: r.importeRetenido.toFixed(2),
    importeNetoAPagar: r.importeNetoAPagar.toFixed(2),
    alicuota: r.alicuota.toString(),
    minimoNoSujeto: r.minimoNoSujeto.toFixed(2),
    baseAcumuladaMesPrevio: r.baseAcumuladaMesPrevio.toFixed(2),
    fechaVencimientoArca: addDays(parsed.data.fecha, DIAS_VENCIMIENTO_RETENCION_ARCA)
      .toISOString()
      .slice(0, 10),
    detalleCalculo: r.detalleCalculo,
  };
}

// ============================================================
// Listar retenciones practicadas (base del reporte / SICORE)
// ============================================================

export type RetencionPracticadaRow = {
  id: string;
  certificadoNumero: string;
  fechaRetencion: string;
  fechaVencimientoArca: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorCuit: string | null;
  concepto: string;
  base: string;
  alicuota: string;
  importeRetenido: string;
  estado: string;
  movimientoTesoreriaId: string;
};

const listarSchema = z.object({
  estado: z.enum(["PENDIENTE_ARCA", "PAGADA_ARCA", "ANULADA"]).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export async function listarRetencionesPracticadas(
  raw: z.input<typeof listarSchema> = {},
): Promise<RetencionPracticadaRow[]> {
  const session = await auth();
  if (!session) return [];
  const parsed = listarSchema.safeParse(raw);
  if (!parsed.success) return [];

  const where: Prisma.RetencionPracticadaWhereInput = { tipo: "GANANCIAS" };
  if (parsed.data.estado) where.estado = parsed.data.estado;
  if (parsed.data.desde || parsed.data.hasta) {
    where.fechaRetencion = {};
    if (parsed.data.desde) where.fechaRetencion.gte = parsed.data.desde;
    if (parsed.data.hasta) where.fechaRetencion.lte = parsed.data.hasta;
  }

  const rows = await db.retencionPracticada.findMany({
    where,
    orderBy: { fechaRetencion: "desc" },
    select: {
      id: true,
      certificadoNumero: true,
      fechaRetencion: true,
      fechaVencimientoArca: true,
      proveedorId: true,
      concepto: true,
      base: true,
      alicuota: true,
      importeRetenido: true,
      estado: true,
      movimientoTesoreriaId: true,
      proveedor: { select: { nombre: true, cuit: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    certificadoNumero: r.certificadoNumero,
    fechaRetencion: r.fechaRetencion.toISOString().slice(0, 10),
    fechaVencimientoArca: r.fechaVencimientoArca.toISOString().slice(0, 10),
    proveedorId: r.proveedorId,
    proveedorNombre: r.proveedor.nombre,
    proveedorCuit: r.proveedor.cuit,
    concepto: r.concepto,
    base: r.base.toString(),
    alicuota: r.alicuota.toString(),
    importeRetenido: r.importeRetenido.toString(),
    estado: r.estado,
    movimientoTesoreriaId: r.movimientoTesoreriaId,
  }));
}

// ============================================================
// Anular retención (sólo ADMIN) — corrección fiscal
// ============================================================

export type AnularRetencionResult = { ok: true } | { ok: false; error: string };

const anularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(3, "El motivo es obligatorio (mín. 3 caracteres)."),
});

/**
 * Marca una retención como ANULADA (corrección fiscal: no se reportará ni
 * depositará en ARCA). Sólo ADMIN. NOTA: no revierte el asiento contable —
 * si el pago en sí fue incorrecto, anulá el asiento del pago por el flujo
 * estándar (al pasar a ANULADO, la línea 2.1.3.07 deja de computar en el
 * saldo). El wiring automático pago↔retención queda como fast-follow.
 */
export async function anularRetencionGananciasAction(
  raw: z.input<typeof anularSchema>,
): Promise<AnularRetencionResult> {
  // Garantiza que el user del JWT siga existiendo y activo (redirige a /login
  // si no): el AuditLog.usuarioId es FK obligatoria y tras un reseed rompería
  // con P2003. Anular una retención es una mutación fiscal sensible, así que
  // además revalida el rol contra la DB (la estrategia jwt no refresca el rol).
  const userId = await requireSessionUser();
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (actor?.role !== Role.ADMIN) {
    return { ok: false, error: "Sólo un administrador puede anular retenciones." };
  }

  const parsed = anularSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    await db.$transaction(async (tx) => {
      const ret = await tx.retencionPracticada.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, estado: true },
      });
      if (!ret) throw new Error("NO_EXISTE");
      if (ret.estado === "ANULADA") throw new Error("YA_ANULADA");
      if (ret.estado === "PAGADA_ARCA") throw new Error("YA_PAGADA");

      await tx.retencionPracticada.update({
        where: { id: parsed.data.id },
        data: { estado: "ANULADA", motivoAnulacion: parsed.data.motivo },
      });
      await tx.auditLog.create({
        data: {
          tabla: "RetencionPracticada",
          registroId: parsed.data.id,
          accion: "UPDATE",
          datosAnteriores: { estado: ret.estado },
          datosNuevos: { estado: "ANULADA", motivo: parsed.data.motivo },
          usuarioId: userId,
        },
      });
    });

    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/tesoreria/retenciones");
    return { ok: true };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NO_EXISTE") return { ok: false, error: "La retención no existe." };
      if (err.message === "YA_ANULADA")
        return { ok: false, error: "La retención ya está anulada." };
      if (err.message === "YA_PAGADA") {
        return { ok: false, error: "No se puede anular una retención ya depositada en ARCA." };
      }
    }
    console.error("anularRetencionGananciasAction failed", err);
    return { ok: false, error: "Error inesperado al anular la retención." };
  }
}
