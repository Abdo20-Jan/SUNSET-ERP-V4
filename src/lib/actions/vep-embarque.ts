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
import { getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { VEP_ADUANA_CODIGOS } from "@/lib/services/cuenta-registry";
import { getVepEmbarques } from "@/lib/services/cuentas-a-pagar";
import {
  AsientoOrigen,
  Moneda,
} from "@/generated/prisma/client";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

const inputSchema = z.object({
  embarqueId: z.string().uuid(),
  cuentaBancariaId: z.string().uuid(),
  fecha: z.coerce.date(),
  comprobante: z.string().trim().max(100).optional(),
  /** Monto efectivamente pagado al banco — puede diferir del total VEP
   *  por diferencia cambiaria entre cierre y despacho oficializado.
   *  Si vacío, se asume igual al total VEP. */
  montoPagado: z.string().regex(MONEY_RE, "Monto inválido.").optional(),
});

export type PagarVepInput = z.input<typeof inputSchema>;

export type PagarVepResult =
  | {
      ok: true;
      asientoId: string;
      asientoNumero: number;
      totalVep: string;
      montoPagado: string;
      diferencia: string;
      tipoDiferencia: "credito" | "deuda" | "exacto";
    }
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

  const { embarqueId, cuentaBancariaId, fecha, comprobante, montoPagado: montoPagadoInput } =
    parsed.data;

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

  // Computar montos: total VEP (calculado al cierre) vs monto pagado (real)
  const totalVepNum = Number(vep.totalArs);
  const montoPagadoNum =
    montoPagadoInput && Number(montoPagadoInput) > 0
      ? Number(montoPagadoInput)
      : totalVepNum;
  const diferenciaNum = montoPagadoNum - totalVepNum;
  const tipoDiferencia: "credito" | "deuda" | "exacto" =
    Math.abs(diferenciaNum) < 0.005
      ? "exacto"
      : diferenciaNum > 0
        ? "credito"
        : "deuda";

  try {
    const result = await db.$transaction(async (tx) => {
      const lineas: Array<{
        cuentaId: number;
        debe: string;
        haber: string;
        descripcion?: string;
      }> = vep.cuentas.map((c) => ({
        cuentaId: c.cuentaId,
        debe: c.monto,
        haber: "0",
        descripcion: `Pago VEP ${vep.embarqueCodigo} — ${c.cuentaNombre}`,
      }));

      // Línea de ajuste por diferencia cambiaria entre cierre y despacho
      if (tipoDiferencia === "credito") {
        const creditoCuentaId = await getOrCreateCuenta(
          tx,
          VEP_ADUANA_CODIGOS.CREDITO_ADUANA,
        );
        lineas.push({
          cuentaId: creditoCuentaId,
          debe: Math.abs(diferenciaNum).toFixed(2),
          haber: "0",
          descripcion: `Crédito a favor Aduana — diferencia cambiaria VEP ${vep.embarqueCodigo}`,
        });
      } else if (tipoDiferencia === "deuda") {
        const deudaCuentaId = await getOrCreateCuenta(
          tx,
          VEP_ADUANA_CODIGOS.SALDO_PENDIENTE_ADUANA,
        );
        lineas.push({
          cuentaId: deudaCuentaId,
          debe: "0",
          haber: Math.abs(diferenciaNum).toFixed(2),
          descripcion: `Saldo pendiente Aduana — pagar VEP refuerzo embarque ${vep.embarqueCodigo}`,
        });
      }

      // HABER del banco con el monto efectivamente pagado
      lineas.push({
        cuentaId: cuentaBancaria.cuentaContableId,
        debe: "0",
        haber: montoPagadoNum.toFixed(2),
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
        totalVep: vep.totalArs,
        montoPagado: montoPagadoNum.toFixed(2),
        diferencia: Math.abs(diferenciaNum).toFixed(2),
        tipoDiferencia,
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
