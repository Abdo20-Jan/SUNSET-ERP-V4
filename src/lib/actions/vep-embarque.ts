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
import {
  getSaldoCreditoAduana,
  getVepEmbarques,
} from "@/lib/services/cuentas-a-pagar";
import {
  AsientoOrigen,
  Moneda,
  MovimientoTesoreriaTipo,
} from "@/generated/prisma/client";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

const inputSchema = z.object({
  embarqueId: z.string().uuid(),
  /** Cuenta bancaria de débito. Opcional sólo cuando el VEP se paga
   *  100% con crédito a favor de Aduana — en ese caso no hay
   *  movimiento bancario. */
  cuentaBancariaId: z.string().uuid().optional(),
  fecha: z.coerce.date(),
  comprobante: z.string().trim().max(100).optional(),
  referenciaBanco: z.string().trim().max(100).optional(),
  /** Monto efectivamente pagado al banco — puede diferir del total VEP
   *  por diferencia cambiaria entre cierre y despacho oficializado.
   *  Si vacío, se asume igual al total VEP. */
  montoPagado: z.string().regex(MONEY_RE, "Monto inválido.").optional(),
  /** Monto del crédito a favor de Aduana (1.1.4.13) que se aplica como
   *  parte del pago. El total efectivo del VEP = creditoAplicado +
   *  montoPagado (banco). Si vacío o "0", no se usa crédito. */
  creditoAplicado: z
    .string()
    .regex(MONEY_RE, "Crédito aplicado inválido.")
    .optional(),
});

export type PagarVepInput = z.input<typeof inputSchema>;

export type PagarVepResult =
  | {
      ok: true;
      asientoId: string;
      asientoNumero: number;
      totalVep: string;
      montoPagado: string;
      creditoAplicado: string;
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

  const {
    embarqueId,
    cuentaBancariaId,
    fecha,
    comprobante,
    referenciaBanco,
    montoPagado: montoPagadoInput,
    creditoAplicado: creditoAplicadoInput,
  } = parsed.data;

  const cuentaBancaria = cuentaBancariaId
    ? await db.cuentaBancaria.findUnique({
        where: { id: cuentaBancariaId },
        select: {
          id: true,
          banco: true,
          moneda: true,
          cuentaContableId: true,
        },
      })
    : null;
  if (cuentaBancariaId && !cuentaBancaria) {
    return { ok: false, error: "Cuenta bancaria no existe." };
  }
  if (cuentaBancaria && cuentaBancaria.moneda !== Moneda.ARS) {
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

  // Computar montos: total VEP (calculado al cierre), crédito aplicado
  // (de 1.1.4.13) y monto pagado al banco. El total efectivo del pago =
  // creditoAplicado + montoBanco. La diferencia cambiaria se computa
  // sobre el TOTAL efectivo vs el total VEP.
  const totalVepNum = Number(vep.totalArs);
  const creditoAplicadoNum =
    creditoAplicadoInput && Number(creditoAplicadoInput) > 0
      ? Number(creditoAplicadoInput)
      : 0;

  // Validar que haya saldo suficiente en 1.1.4.13
  if (creditoAplicadoNum > 0) {
    const saldoCredito = await getSaldoCreditoAduana();
    const disponible = Number(saldoCredito.saldo);
    if (creditoAplicadoNum > disponible + 0.005) {
      return {
        ok: false,
        error: `El crédito aplicado (ARS ${creditoAplicadoNum.toFixed(2)}) excede el saldo disponible en 1.1.4.13 (ARS ${disponible.toFixed(2)}).`,
      };
    }
  }

  const montoBancoNum =
    montoPagadoInput !== undefined && Number(montoPagadoInput) >= 0
      ? Number(montoPagadoInput)
      : Math.max(0, totalVepNum - creditoAplicadoNum);

  const totalPagoNum = creditoAplicadoNum + montoBancoNum;
  if (totalPagoNum <= 0) {
    return {
      ok: false,
      error: "El pago debe ser mayor a cero (entre crédito aplicado y banco).",
    };
  }

  // Si hay monto al banco, la cuenta bancaria debe estar seleccionada.
  if (montoBancoNum > 0 && !cuentaBancaria) {
    return {
      ok: false,
      error: "Seleccione una cuenta bancaria para el monto a transferir.",
    };
  }

  const diferenciaNum = totalPagoNum - totalVepNum;
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

      // Línea de aplicación del crédito a favor (1.1.4.13) +
      // ajuste por diferencia cambiaria. Ambos tocan la misma cuenta
      // cuando hay sobra; netamos para no duplicar líneas.
      const sobranteCredito =
        tipoDiferencia === "credito" ? Math.abs(diferenciaNum) : 0;
      const netoCredito = creditoAplicadoNum - sobranteCredito;
      // > 0 → HABER 1.1.4.13 (consume crédito neto)
      // < 0 → DEBE 1.1.4.13 (genera más crédito que el consumido)
      // = 0 → no se emite línea
      if (Math.abs(netoCredito) >= 0.005) {
        const creditoCuentaId = await getOrCreateCuenta(
          tx,
          VEP_ADUANA_CODIGOS.CREDITO_ADUANA,
        );
        if (netoCredito > 0) {
          lineas.push({
            cuentaId: creditoCuentaId,
            debe: "0",
            haber: netoCredito.toFixed(2),
            descripcion: `Aplicación crédito a favor Aduana — VEP ${vep.embarqueCodigo}`,
          });
        } else {
          lineas.push({
            cuentaId: creditoCuentaId,
            debe: Math.abs(netoCredito).toFixed(2),
            haber: "0",
            descripcion: `Crédito a favor Aduana — diferencia cambiaria VEP ${vep.embarqueCodigo}`,
          });
        }
      }

      if (tipoDiferencia === "deuda") {
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

      // HABER del banco con el monto efectivamente transferido (puede
      // ser cero si el VEP se paga totalmente con crédito a favor).
      if (montoBancoNum > 0 && cuentaBancaria) {
        lineas.push({
          cuentaId: cuentaBancaria.cuentaContableId,
          debe: "0",
          haber: montoBancoNum.toFixed(2),
          descripcion: `Pago VEP ${vep.embarqueCodigo} — ${cuentaBancaria.banco}`,
        });
      }

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

      // Crear MovimientoTesoreria sólo si efectivamente hubo
      // movimiento bancario (pago 100% con crédito a favor no genera
      // entrada en extracto).
      const cuentaTributariaPrimaria = vep.cuentas[0]?.cuentaId;
      if (cuentaTributariaPrimaria && montoBancoNum > 0 && cuentaBancaria) {
        await tx.movimientoTesoreria.create({
          data: {
            tipo: MovimientoTesoreriaTipo.PAGO,
            cuentaBancariaId: cuentaBancaria.id,
            fecha,
            monto: montoBancoNum.toFixed(2),
            moneda: Moneda.ARS,
            tipoCambio: "1",
            cuentaContableId: cuentaTributariaPrimaria,
            descripcion: descripcionAsiento,
            comprobante,
            referenciaBanco,
            asientoId: asiento.id,
          },
        });
      }

      await contabilizarAsiento(asiento.id, tx);

      return {
        asientoId: asiento.id,
        asientoNumero: asiento.numero,
        totalVep: vep.totalArs,
        montoPagado: montoBancoNum.toFixed(2),
        creditoAplicado: creditoAplicadoNum.toFixed(2),
        diferencia: Math.abs(diferenciaNum).toFixed(2),
        tipoDiferencia,
      };
    });

    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/tesoreria/movimientos");
    revalidatePath("/tesoreria/extracto");
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
