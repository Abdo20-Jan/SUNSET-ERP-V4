"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, toDecimal } from "@/lib/decimal";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoManual,
} from "@/lib/services/asiento-automatico";
import { ensureCuentasMap, getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { EMBARQUE_CODIGOS, VEP_ADUANA_CODIGOS } from "@/lib/services/cuenta-registry";
import { getSaldoCreditoAduana } from "@/lib/services/cuentas-a-pagar";
import { AsientoOrigen, Moneda, MovimientoTesoreriaTipo } from "@/generated/prisma/client";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

const pagarSchema = z.object({
  despachoId: z.string().min(1),
  /** Cuenta bancaria de débito. Opcional sólo cuando el VEP se paga
   *  100% con crédito a favor de Aduana — en ese caso no hay
   *  movimiento bancario. */
  cuentaBancariaId: z.string().uuid().optional(),
  fecha: z.coerce.date(),
  numeroVep: z.string().trim().max(50).optional(),
  comprobante: z.string().trim().max(100).optional(),
  referenciaBanco: z.string().trim().max(100).optional(),
  /** Monto efectivamente pagado al banco — puede diferir del total VEP
   *  por diferencia cambiaria. Si vacío, se asume igual al total VEP
   *  menos el crédito aplicado. */
  montoPagado: z.string().regex(MONEY_RE, "Monto inválido.").optional(),
  /** Monto del crédito a favor de Aduana (1.1.4.13) que se aplica como
   *  parte del pago. El total efectivo del VEP = creditoAplicado +
   *  montoPagado (banco). Si vacío o "0", no se usa crédito. */
  creditoAplicado: z.string().regex(MONEY_RE, "Crédito aplicado inválido.").optional(),
});

export type PagarVepDespachoInput = z.input<typeof pagarSchema>;

export type PagarVepDespachoResult =
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

/**
 * Paga el VEP (Volante Electrónico de Pago) de un despacho específico.
 * Cancela los pasivos tributarios (2.1.5.x + 2.1.3.x) contra la cuenta
 * bancaria elegida y/o el crédito a favor de Aduana (1.1.4.13), y
 * registra el MovimientoTesoreria correspondiente.
 *
 * Espelho de `pagarVepEmbarqueAction` (extraer helper compartido en
 * follow-up — la lógica de diferencia/crédito/deuda se duplica para
 * mantenerse desacoplada por ahora).
 *
 * Estado del VEP: GENERADO → PAGADO. Idempotente: si ya está PAGADO,
 * falla con mensaje claro.
 */
export async function pagarVepDespachoAction(
  input: PagarVepDespachoInput,
): Promise<PagarVepDespachoResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = pagarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const {
    despachoId,
    cuentaBancariaId,
    fecha,
    numeroVep,
    comprobante,
    referenciaBanco,
    montoPagado: montoPagadoInput,
    creditoAplicado: creditoAplicadoInput,
  } = parsed.data;

  // Carga la cuenta bancaria fuera de la transacción para validar moneda
  // y existencia antes de abrir el lock.
  const cuentaBancaria = cuentaBancariaId
    ? await db.cuentaBancaria.findUnique({
        where: { id: cuentaBancariaId },
        select: { id: true, banco: true, numero: true, cuentaContableId: true, moneda: true },
      })
    : null;
  if (cuentaBancariaId && !cuentaBancaria) {
    return { ok: false, error: "Cuenta bancaria no encontrada." };
  }
  if (cuentaBancaria && cuentaBancaria.moneda !== Moneda.ARS) {
    return {
      ok: false,
      error: "El VEP debe pagarse desde una cuenta bancaria en ARS.",
    };
  }

  const creditoAplicadoNum =
    creditoAplicadoInput && Number(creditoAplicadoInput) > 0 ? Number(creditoAplicadoInput) : 0;

  // Valida saldo disponible de crédito a favor antes de abrir la
  // transacción. Reutiliza helper compartida con el flujo legacy.
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

  try {
    const result = await db.$transaction(async (tx) => {
      const vep = await tx.vepDespacho.findUnique({
        where: { despachoId },
        select: {
          id: true,
          estado: true,
          despacho: {
            select: {
              codigo: true,
              tipoCambio: true,
              die: true,
              tasaEstadistica: true,
              arancelSim: true,
              iva: true,
              ivaAdicional: true,
              iibb: true,
              ganancias: true,
              embarque: { select: { codigo: true } },
            },
          },
        },
      });

      if (!vep) {
        throw new AsientoError("DOMINIO_INVALIDO", "El VEP del despacho no existe.");
      }
      if (vep.estado === "PAGADO") {
        throw new AsientoError("ESTADO_INVALIDO", "El VEP ya está pagado.");
      }

      const d = vep.despacho;
      const tc = toDecimal(d.tipoCambio);
      const dieArs = toDecimal(d.die).times(tc).toDecimalPlaces(2);
      const teArs = toDecimal(d.tasaEstadistica).times(tc).toDecimalPlaces(2);
      const arancelArs = toDecimal(d.arancelSim).times(tc).toDecimalPlaces(2);
      const ivaArs = toDecimal(d.iva).plus(toDecimal(d.ivaAdicional)).times(tc).toDecimalPlaces(2);
      const iibbArs = toDecimal(d.iibb).times(tc).toDecimalPlaces(2);
      const gananciasArs = toDecimal(d.ganancias).times(tc).toDecimalPlaces(2);

      const total = dieArs
        .plus(teArs)
        .plus(arancelArs)
        .plus(ivaArs)
        .plus(iibbArs)
        .plus(gananciasArs);
      if (total.lte(0)) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "El despacho no tiene tributos a pagar — VEP vacío.",
        );
      }

      const totalVepNum = Number(total.toFixed(2));

      // Default: si no se pasó montoPagado, se asume el resto luego de
      // aplicar el crédito (puede ser 0 si crédito cubre todo).
      const montoBancoNum =
        montoPagadoInput !== undefined && Number(montoPagadoInput) >= 0
          ? Number(montoPagadoInput)
          : Math.max(0, totalVepNum - creditoAplicadoNum);

      const totalPagoNum = creditoAplicadoNum + montoBancoNum;
      if (totalPagoNum <= 0) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "El pago debe ser mayor a cero (entre crédito aplicado y banco).",
        );
      }
      if (montoBancoNum > 0 && !cuentaBancaria) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "Seleccione una cuenta bancaria para el monto a transferir.",
        );
      }

      const diferenciaNum = totalPagoNum - totalVepNum;
      const tipoDiferencia: "credito" | "deuda" | "exacto" =
        Math.abs(diferenciaNum) < 0.005 ? "exacto" : diferenciaNum > 0 ? "credito" : "deuda";

      const cuentas = await ensureCuentasMap(tx, EMBARQUE_CODIGOS);

      type LineaInput = {
        cuentaId: number;
        debe?: string | number;
        haber?: string | number;
        descripcion?: string;
      };
      const lineas: LineaInput[] = [];

      const refDesc = `VEP Despacho ${d.codigo} (Embarque ${d.embarque.codigo})`;

      if (dieArs.gt(0)) {
        lineas.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.DIE_PASIVO.codigo)!,
          debe: dieArs.toFixed(2),
          descripcion: `DIE — ${refDesc}`,
        });
      }
      if (teArs.gt(0)) {
        lineas.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.TASA_ESTADISTICA_PASIVO.codigo)!,
          debe: teArs.toFixed(2),
          descripcion: `Tasa Estadística — ${refDesc}`,
        });
      }
      if (arancelArs.gt(0)) {
        lineas.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.ARANCEL_SIM_PASIVO.codigo)!,
          debe: arancelArs.toFixed(2),
          descripcion: `Arancel SIM — ${refDesc}`,
        });
      }
      if (ivaArs.gt(0)) {
        lineas.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.IVA_POR_PAGAR.codigo)!,
          debe: ivaArs.toFixed(2),
          descripcion: `IVA Importación — ${refDesc}`,
        });
      }
      if (iibbArs.gt(0)) {
        lineas.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.IIBB_POR_PAGAR.codigo)!,
          debe: iibbArs.toFixed(2),
          descripcion: `IIBB — ${refDesc}`,
        });
      }
      if (gananciasArs.gt(0)) {
        lineas.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.GANANCIAS_POR_PAGAR.codigo)!,
          debe: gananciasArs.toFixed(2),
          descripcion: `Ganancias — ${refDesc}`,
        });
      }

      // Espelho de pagarVepEmbarqueAction — extraer helper compartido en
      // follow-up. Línea de aplicación del crédito a favor (1.1.4.13) +
      // ajuste por diferencia cambiaria. Ambos tocan la misma cuenta
      // cuando hay sobra; netamos para no duplicar líneas.
      const sobranteCredito = tipoDiferencia === "credito" ? Math.abs(diferenciaNum) : 0;
      const netoCredito = creditoAplicadoNum - sobranteCredito;
      if (Math.abs(netoCredito) >= 0.005) {
        const creditoCuentaId = await getOrCreateCuenta(tx, VEP_ADUANA_CODIGOS.CREDITO_ADUANA);
        if (netoCredito > 0) {
          lineas.push({
            cuentaId: creditoCuentaId,
            haber: netoCredito.toFixed(2),
            descripcion: `Aplicación crédito a favor Aduana — ${refDesc}`,
          });
        } else {
          lineas.push({
            cuentaId: creditoCuentaId,
            debe: Math.abs(netoCredito).toFixed(2),
            descripcion: `Crédito a favor Aduana — diferencia cambiaria ${refDesc}`,
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
          haber: Math.abs(diferenciaNum).toFixed(2),
          descripcion: `Saldo pendiente Aduana — pagar VEP refuerzo embarque ${d.embarque.codigo}`,
        });
      }

      // HABER del banco con el monto efectivamente transferido (puede
      // ser cero si el VEP se paga totalmente con crédito a favor).
      if (montoBancoNum > 0 && cuentaBancaria) {
        lineas.push({
          cuentaId: cuentaBancaria.cuentaContableId,
          haber: montoBancoNum.toFixed(2),
          descripcion: `Pago VEP — ${cuentaBancaria.banco}${cuentaBancaria.numero ? ` ${cuentaBancaria.numero}` : ""}`,
        });
      }

      const asiento = await crearAsientoManual(
        {
          fecha,
          descripcion: refDesc,
          moneda: Moneda.ARS,
          tipoCambio: "1",
          origen: AsientoOrigen.COMEX,
          lineas,
        },
        tx,
      );

      // MovimientoTesoreria sólo si efectivamente hubo movimiento
      // bancario. Pago 100% con crédito no genera entrada en extracto.
      let movimientoId: string | null = null;
      if (montoBancoNum > 0 && cuentaBancaria) {
        const mov = await tx.movimientoTesoreria.create({
          data: {
            tipo: MovimientoTesoreriaTipo.PAGO,
            cuentaBancariaId: cuentaBancaria.id,
            fecha,
            monto: montoBancoNum.toFixed(2),
            moneda: Moneda.ARS,
            tipoCambio: "1",
            cuentaContableId: cuentaBancaria.cuentaContableId,
            descripcion: refDesc,
            comprobante,
            referenciaBanco,
            asientoId: asiento.id,
          },
          select: { id: true },
        });
        movimientoId = mov.id;
      }

      await tx.vepDespacho.update({
        where: { id: vep.id },
        data: {
          estado: "PAGADO",
          fechaPago: fecha,
          numero: numeroVep,
          movimientoTesoreriaId: movimientoId,
          // montoTotal refleja el total liquidado del VEP — no el monto
          // pagado al banco. Mantiene paridad con el flujo legacy.
          montoTotal: money(total),
        },
      });

      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      return {
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
        totalVep: total.toFixed(2),
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
    revalidatePath("/comex/embarques");
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("pagarVepDespachoAction failed", err);
    return { ok: false, error: msg };
  }
}

/**
 * Lista los VepDespacho pendientes (GENERADO o VENCIDO) agrupados
 * por embarque. Complementa getVepEmbarques (que cubre el flujo
 * legacy de cierre monolítico).
 */
export async function listarVepDespachosPendientes() {
  const veps = await db.vepDespacho.findMany({
    where: { estado: { in: ["GENERADO", "VENCIDO"] } },
    orderBy: { createdAt: "asc" },
    include: {
      despacho: {
        select: {
          id: true,
          codigo: true,
          fecha: true,
          embarque: { select: { id: true, codigo: true, proveedor: { select: { nombre: true } } } },
        },
      },
    },
  });
  return veps.map((v) => ({
    id: v.id,
    despachoId: v.despachoId,
    despachoCodigo: v.despacho.codigo,
    despachoFecha: v.despacho.fecha.toISOString(),
    embarqueId: v.despacho.embarque.id,
    embarqueCodigo: v.despacho.embarque.codigo,
    proveedorNombre: v.despacho.embarque.proveedor.nombre,
    montoTotal: v.montoTotal.toString(),
    estado: v.estado,
    createdAt: v.createdAt.toISOString(),
  }));
}
