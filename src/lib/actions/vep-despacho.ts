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
import { ensureCuentasMap } from "@/lib/services/cuenta-auto";
import { EMBARQUE_CODIGOS } from "@/lib/services/cuenta-registry";
import { AsientoOrigen, Moneda, MovimientoTesoreriaTipo } from "@/generated/prisma/client";

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

const pagarSchema = z.object({
  despachoId: z.string().min(1),
  cuentaBancariaId: z.string().uuid(),
  fecha: z.coerce.date(),
  numeroVep: z.string().trim().max(50).optional(),
  comprobante: z.string().trim().max(100).optional(),
  referenciaBanco: z.string().trim().max(100).optional(),
});

export type PagarVepDespachoInput = z.input<typeof pagarSchema>;

export type PagarVepDespachoResult =
  | { ok: true; asientoId: string; asientoNumero: number; montoPagado: string }
  | { ok: false; error: string };

/**
 * Paga el VEP (Volante Electrónico de Pago) de un despacho específico.
 * Cancela los pasivos tributarios (2.1.5.x + 2.1.3.x) contra la cuenta
 * bancaria elegida y registra el MovimientoTesoreria correspondiente.
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
  const { despachoId, cuentaBancariaId, fecha, numeroVep, comprobante, referenciaBanco } =
    parsed.data;

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

      const cuentaBancaria = await tx.cuentaBancaria.findUnique({
        where: { id: cuentaBancariaId },
        select: { id: true, banco: true, numero: true, cuentaContableId: true, moneda: true },
      });
      if (!cuentaBancaria) {
        throw new AsientoError("DOMINIO_INVALIDO", "Cuenta bancaria no encontrada.");
      }
      if (cuentaBancaria.moneda !== Moneda.ARS) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "El VEP debe pagarse desde una cuenta bancaria en ARS.",
        );
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

      const cuentas = await ensureCuentasMap(tx, EMBARQUE_CODIGOS);

      type LineaInput = {
        cuentaId: number;
        debe?: string | number;
        haber?: string | number;
        descripcion?: string;
      };
      const debe: LineaInput[] = [];

      const refDesc = `VEP Despacho ${d.codigo} (Embarque ${d.embarque.codigo})`;

      if (dieArs.gt(0)) {
        debe.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.DIE_PASIVO.codigo)!,
          debe: dieArs.toFixed(2),
          descripcion: `DIE — ${refDesc}`,
        });
      }
      if (teArs.gt(0)) {
        debe.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.TASA_ESTADISTICA_PASIVO.codigo)!,
          debe: teArs.toFixed(2),
          descripcion: `Tasa Estadística — ${refDesc}`,
        });
      }
      if (arancelArs.gt(0)) {
        debe.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.ARANCEL_SIM_PASIVO.codigo)!,
          debe: arancelArs.toFixed(2),
          descripcion: `Arancel SIM — ${refDesc}`,
        });
      }
      if (ivaArs.gt(0)) {
        debe.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.IVA_POR_PAGAR.codigo)!,
          debe: ivaArs.toFixed(2),
          descripcion: `IVA Importación — ${refDesc}`,
        });
      }
      if (iibbArs.gt(0)) {
        debe.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.IIBB_POR_PAGAR.codigo)!,
          debe: iibbArs.toFixed(2),
          descripcion: `IIBB — ${refDesc}`,
        });
      }
      if (gananciasArs.gt(0)) {
        debe.push({
          cuentaId: cuentas.get(EMBARQUE_CODIGOS.GANANCIAS_POR_PAGAR.codigo)!,
          debe: gananciasArs.toFixed(2),
          descripcion: `Ganancias — ${refDesc}`,
        });
      }

      const lineasAsiento: LineaInput[] = [
        ...debe,
        {
          cuentaId: cuentaBancaria.cuentaContableId,
          haber: total.toFixed(2),
          descripcion: `Pago VEP — ${cuentaBancaria.banco} ${cuentaBancaria.numero}`,
        },
      ];

      const asiento = await crearAsientoManual(
        {
          fecha,
          descripcion: refDesc,
          moneda: Moneda.ARS,
          tipoCambio: "1",
          origen: AsientoOrigen.COMEX,
          lineas: lineasAsiento,
        },
        tx,
      );

      // MovimientoTesoreria con el monto pagado.
      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo: MovimientoTesoreriaTipo.PAGO,
          cuentaBancariaId: cuentaBancaria.id,
          fecha,
          monto: total.toFixed(2),
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

      await tx.vepDespacho.update({
        where: { id: vep.id },
        data: {
          estado: "PAGADO",
          fechaPago: fecha,
          numero: numeroVep,
          movimientoTesoreriaId: mov.id,
          montoTotal: money(total),
        },
      });

      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      return {
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
        montoPagado: total.toFixed(2),
      };
    });

    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/tesoreria/movimientos");
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
