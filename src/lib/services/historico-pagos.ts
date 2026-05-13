import "server-only";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, Moneda, MovimientoTesoreriaTipo } from "@/generated/prisma/client";

// Cuentas usadas para detectar diferencia cambiaria por pago.
// Reusamos las cuentas de transferencia (4.3.1.01 / 5.8.2.01) que ya
// existen y representan diferencia de cambio. Si el flujo CxP USD
// futuro usa códigos distintos (ex 4.4.1.01 / 5.3.1.01), agregarlos aquí.
const FX_GAIN_CODIGOS = new Set(["4.3.1.01", "4.4.1.01"]);
const FX_LOSS_CODIGOS = new Set(["5.8.2.01", "5.3.1.01"]);

export type PagoFacturaReferencia = {
  origen: "compra" | "embarque" | "gasto";
  id: string;
  numero: string;
  embarqueCodigo: string | null;
};

export type PagoHistorico = {
  movimientoId: string;
  fecha: string;
  asientoId: string | null;
  asientoNumero: number | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  monto: string;
  moneda: "ARS" | "USD";
  tipoCambio: string;
  montoArs: string;
  cuentaBancariaId: string;
  cuentaBancariaLabel: string;
  metodo: string;
  referenciaBanco: string | null;
  comprobante: string | null;
  descripcion: string | null;
  facturas: PagoFacturaReferencia[];
  diferenciaCambiaria: string | null;
  diferenciaCambiariaSigno: "gain" | "loss" | null;
};

export type FiltrosHistoricoPagos = {
  proveedorId?: string;
  desde?: Date;
  hasta?: Date;
  moneda?: Moneda;
  cuentaBancariaId?: string;
  limit?: number;
};

function tokenizar(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(s.split(/[\s—,;]+/).filter((t) => t.length > 0));
}

function inferMetodo(mov: {
  referenciaBanco: string | null;
  comprobante: string | null;
  cuentaBancariaTipo: string;
}): string {
  if (mov.referenciaBanco) return "Transferencia";
  if (mov.comprobante?.toLowerCase().includes("cheque")) return "Cheque";
  if (mov.cuentaBancariaTipo === "CAJA_CHICA") return "Efectivo";
  return "Banco";
}

export async function getHistoricoPagos(
  filtros: FiltrosHistoricoPagos = {},
): Promise<PagoHistorico[]> {
  // Resolver proveedor → cuenta contable si filtro por proveedor
  let cuentaContableFiltro: number | null = null;
  if (filtros.proveedorId) {
    const prov = await db.proveedor.findUnique({
      where: { id: filtros.proveedorId },
      select: { cuentaContableId: true },
    });
    if (!prov?.cuentaContableId) return [];
    cuentaContableFiltro = prov.cuentaContableId;
  }

  const movimientos = await db.movimientoTesoreria.findMany({
    where: {
      tipo: MovimientoTesoreriaTipo.PAGO,
      ...(filtros.cuentaBancariaId ? { cuentaBancariaId: filtros.cuentaBancariaId } : {}),
      ...(filtros.moneda ? { moneda: filtros.moneda } : {}),
      ...(filtros.desde || filtros.hasta
        ? {
            fecha: {
              ...(filtros.desde ? { gte: filtros.desde } : {}),
              ...(filtros.hasta ? { lte: filtros.hasta } : {}),
            },
          }
        : {}),
      ...(cuentaContableFiltro !== null
        ? {
            asiento: {
              lineas: {
                some: { cuentaId: cuentaContableFiltro, debe: { gt: 0 } },
              },
            },
          }
        : {}),
    },
    orderBy: { fecha: "desc" },
    take: filtros.limit ?? 500,
    include: {
      cuentaBancaria: {
        select: {
          id: true,
          banco: true,
          alias: true,
          tipo: true,
          moneda: true,
        },
      },
      asiento: {
        select: {
          id: true,
          numero: true,
          estado: true,
          lineas: {
            select: {
              cuentaId: true,
              debe: true,
              haber: true,
              descripcion: true,
              cuenta: {
                select: { id: true, codigo: true, nombre: true },
              },
            },
          },
        },
      },
    },
  });

  // Precargar todos los proveedores con sus cuentas contables para resolver
  // proveedorId a partir de la cuenta DEBE en cada asiento.
  const proveedores = await db.proveedor.findMany({
    select: { id: true, nombre: true, cuentaContableId: true },
  });
  const provPorCuenta = new Map<number, { id: string; nombre: string }>();
  for (const p of proveedores) {
    if (p.cuentaContableId !== null) {
      provPorCuenta.set(p.cuentaContableId, { id: p.id, nombre: p.nombre });
    }
  }

  // Precargar compras y embarqueCostos para enriquecer la columna factura
  // a partir de tokens en la descripción del DEBE.
  const compras = await db.compra.findMany({
    select: { id: true, numero: true, pedidoCompra: { select: { numero: true } } },
  });
  const embarqueCostos = await db.embarqueCosto.findMany({
    select: {
      id: true,
      facturaNumero: true,
      embarque: { select: { codigo: true } },
    },
  });
  const gastos = await db.gasto.findMany({
    select: { id: true, numero: true, facturaNumero: true },
  });

  const result: PagoHistorico[] = [];

  for (const mov of movimientos) {
    // Sólo contabilizados producen historial real
    if (mov.asiento && mov.asiento.estado !== AsientoEstado.CONTABILIZADO) {
      continue;
    }

    // Detectar proveedor: línea DEBE en cuenta de algún proveedor
    let proveedor: { id: string; nombre: string } | null = null;
    let descripcionDebe: string | null = null;
    if (mov.asiento) {
      for (const l of mov.asiento.lineas) {
        const debe = toDecimal(l.debe);
        if (debe.lte(0)) continue;
        const p = provPorCuenta.get(l.cuentaId);
        if (p) {
          proveedor = p;
          descripcionDebe = l.descripcion;
          break;
        }
      }
    }

    // Detectar diferencia cambiaria
    let diffMonto: string | null = null;
    let diffSigno: "gain" | "loss" | null = null;
    if (mov.asiento) {
      for (const l of mov.asiento.lineas) {
        if (FX_GAIN_CODIGOS.has(l.cuenta.codigo)) {
          const haber = toDecimal(l.haber);
          if (haber.gt(0)) {
            diffMonto = haber.toFixed(2);
            diffSigno = "gain";
            break;
          }
        }
        if (FX_LOSS_CODIGOS.has(l.cuenta.codigo)) {
          const debe = toDecimal(l.debe);
          if (debe.gt(0)) {
            diffMonto = debe.toFixed(2);
            diffSigno = "loss";
            break;
          }
        }
      }
    }

    // Resolver facturas referenciadas vía tokens
    const tokens = tokenizar(descripcionDebe);
    const facturas: PagoFacturaReferencia[] = [];

    for (const c of compras) {
      const numTokens = tokenizar(c.numero);
      if (numTokens.size > 0 && [...numTokens].every((t) => tokens.has(t))) {
        facturas.push({
          origen: "compra",
          id: c.id,
          numero: c.numero,
          embarqueCodigo: null,
        });
      }
    }
    for (const ec of embarqueCostos) {
      const num = ec.facturaNumero;
      if (!num) continue;
      const numTokens = tokenizar(num);
      const matchNumero = numTokens.size > 0 && [...numTokens].every((t) => tokens.has(t));
      const matchEmbarque = tokens.has(ec.embarque.codigo);
      if (matchNumero || matchEmbarque) {
        facturas.push({
          origen: "embarque",
          id: String(ec.id),
          numero: num,
          embarqueCodigo: ec.embarque.codigo,
        });
      }
    }
    for (const g of gastos) {
      const num = g.facturaNumero ?? g.numero;
      const numTokens = tokenizar(num);
      if (numTokens.size > 0 && [...numTokens].every((t) => tokens.has(t))) {
        facturas.push({
          origen: "gasto",
          id: g.id,
          numero: num,
          embarqueCodigo: null,
        });
      }
    }

    const monto = toDecimal(mov.monto);
    const tc = toDecimal(mov.tipoCambio);
    const montoArs = monto.times(tc).toDecimalPlaces(2);

    const bancoLabel = mov.cuentaBancaria.alias
      ? `${mov.cuentaBancaria.banco} (${mov.cuentaBancaria.alias})`
      : `${mov.cuentaBancaria.banco} ${mov.cuentaBancaria.moneda}`;

    result.push({
      movimientoId: mov.id,
      fecha: mov.fecha.toISOString(),
      asientoId: mov.asiento?.id ?? null,
      asientoNumero: mov.asiento?.numero ?? null,
      proveedorId: proveedor?.id ?? null,
      proveedorNombre: proveedor?.nombre ?? null,
      monto: monto.toFixed(2),
      moneda: mov.moneda as "ARS" | "USD",
      tipoCambio: tc.toFixed(6),
      montoArs: montoArs.toFixed(2),
      cuentaBancariaId: mov.cuentaBancaria.id,
      cuentaBancariaLabel: bancoLabel,
      metodo: inferMetodo({
        referenciaBanco: mov.referenciaBanco,
        comprobante: mov.comprobante,
        cuentaBancariaTipo: mov.cuentaBancaria.tipo,
      }),
      referenciaBanco: mov.referenciaBanco,
      comprobante: mov.comprobante,
      descripcion: mov.descripcion,
      facturas,
      diferenciaCambiaria: diffMonto,
      diferenciaCambiariaSigno: diffSigno,
    });
  }

  return result;
}
