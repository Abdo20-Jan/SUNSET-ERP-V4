import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { AsientoEstado } from "@/generated/prisma/client";

export type ExtractoLinea = {
  asientoId: string;
  asientoNumero: number;
  fecha: string; // ISO
  referenciaBanco: string | null;
  factura: string | null; // comprobante o nº de factura inferido
  proveedor: string | null; // nombre de la cuenta contrapartida principal
  proveedorCodigo: string | null;
  descripcion: string;
  debe: string; // entrada al banco (positivo)
  haber: string; // salida del banco
  saldoFinal: string; // saldo acumulado en ARS post-movimiento
};

export type ExtractoBancario = {
  cuentaBancaria: {
    id: string;
    banco: string;
    moneda: "ARS" | "USD";
    numero: string | null;
    cbu: string | null;
    cuentaContableCodigo: string;
    cuentaContableNombre: string;
  };
  desde: Date | null;
  hasta: Date | null;
  saldoInicial: string;
  saldoFinal: string;
  totalDebe: string;
  totalHaber: string;
  lineas: ExtractoLinea[];
};

const BANCO_CAJA_PREFIXES = ["1.1.1.", "1.1.2."];

function esBancoCaja(codigo: string): boolean {
  return BANCO_CAJA_PREFIXES.some((p) => codigo.startsWith(p));
}

/**
 * Construye el extracto bancario de UNA cuenta para el rango [desde, hasta].
 *
 * Para cada `LineaAsiento` que toca la cuenta del banco:
 *   - debe banco > 0  → ENTRADA de cash al banco (cobro, transferencia entrante,
 *     préstamo recibido, aporte, etc).
 *   - haber banco > 0 → SALIDA de cash (pago, transferencia saliente, etc).
 *
 * La columna "Proveedor" muestra el nombre de la cuenta contrapartida
 * principal del asiento (la primera línea no-banco). Si hay múltiples
 * contrapartidas (ej: pago batch a 3 proveedores), muestra la primera +
 * contador "+N más".
 *
 * El saldo final post-movimiento se calcula:
 *   saldoInicial = sum(debe − haber) en banco antes de `desde`
 *   saldoCorrido = saldoInicial + Σ (debe − haber) hasta el movimiento i
 */
export async function getExtractoBancario(params: {
  cuentaBancariaId: string;
  desde: Date | null;
  hasta: Date | null;
}): Promise<ExtractoBancario | null> {
  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: params.cuentaBancariaId },
    select: {
      id: true,
      banco: true,
      moneda: true,
      numero: true,
      cbu: true,
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
    },
  });
  if (!cuentaBancaria) return null;

  const cuentaContableId = cuentaBancaria.cuentaContable.id;

  // Saldo inicial: suma debe − haber de movimientos antes de `desde`.
  const saldoInicialAgg = params.desde
    ? await db.lineaAsiento.aggregate({
        where: {
          cuentaId: cuentaContableId,
          asiento: {
            estado: AsientoEstado.CONTABILIZADO,
            fecha: { lt: params.desde },
          },
        },
        _sum: { debe: true, haber: true },
      })
    : { _sum: { debe: null, haber: null } };

  const saldoInicial = toDecimal(saldoInicialAgg._sum.debe ?? 0).minus(
    toDecimal(saldoInicialAgg._sum.haber ?? 0),
  );

  // Cargar lineas del banco en el rango.
  const lineasBanco = await db.lineaAsiento.findMany({
    where: {
      cuentaId: cuentaContableId,
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        fecha: {
          ...(params.desde ? { gte: params.desde } : {}),
          ...(params.hasta ? { lte: params.hasta } : {}),
        },
      },
    },
    orderBy: [
      { asiento: { fecha: "asc" } },
      { asiento: { numero: "asc" } },
      { id: "asc" },
    ],
    select: {
      id: true,
      debe: true,
      haber: true,
      descripcion: true,
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          descripcion: true,
          // Movimiento de tesorería asociado (si aplica) — trae comprobante
          // y referenciaBanco directamente.
          movimiento: {
            select: { comprobante: true, referenciaBanco: true },
          },
          // Todas las líneas del asiento, para encontrar la contrapartida.
          lineas: {
            orderBy: { id: "asc" },
            select: {
              cuentaId: true,
              debe: true,
              haber: true,
              descripcion: true,
              cuenta: { select: { codigo: true, nombre: true } },
            },
          },
        },
      },
    },
  });

  let saldoCorrido = saldoInicial;
  let totalDebe = new Decimal(0);
  let totalHaber = new Decimal(0);

  const out: ExtractoLinea[] = [];

  for (const l of lineasBanco) {
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    saldoCorrido = saldoCorrido.plus(debe).minus(haber);
    totalDebe = totalDebe.plus(debe);
    totalHaber = totalHaber.plus(haber);

    // Contrapartida(s): líneas del asiento que NO son banco/caja.
    const contrapartidas = l.asiento.lineas.filter(
      (x) => !esBancoCaja(x.cuenta.codigo),
    );
    let proveedor: string | null = null;
    let proveedorCodigo: string | null = null;
    if (contrapartidas.length > 0) {
      const primera = contrapartidas[0]!;
      proveedor = primera.cuenta.nombre;
      proveedorCodigo = primera.cuenta.codigo;
      if (contrapartidas.length > 1) {
        proveedor += ` (+${contrapartidas.length - 1} más)`;
      }
    } else if (l.asiento.lineas.length >= 2) {
      // Asiento con sólo cuentas banco (transferencia interna): muestra
      // la otra cuenta banco como contrapartida.
      const otraBanco = l.asiento.lineas.find((x) => x.cuentaId !== cuentaContableId);
      if (otraBanco) {
        proveedor = `(transferencia → ${otraBanco.cuenta.nombre})`;
        proveedorCodigo = otraBanco.cuenta.codigo;
      }
    }

    const mov = l.asiento.movimiento;
    const factura = mov?.comprobante ?? null;
    const refBanco = mov?.referenciaBanco ?? null;

    // Descripción: la de la línea > la del asiento.
    const descripcion =
      (l.descripcion?.trim() || l.asiento.descripcion).slice(0, 200);

    out.push({
      asientoId: l.asiento.id,
      asientoNumero: l.asiento.numero,
      fecha: l.asiento.fecha.toISOString(),
      referenciaBanco: refBanco,
      factura,
      proveedor,
      proveedorCodigo,
      descripcion,
      debe: debe.toFixed(2),
      haber: haber.toFixed(2),
      saldoFinal: saldoCorrido.toFixed(2),
    });
  }

  return {
    cuentaBancaria: {
      id: cuentaBancaria.id,
      banco: cuentaBancaria.banco,
      moneda: cuentaBancaria.moneda,
      numero: cuentaBancaria.numero,
      cbu: cuentaBancaria.cbu,
      cuentaContableCodigo: cuentaBancaria.cuentaContable.codigo,
      cuentaContableNombre: cuentaBancaria.cuentaContable.nombre,
    },
    desde: params.desde,
    hasta: params.hasta,
    saldoInicial: saldoInicial.toFixed(2),
    saldoFinal: saldoCorrido.toFixed(2),
    totalDebe: totalDebe.toFixed(2),
    totalHaber: totalHaber.toFixed(2),
    lineas: out,
  };
}
