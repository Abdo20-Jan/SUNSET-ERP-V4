import "server-only";

import { Decimal as DecimalJs } from "@/lib/decimal";
import {
  AsientoOrigen,
  Moneda,
  type Asiento,
} from "@/generated/prisma/client";

import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoManual,
} from "./asiento-automatico";
import { getOrCreateCuenta } from "./cuenta-auto";
import {
  COMPRA_CODIGOS,
  GASTO_POR_TIPO_PROVEEDOR,
} from "./cuenta-registry";
import { db } from "@/lib/db";

/**
 * Registra un GastoFijo en un período: crea Asiento contabilizado +
 * GastoFijoRegistro. Idempotente vía unique (gastoFijoId, year, month).
 */
export async function registrarGastoFijoPeriodo(opts: {
  gastoFijoId: number;
  year: number;
  month: number;
  fecha: Date;
  tipoCambio: string;
}): Promise<{ asiento: Asiento; registroId: number }> {
  const { gastoFijoId, year, month, fecha, tipoCambio } = opts;

  return db.$transaction(async (tx) => {
    const gasto = await tx.gastoFijo.findUnique({
      where: { id: gastoFijoId },
      include: {
        proveedor: {
          select: {
            id: true,
            nombre: true,
            cuentaContableId: true,
            cuentaGastoContableId: true,
            tipoProveedor: true,
          },
        },
      },
    });
    if (!gasto) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `GastoFijo ${gastoFijoId} no existe.`,
      );
    }
    if (!gasto.activo) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `GastoFijo "${gasto.descripcion}" está inactivo.`,
      );
    }

    const yaRegistrado = await tx.gastoFijoRegistro.findUnique({
      where: {
        gastoFijoId_periodoYear_periodoMonth: {
          gastoFijoId,
          periodoYear: year,
          periodoMonth: month,
        },
      },
      select: { id: true, asientoId: true },
    });
    if (yaRegistrado) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `Ya se registró este gasto fijo para ${String(month).padStart(2, "0")}/${year} (registro #${yaRegistrado.id}).`,
      );
    }

    // Resolver cuentas
    let proveedorPasivoId = gasto.proveedor.cuentaContableId;
    if (!proveedorPasivoId) {
      proveedorPasivoId = await getOrCreateCuenta(
        tx,
        COMPRA_CODIGOS.PROVEEDOR_FALLBACK,
      );
    }

    let gastoCuentaId = gasto.cuentaGastoContableId;
    if (!gastoCuentaId) gastoCuentaId = gasto.proveedor.cuentaGastoContableId;
    if (!gastoCuentaId) {
      const def = GASTO_POR_TIPO_PROVEEDOR[gasto.proveedor.tipoProveedor];
      gastoCuentaId = await getOrCreateCuenta(tx, def);
    }

    const ivaCuentaId = await getOrCreateCuenta(tx, COMPRA_CODIGOS.IVA_CREDITO);
    const iibbCuentaId = await getOrCreateCuenta(
      tx,
      COMPRA_CODIGOS.IIBB_CREDITO,
    );

    // Computar montos (en moneda del gasto, luego × TC para asiento en ARS)
    const tc = new DecimalJs(tipoCambio);
    const neto = new DecimalJs(gasto.montoNeto.toString());
    const iva = neto.times(new DecimalJs(gasto.ivaPorcentaje.toString())).dividedBy(100).toDecimalPlaces(2);
    const iibb = neto.times(new DecimalJs(gasto.iibbPorcentaje.toString())).dividedBy(100).toDecimalPlaces(2);
    const total = neto.plus(iva).plus(iibb).toDecimalPlaces(2);

    const netoArs = neto.times(tc).toDecimalPlaces(2);
    const ivaArs = iva.times(tc).toDecimalPlaces(2);
    const iibbArs = iibb.times(tc).toDecimalPlaces(2);
    const totalArs = netoArs.plus(ivaArs).plus(iibbArs);

    const lineas: Array<{
      cuentaId: number;
      debe: string;
      haber: string;
      descripcion?: string;
    }> = [
      {
        cuentaId: gastoCuentaId,
        debe: netoArs.toFixed(2),
        haber: "0",
        descripcion: `Gasto fijo: ${gasto.descripcion}`,
      },
    ];
    if (ivaArs.gt(0)) {
      lineas.push({
        cuentaId: ivaCuentaId,
        debe: ivaArs.toFixed(2),
        haber: "0",
        descripcion: `IVA crédito fiscal — ${gasto.descripcion}`,
      });
    }
    if (iibbArs.gt(0)) {
      lineas.push({
        cuentaId: iibbCuentaId,
        debe: iibbArs.toFixed(2),
        haber: "0",
        descripcion: `Crédito IIBB — ${gasto.descripcion}`,
      });
    }
    lineas.push({
      cuentaId: proveedorPasivoId,
      debe: "0",
      haber: totalArs.toFixed(2),
      descripcion: `Cta. a pagar — ${gasto.proveedor.nombre}`,
    });

    const asiento = await crearAsientoManual(
      {
        fecha,
        descripcion: `Gasto fijo ${String(month).padStart(2, "0")}/${year} — ${gasto.descripcion}`,
        origen: AsientoOrigen.MANUAL,
        moneda: gasto.moneda as Moneda,
        tipoCambio,
        lineas,
      },
      tx,
    );

    await contabilizarAsiento(asiento.id, tx);

    const registro = await tx.gastoFijoRegistro.create({
      data: {
        gastoFijoId,
        periodoYear: year,
        periodoMonth: month,
        fecha,
        tipoCambio,
        montoNeto: neto.toFixed(2),
        iva: iva.toFixed(2),
        iibb: iibb.toFixed(2),
        total: total.toFixed(2),
        asientoId: asiento.id,
      },
      select: { id: true },
    });

    return { asiento, registroId: registro.id };
  });
}
