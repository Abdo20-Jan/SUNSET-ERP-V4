"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoManual,
} from "@/lib/services/asiento-automatico";
import { getVepEmbarques } from "@/lib/services/cuentas-a-pagar";
import {
  AsientoOrigen,
  Moneda,
} from "@/generated/prisma/client";

const inputSchema = z.object({
  embarqueId: z.string().uuid(),
  cuentaBancariaId: z.string().uuid(),
  fecha: z.coerce.date(),
  comprobante: z.string().trim().max(100).optional(),
});

export type PagarVepInput = z.input<typeof inputSchema>;

export type PagarVepResult =
  | { ok: true; asientoId: string; asientoNumero: number; total: string }
  | { ok: false; error: string };

export async function pagarVepEmbarqueAction(
  raw: PagarVepInput,
): Promise<PagarVepResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const { embarqueId, cuentaBancariaId, fecha, comprobante } = parsed.data;

  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: cuentaBancariaId },
    select: { id: true, banco: true, moneda: true, cuentaContableId: true },
  });
  if (!cuentaBancaria) {
    return { ok: false, error: "Cuenta bancaria no existe." };
  }
  if (cuentaBancaria.moneda !== Moneda.ARS) {
    return {
      ok: false,
      error: "El VEP de despacho aduanero se paga en ARS — seleccione una cuenta en pesos.",
    };
  }

  // Obtener VEP detectado para este embarque
  const todos = await getVepEmbarques();
  const vep = todos.find((v) => v.embarqueId === embarqueId);
  if (!vep) {
    return {
      ok: false,
      error: "El embarque no tiene tributos pendientes — quizá ya fue pagado.",
    };
  }
  if (vep.pagado) {
    return {
      ok: false,
      error: `El VEP del embarque ${vep.embarqueCodigo} ya fue pagado anteriormente.`,
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const lineas = vep.cuentas.map((c) => ({
        cuentaId: c.cuentaId,
        debe: c.monto,
        haber: "0",
        descripcion: `Pago VEP ${vep.embarqueCodigo} — ${c.cuentaNombre}`,
      }));
      lineas.push({
        cuentaId: cuentaBancaria.cuentaContableId,
        debe: "0",
        haber: vep.totalArs,
        descripcion: `Pago VEP ${vep.embarqueCodigo} — ${cuentaBancaria.banco}`,
      });

      const descripcionAsiento = `Pago VEP despacho ${vep.embarqueCodigo}${comprobante ? ` (${comprobante})` : ""}`;

      const asiento = await crearAsientoManual(
        {
          fecha,
          descripcion: descripcionAsiento,
          origen: AsientoOrigen.TESORERIA,
          moneda: Moneda.ARS,
          tipoCambio: "1",
          lineas,
        },
        tx,
      );

      await contabilizarAsiento(asiento.id, tx);

      return {
        asientoId: asiento.id,
        asientoNumero: asiento.numero,
        total: vep.totalArs,
      };
    });

    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("pagarVepEmbarqueAction failed", err);
    return { ok: false, error: msg };
  }
}

export async function listarCuentasBancariasParaVep(): Promise<
  Array<{ id: string; banco: string; numero: string | null }>
> {
  const cuentas = await db.cuentaBancaria.findMany({
    where: { moneda: Moneda.ARS },
    orderBy: [{ banco: "asc" }, { numero: "asc" }],
    select: { id: true, banco: true, numero: true },
  });
  return cuentas;
}
