import type { PrismaClient } from "@/generated/prisma/client";

// Helpers de semilla compartidos por los specs e2e. Mantienen el setup DRY y
// alineado con los seeds de la suite vitest (test/*.test.ts): proveedor →
// producto → embarque (USD) → contenedor → ItemContenedor con counters.

export const TIPO_CAMBIO = "1000.000000"; // 1 USD = 1000 ARS

/** Conjunto de tablas a truncar entre specs (orden CASCADE-safe). */
export const TABLAS_COMEX = [
  "DivergenciaItem",
  "DivergenciaInvestigacion",
  "Desconsolidacion",
  "LineaAsiento",
  "Asiento",
  "MovimientoStock",
  "Transferencia",
  "StockPorDeposito",
  "VepDespacho",
  "ItemDespacho",
  "Despacho",
  "DespachoBorrador",
  "ItemContenedor",
  "Contenedor",
  "ItemEmbarque",
  "Embarque",
  "Deposito",
  "Producto",
  "Proveedor",
  "PeriodoContable",
  "CuentaContable",
  "IdempotencyKey",
] as const;

/** Crea un período contable ABIERTO para junio 2025 (fecha base de los specs). */
export async function crearPeriodoAbierto(prisma: PrismaClient): Promise<void> {
  await prisma.periodoContable.create({
    data: {
      codigo: "2025-06",
      nombre: "Junio 2025",
      fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
      fechaFin: new Date("2025-06-30T00:00:00.000Z"),
      estado: "ABIERTO",
    },
  });
}

export interface DepositosSeed {
  depFiscalId: string;
  depDestinoId: string;
}

/** Crea los depósitos fiscal (ZP) y destino (NACIONAL). */
export async function crearDepositos(prisma: PrismaClient): Promise<DepositosSeed> {
  const depFiscal = await prisma.deposito.create({
    data: { nombre: "DF Buenos Aires", tipo: "ZONA_PRIMARIA", subtipo: "DEPOSITO_FISCAL" },
  });
  const depDestino = await prisma.deposito.create({
    data: { nombre: "Nacional", tipo: "NACIONAL" },
  });
  return { depFiscalId: depFiscal.id, depDestinoId: depDestino.id };
}

export interface ContenedorEnDfSeed {
  embarqueId: string;
  contenedorId: string;
  depFiscalId: string;
  depDestinoId: string;
  items: Array<{
    itemContenedorId: number;
    itemEmbarqueId: number;
    productoId: string;
    cantidadDeclarada: number;
  }>;
}

export interface SkuDef {
  codigo: string;
  declarada: number;
  fc: string; // costo FC unitario en USD (string Decimal)
}

export interface ContenedorDesconsolidadoSeed {
  embarqueId: string;
  contenedorId: string;
  depFiscalId: string;
  depDestinoId: string;
  itemContenedorId: number;
  itemEmbarqueId: number;
  productoId: string;
}

/**
 * Semea un contenedor YA DESCONSOLIDADO con saldo disponible y stock en el DF
 * (post-desconsolidación). Sirve para los flujos de despacho parcial cruzado
 * que arrancan después de la desconsolidación.
 */
export async function seedContenedorDesconsolidado(
  prisma: PrismaClient,
  opts: { disponible: number; fc?: string; numeroContenedor?: string; codigoEmbarque?: string },
): Promise<ContenedorDesconsolidadoSeed> {
  const fc = opts.fc ?? "12.5000";
  const { depFiscalId, depDestinoId } = await crearDepositos(prisma);
  const proveedor = await prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
  const producto = await prisma.producto.create({
    data: { codigo: "SKU-1", nombre: "Neumático 295/80" },
  });
  const embarque = await prisma.embarque.create({
    data: {
      codigo: opts.codigoEmbarque ?? "EMB-E2E",
      proveedorId: proveedor.id,
      moneda: "USD",
      tipoCambio: TIPO_CAMBIO,
      depositoDestinoId: depDestinoId,
    },
  });
  const itemEmbarque = await prisma.itemEmbarque.create({
    data: {
      embarqueId: embarque.id,
      productoId: producto.id,
      cantidad: opts.disponible,
      precioUnitarioFob: "10.00",
    },
  });
  const contenedor = await prisma.contenedor.create({
    data: {
      embarqueId: embarque.id,
      numeroContenedor: opts.numeroContenedor ?? "MSCU0000001",
      estado: "DESCONSOLIDADO",
      depositoFiscalId: depFiscalId,
    },
  });
  const ic = await prisma.itemContenedor.create({
    data: {
      contenedorId: contenedor.id,
      itemEmbarqueId: itemEmbarque.id,
      productoId: producto.id,
      cantidadDeclarada: opts.disponible,
      cantidadFisica: opts.disponible,
      cantidadDisponible: opts.disponible,
      costoFCUnitario: fc,
    },
  });
  // Stock en el DF + movimiento de ingreso (lo que crea la desconsolidación en
  // la vida real); respalda el recalc de la reversión.
  const costoArs = (Number(fc) * Number(TIPO_CAMBIO)).toFixed(2);
  await prisma.stockPorDeposito.create({
    data: {
      productoId: producto.id,
      depositoId: depFiscalId,
      cantidadFisica: opts.disponible,
      costoPromedio: costoArs,
    },
  });
  await prisma.movimientoStock.create({
    data: {
      productoId: producto.id,
      depositoId: depFiscalId,
      tipo: "INGRESO",
      cantidad: opts.disponible,
      costoUnitario: costoArs,
      fecha: new Date("2025-06-10T12:00:00.000Z"),
    },
  });

  return {
    embarqueId: embarque.id,
    contenedorId: contenedor.id,
    depFiscalId,
    depDestinoId,
    itemContenedorId: ic.id,
    itemEmbarqueId: itemEmbarque.id,
    productoId: producto.id,
  };
}

/**
 * Semea un contenedor EN_DEPOSITO_FISCAL con FC cerrado, listo para
 * desconsolidar. Devuelve los ids para que el spec dispare el flujo.
 */
export async function seedContenedorEnDF(
  prisma: PrismaClient,
  defs: SkuDef[],
  opts: { codigoEmbarque?: string; numeroContenedor?: string; conArribo?: boolean } = {},
): Promise<ContenedorEnDfSeed> {
  const { depFiscalId, depDestinoId } = await crearDepositos(prisma);
  const proveedor = await prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
  const embarque = await prisma.embarque.create({
    data: {
      codigo: opts.codigoEmbarque ?? "EMB-E2E",
      proveedorId: proveedor.id,
      moneda: "USD",
      tipoCambio: TIPO_CAMBIO,
      depositoDestinoId: depDestinoId,
    },
  });
  // Arribo a zona primaria (debita 1.1.7.03) — precondición del traslado de la
  // desconsolidación (guard Onda A #3). Asiento mínimo + FK del embarque. Se
  // omite (conArribo:false) en los flujos de divergencia, que no postean asiento
  // y asertan asiento.count()===0.
  if (opts.conArribo ?? true) {
    const periodo = await prisma.periodoContable.findFirstOrThrow();
    const max = await prisma.asiento.aggregate({
      where: { periodoId: periodo.id },
      _max: { numero: true },
    });
    const arribo = await prisma.asiento.create({
      data: {
        numero: (max._max.numero ?? 0) + 1,
        fecha: new Date("2025-06-10T12:00:00.000Z"),
        descripcion: `Arribo ZP ${embarque.codigo}`,
        estado: "CONTABILIZADO",
        origen: "COMEX",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: "0",
        totalHaber: "0",
        periodoId: periodo.id,
      },
    });
    await prisma.embarque.update({
      where: { id: embarque.id },
      data: { asientoZonaPrimariaId: arribo.id },
    });
  }
  const contenedor = await prisma.contenedor.create({
    data: {
      embarqueId: embarque.id,
      numeroContenedor: opts.numeroContenedor ?? "MSCU0000001",
      estado: "EN_DEPOSITO_FISCAL",
      depositoFiscalId: depFiscalId,
    },
  });

  const items: ContenedorEnDfSeed["items"] = [];
  for (const def of defs) {
    const producto = await prisma.producto.create({
      data: { codigo: def.codigo, nombre: `Producto ${def.codigo}` },
    });
    const ie = await prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: producto.id,
        cantidad: def.declarada,
        precioUnitarioFob: "10.00",
      },
    });
    const ic = await prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: ie.id,
        productoId: producto.id,
        cantidadDeclarada: def.declarada,
        costoFCUnitario: def.fc,
      },
    });
    items.push({
      itemContenedorId: ic.id,
      itemEmbarqueId: ie.id,
      productoId: producto.id,
      cantidadDeclarada: def.declarada,
    });
  }

  return { embarqueId: embarque.id, contenedorId: contenedor.id, depFiscalId, depDestinoId, items };
}
