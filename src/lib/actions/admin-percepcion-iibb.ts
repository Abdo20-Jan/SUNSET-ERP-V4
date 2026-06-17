"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { anularVentaAction } from "@/lib/actions/ventas";
import { AuditAccion, Prisma, VentaEstado } from "@/generated/prisma/client";

// Listar vendas EMITIDAS candidatas a anulación + recálculo de
// Percepción IIBB. Retorna info suficiente para mostrar al usuario el
// impacto antes de confirmar la operación masiva.
export type VentaParaRecalculoRow = {
  id: string;
  numero: string;
  fecha: string;
  clienteNombre: string;
  total: string;
  chequesActivos: number;
  asientoId: string | null;
};

export async function listarVentasParaRecalculo(): Promise<VentaParaRecalculoRow[]> {
  const rows = await db.venta.findMany({
    where: { estado: VentaEstado.EMITIDA },
    orderBy: { fecha: "desc" },
    select: {
      id: true,
      numero: true,
      fecha: true,
      total: true,
      asientoId: true,
      cliente: { select: { nombre: true } },
      chequesRecibidos: {
        where: { estado: { not: "ANULADO" } },
        select: { id: true },
      },
    },
  });
  return rows.map((v) => ({
    id: v.id,
    numero: v.numero,
    fecha: v.fecha.toISOString().slice(0, 10),
    clienteNombre: v.cliente.nombre,
    total: v.total.toString(),
    chequesActivos: v.chequesRecibidos.length,
    asientoId: v.asientoId,
  }));
}

const anularSchema = z.object({
  razon: z.string().trim().min(10, "La razón debe tener al menos 10 caracteres."),
  confirmacion: z
    .literal("ANULAR")
    .or(z.string())
    .refine((v) => v === "ANULAR", "Tipea ANULAR para confirmar."),
});

export type AnularMasivoResult =
  | {
      ok: true;
      anuladas: number;
      fallidas: { id: string; numero: string; error: string }[];
    }
  | { ok: false; error: string };

// Anula TODAS las vendas EMITIDAS para permitir recálculo de
// Percepción IIBB. Reusa anularVentaAction (corregida en PR5 para
// tratar ChequeRecibido). Procesa una a una para que un fallo no
// rolleve todo el batch — al final reporta cuántas tuvieron éxito y
// cuáles fallaron. Cada anulación es transaccionalmente atómica.
//
// Por seguridad: el usuario debe tipar "ANULAR" + dar una razón ≥10
// caracteres. Audit log registra la operación masiva con la razón.
export async function anularVentasMasivoAction(
  input: z.infer<typeof anularSchema>,
): Promise<AnularMasivoResult> {
  // Recálculo masivo de Percepción IIBB: operación administrativa bajo /admin.
  // requireAdmin revalida el rol contra la DB y, de paso, confirma que el user
  // del JWT siga existiendo (AuditLog.usuarioId es FK obligatoria → evita P2003
  // tras un reseed) antes de cualquier escritura.
  const guard = await requireAdmin();
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }
  const userId = guard.userId;

  const parsed = anularSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  const ventas = await db.venta.findMany({
    where: { estado: VentaEstado.EMITIDA },
    select: { id: true, numero: true },
  });

  // Audit log: 1 entry per la operación masiva (no per venta — eso
  // sería ruidoso). Registra cuántas vendas estaban en cola.
  await db.auditLog.create({
    data: {
      tabla: "Venta",
      registroId: "*",
      accion: AuditAccion.UPDATE,
      datosAnteriores: {
        estado: "EMITIDA",
        count: ventas.length,
      } as Prisma.InputJsonValue,
      datosNuevos: {
        estado: "CANCELADA",
        razon: parsed.data.razon,
        operacion: "anularVentasMasivoAction (recálculo Percepción IIBB)",
      } as Prisma.InputJsonValue,
      usuarioId: userId,
    },
  });

  const fallidas: { id: string; numero: string; error: string }[] = [];
  let anuladas = 0;
  for (const v of ventas) {
    const r = await anularVentaAction(v.id);
    if (r.ok) {
      anuladas++;
    } else {
      fallidas.push({ id: v.id, numero: v.numero, error: r.error });
    }
  }

  revalidatePath("/admin/recalcular-percepcion-iibb");
  revalidatePath("/ventas");
  return { ok: true, anuladas, fallidas };
}
