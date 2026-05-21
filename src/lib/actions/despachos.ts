"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, toDecimal } from "@/lib/decimal";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import {
  anularAsiento,
  AsientoError,
  contabilizarAsiento,
  crearAsientoDespacho,
  crearAsientoDespachoCruzado,
} from "@/lib/services/asiento-automatico";
import {
  aplicarIngresoDespacho,
  aplicarNacionalizacionDF,
  aplicarTransferenciaDespacho,
  revertirIngresoDespacho,
  revertirTransferenciaDespacho,
} from "@/lib/services/stock";
import { resolverDepositoZpa } from "@/lib/services/embarque-zpa";
import {
  DespachoParcialError,
  materializarDespachoCruzado,
  revertirCountersDespacho,
} from "@/lib/services/despacho-parcial";
import { validarDisponible } from "@/lib/services/stock-helpers";
import { Prisma } from "@/generated/prisma/client";

// ============================================================
// Types — compartidos UI ↔ action
// ============================================================

export type DespachoListRow = {
  id: string;
  codigo: string;
  fecha: string;
  estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO";
  numeroOM: string | null;
  itemsCount: number;
  facturasCount: number;
  asiento: { id: string; numero: number } | null;
};

export type DespachoDetalle = DespachoListRow & {
  embarqueId: string;
  embarqueCodigo: string;
  tipoCambio: string;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva: string;
  ivaAdicional: string;
  iibb: string;
  ganancias: string;
  notas: string | null;
  items: Array<{
    id: number;
    itemEmbarqueId: number;
    productoId: string;
    productoCodigo: string;
    productoNombre: string;
    cantidad: number;
    cantidadEmbarque: number;
    costoUnitario: string;
  }>;
  facturas: Array<{
    id: number;
    proveedorNombre: string;
    facturaNumero: string | null;
    momento: "ZONA_PRIMARIA" | "DESPACHO";
    totalArs: string;
  }>;
};

// ============================================================
// Listar / detalle
// ============================================================

export async function listarDespachosDeEmbarque(embarqueId: string): Promise<DespachoListRow[]> {
  const despachos = await db.despacho.findMany({
    where: { embarqueId },
    orderBy: [{ createdAt: "asc" }],
    include: {
      asiento: { select: { id: true, numero: true } },
      _count: { select: { items: true, costos: true } },
    },
  });
  return despachos.map((d) => ({
    id: d.id,
    codigo: d.codigo,
    fecha: d.fecha.toISOString(),
    estado: d.estado,
    numeroOM: d.numeroOM,
    itemsCount: d._count.items,
    facturasCount: d._count.costos,
    asiento: d.asiento,
  }));
}

export async function obtenerDespachoPorId(despachoId: string): Promise<DespachoDetalle | null> {
  const d = await db.despacho.findUnique({
    where: { id: despachoId },
    include: {
      embarque: { select: { id: true, codigo: true } },
      asiento: { select: { id: true, numero: true } },
      items: {
        include: {
          itemEmbarque: {
            include: {
              producto: {
                select: { id: true, codigo: true, nombre: true },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      },
      costos: {
        include: {
          proveedor: { select: { nombre: true } },
          lineas: { select: { subtotal: true } },
        },
        orderBy: { id: "asc" },
      },
      _count: { select: { items: true, costos: true } },
    },
  });
  if (!d) return null;
  return {
    id: d.id,
    codigo: d.codigo,
    fecha: d.fecha.toISOString(),
    estado: d.estado,
    numeroOM: d.numeroOM,
    itemsCount: d._count.items,
    facturasCount: d._count.costos,
    asiento: d.asiento,
    embarqueId: d.embarque.id,
    embarqueCodigo: d.embarque.codigo,
    tipoCambio: d.tipoCambio.toString(),
    die: d.die.toString(),
    tasaEstadistica: d.tasaEstadistica.toString(),
    arancelSim: d.arancelSim.toString(),
    iva: d.iva.toString(),
    ivaAdicional: d.ivaAdicional.toString(),
    iibb: d.iibb.toString(),
    ganancias: d.ganancias.toString(),
    notas: d.notas,
    items: d.items.map((i) => ({
      id: i.id,
      itemEmbarqueId: i.itemEmbarqueId,
      productoId: i.itemEmbarque.producto.id,
      productoCodigo: i.itemEmbarque.producto.codigo,
      productoNombre: i.itemEmbarque.producto.nombre,
      cantidad: i.cantidad,
      cantidadEmbarque: i.itemEmbarque.cantidad,
      costoUnitario: i.costoUnitario.toString(),
    })),
    facturas: d.costos.map((f) => {
      const tc = toDecimal(f.tipoCambio);
      const subtotal = f.lineas.reduce(
        (s, l) => s.plus(toDecimal(l.subtotal).times(tc).toDecimalPlaces(2)),
        toDecimal(0),
      );
      const total = subtotal
        .plus(toDecimal(f.iva).times(tc).toDecimalPlaces(2))
        .plus(toDecimal(f.iibb).times(tc).toDecimalPlaces(2))
        .plus(toDecimal(f.otros).times(tc).toDecimalPlaces(2));
      return {
        id: f.id,
        proveedorNombre: f.proveedor.nombre,
        facturaNumero: f.facturaNumero,
        momento: f.momento as "ZONA_PRIMARIA" | "DESPACHO",
        totalArs: total.toString(),
      };
    }),
  };
}

// ============================================================
// Crear despacho (BORRADOR) — sin contabilizar todavía
// ============================================================

const itemSchema = z.object({
  itemEmbarqueId: z.number().int().positive(),
  cantidad: z.number().int().positive(),
  // Origen del flujo cruzado (Fase 4, flag ON). El legacy lo ignora.
  itemContenedorId: z.number().int().positive().optional(),
});

const decimalish = z.union([z.string(), z.number()]).transform((v) => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n >= 0 ? v.toString() : "0";
});

const decimalishPositive = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((n) => Number.isFinite(n) && n > 0, {
    message: "Debe ser un número mayor que 0.",
  })
  .transform((n) => n.toString());

const crearDespachoSchema = z.object({
  embarqueId: z.string().min(1),
  fecha: z.union([z.string(), z.date()]),
  numeroOM: z.string().trim().optional().nullable(),
  tipoCambio: decimalishPositive,
  die: decimalish.default("0"),
  tasaEstadistica: decimalish.default("0"),
  arancelSim: decimalish.default("0"),
  iva: decimalish.default("0"),
  ivaAdicional: decimalish.default("0"),
  iibb: decimalish.default("0"),
  ganancias: decimalish.default("0"),
  items: z.array(itemSchema).min(1),
  facturasIds: z.array(z.number().int().positive()).default([]),
  notas: z.string().trim().optional().nullable(),
});

export type CrearDespachoInput = z.input<typeof crearDespachoSchema>;

export type CrearDespachoResult =
  | { ok: true; despachoId: string; codigo: string }
  | { ok: false; error: string };

async function siguienteCodigoDespacho(
  tx: Prisma.TransactionClient,
  embarqueCodigo: string,
): Promise<string> {
  const existentes = await tx.despacho.count({
    where: { codigo: { startsWith: `${embarqueCodigo}-D` } },
  });
  return `${embarqueCodigo}-D${existentes + 1}`;
}

type CrearDespachoData = z.infer<typeof crearDespachoSchema>;
type TxClient = Prisma.TransactionClient;

// Fork legacy/nuevo del despacho (P1-5). Con la flag apagada (default prod)
// se ejecuta SIEMPRE el flujo legacy (bundled, a nivel ItemEmbarque), idéntico
// al histórico. El flujo por contenedor (Fase 4) sólo se activa en staging.

/**
 * Flujo legacy (bundled): el despacho consume cantidades a nivel ItemEmbarque
 * del embarque. Comportamiento histórico extraído sin cambios — NO modificar
 * acá; las divergencias del flujo cruzado van en `crearDespachoContenedor`.
 */
async function crearDespachoLegacy(
  tx: TxClient,
  data: CrearDespachoData,
  fecha: Date,
): Promise<{ despachoId: string; codigo: string }> {
  const embarque = await tx.embarque.findUnique({
    where: { id: data.embarqueId },
    select: {
      id: true,
      codigo: true,
      asientoId: true,
      asientoZonaPrimariaId: true,
      items: { select: { id: true, cantidad: true } },
    },
  });
  if (!embarque) {
    throw new AsientoError("DOMINIO_INVALIDO", "El embarque no existe.");
  }
  if (embarque.asientoId) {
    throw new AsientoError(
      "ESTADO_INVALIDO",
      `El embarque ${embarque.codigo} ya tiene cierre monolítico — anule primero el cierre o use el flujo legacy.`,
    );
  }
  if (!embarque.asientoZonaPrimariaId) {
    throw new AsientoError(
      "ESTADO_INVALIDO",
      `El embarque ${embarque.codigo}: confirmá zona primaria antes de despachar.`,
    );
  }

  // Validar items pertenecen al embarque + cantidades vs remanente
  const itemsEmbById = new Map(embarque.items.map((i) => [i.id, i.cantidad]));
  const otrosItems = await tx.itemDespacho.findMany({
    where: {
      despacho: { embarqueId: embarque.id, estado: { not: "ANULADO" } },
    },
    select: { itemEmbarqueId: true, cantidad: true },
  });
  const yaDespachadoPorIE = new Map<number, number>();
  for (const oi of otrosItems) {
    yaDespachadoPorIE.set(
      oi.itemEmbarqueId,
      (yaDespachadoPorIE.get(oi.itemEmbarqueId) ?? 0) + oi.cantidad,
    );
  }
  for (const it of data.items) {
    const cantTotal = itemsEmbById.get(it.itemEmbarqueId);
    if (cantTotal == null) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Ítem ${it.itemEmbarqueId} no pertenece al embarque.`,
      );
    }
    const remanente = cantTotal - (yaDespachadoPorIE.get(it.itemEmbarqueId) ?? 0);
    if (it.cantidad > remanente) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Cantidad ${it.cantidad} excede remanente ${remanente} del ítem #${it.itemEmbarqueId}.`,
      );
    }
  }

  // Validar facturas (si pasaron) son del embarque + momento DESPACHO
  // + no están linkadas a otro despacho activo
  if (data.facturasIds.length > 0) {
    const facturas = await tx.embarqueCosto.findMany({
      where: { id: { in: data.facturasIds } },
      select: { id: true, embarqueId: true, momento: true, despachoId: true },
    });
    for (const fid of data.facturasIds) {
      const f = facturas.find((x) => x.id === fid);
      if (!f) {
        throw new AsientoError("DOMINIO_INVALIDO", `Factura ${fid} no existe.`);
      }
      if (f.embarqueId !== embarque.id) {
        throw new AsientoError("DOMINIO_INVALIDO", `Factura ${fid} no pertenece al embarque.`);
      }
      if (f.momento !== "DESPACHO") {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Factura ${fid}: sólo facturas con momento DESPACHO se pueden linkar.`,
        );
      }
      if (f.despachoId) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `Factura ${fid} ya está linkada a otro despacho.`,
        );
      }
    }
  }

  const codigo = await siguienteCodigoDespacho(tx, embarque.codigo);

  const despacho = await tx.despacho.create({
    data: {
      codigo,
      embarqueId: embarque.id,
      fecha,
      numeroOM: data.numeroOM?.trim() || null,
      tipoCambio: money(toDecimal(data.tipoCambio)),
      die: money(toDecimal(data.die)),
      tasaEstadistica: money(toDecimal(data.tasaEstadistica)),
      arancelSim: money(toDecimal(data.arancelSim)),
      iva: money(toDecimal(data.iva)),
      ivaAdicional: money(toDecimal(data.ivaAdicional)),
      iibb: money(toDecimal(data.iibb)),
      ganancias: money(toDecimal(data.ganancias)),
      notas: data.notas?.trim() || null,
      items: {
        create: data.items.map((i) => ({
          itemEmbarqueId: i.itemEmbarqueId,
          cantidad: i.cantidad,
        })),
      },
    },
  });

  if (data.facturasIds.length > 0) {
    await tx.embarqueCosto.updateMany({
      where: { id: { in: data.facturasIds } },
      data: { despachoId: despacho.id },
    });
  }

  return { despachoId: despacho.id, codigo: despacho.codigo };
}

/**
 * Flujo nuevo (despacho cruzado por contenedor): consume counters de
 * ItemContenedor (cantidadDisponible→cantidadDespachada) en lugar de
 * cantidades a nivel ItemEmbarque. Delega en el service de despacho parcial
 * (PR 4.2) con fuente DIRECTO. Inalcanzable en prod mientras la flag esté
 * apagada. El asiento sigue siendo del flujo de contabilización (PR 4.5).
 */
async function crearDespachoContenedor(
  tx: TxClient,
  data: CrearDespachoData,
  fecha: Date,
): Promise<{ despachoId: string; codigo: string }> {
  const lineas = data.items.map((i) => {
    if (i.itemContenedorId == null) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `El ítem (itemEmbarque ${i.itemEmbarqueId}) no tiene itemContenedorId: el flujo cruzado requiere el origen por contenedor.`,
      );
    }
    return { itemContenedorId: i.itemContenedorId, cantidad: i.cantidad };
  });
  return materializarDespachoCruzado(tx, {
    embarqueId: data.embarqueId,
    fecha,
    lineas,
    fuente: "DIRECTO",
  });
}

export async function crearDespachoAction(input: CrearDespachoInput): Promise<CrearDespachoResult> {
  const parsed = crearDespachoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;
  const fecha = data.fecha instanceof Date ? data.fecha : new Date(data.fecha);

  try {
    const result = await db.$transaction((tx) =>
      isContenedorDesconsolidacionEnabled()
        ? crearDespachoContenedor(tx, data, fecha)
        : crearDespachoLegacy(tx, data, fecha),
    );

    revalidatePath(`/comex/embarques/${data.embarqueId}`);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError || err instanceof DespachoParcialError) {
      return { ok: false, error: err.message };
    }
    console.error("crearDespachoAction failed", err);
    return { ok: false, error: "Error inesperado al crear despacho." };
  }
}

// ============================================================
// Contabilizar despacho — genera asiento + aplica stock
// ============================================================

export type ContabilizarDespachoResult =
  | { ok: true; asientoNumero: number }
  | { ok: false; error: string };

export async function contabilizarDespachoAction(
  despachoId: string,
): Promise<ContabilizarDespachoResult> {
  if (!despachoId || typeof despachoId !== "string") {
    return { ok: false, error: "ID inválido." };
  }
  try {
    const result = await db.$transaction(async (tx) => {
      const despachoCheck = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: { embarqueId: true, estado: true },
      });
      if (!despachoCheck) {
        throw new AsientoError("DOMINIO_INVALIDO", "Despacho no existe.");
      }
      if (despachoCheck.estado !== "BORRADOR") {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `Despacho no está en BORRADOR (${despachoCheck.estado}).`,
        );
      }

      const embarque = await tx.embarque.findUnique({
        where: { id: despachoCheck.embarqueId },
        select: {
          id: true,
          codigo: true,
          tipoCambio: true,
          depositoDestinoId: true,
          asientoZonaPrimariaId: true,
          depositoZonaPrimariaId: true,
        },
      });
      if (!embarque?.depositoDestinoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Embarque ${embarque?.codigo}: definí depósito destino antes de contabilizar.`,
        );
      }

      // Fork por contenido: si alguna línea tiene itemContenedorId, es un
      // despacho CRUZADO (Fase 4) → asiento NACIONALIZACION_VIA_DF + stock
      // DF→destino. La detección es por datos (no por flag) porque la flag
      // pudo cambiar entre crear y contabilizar.
      const itemsFork = await tx.itemDespacho.findMany({
        where: { despachoId },
        select: { itemContenedorId: true },
      });
      const esCruzado = itemsFork.some((i) => i.itemContenedorId != null);

      if (esCruzado) {
        const asientoCruz = await crearAsientoDespachoCruzado(despachoId, tx);
        const contabilizadoCruz = await contabilizarAsiento(asientoCruz.id, tx);

        const despCruz = await tx.despacho.findUniqueOrThrow({
          where: { id: despachoId },
          select: {
            codigo: true,
            fecha: true,
            items: {
              select: {
                cantidad: true,
                itemContenedor: {
                  select: {
                    productoId: true,
                    costoFCUnitario: true,
                    contenedor: { select: { depositoFiscalId: true } },
                  },
                },
              },
            },
          },
        });

        const tcEmb = toDecimal(embarque.tipoCambio);
        const itemsDF = despCruz.items.map((i) => {
          const ic = i.itemContenedor;
          if (!ic?.contenedor.depositoFiscalId) {
            throw new AsientoError(
              "DOMINIO_INVALIDO",
              "Una línea cruzada no tiene depósito fiscal de origen asignado.",
            );
          }
          if (ic.costoFCUnitario == null) {
            throw new AsientoError(
              "DOMINIO_INVALIDO",
              "Una línea cruzada no tiene costo FC (cerrá costos antes de nacionalizar).",
            );
          }
          return {
            productoId: ic.productoId,
            cantidad: i.cantidad,
            costoUnitario: toDecimal(ic.costoFCUnitario).times(tcEmb),
            depositoFiscalId: ic.contenedor.depositoFiscalId,
          };
        });

        await aplicarNacionalizacionDF(tx, {
          despachoId,
          despachoCodigo: despCruz.codigo,
          depositoDestinoId: embarque.depositoDestinoId,
          fecha: despCruz.fecha,
          items: itemsDF,
        });

        await tx.despacho.update({ where: { id: despachoId }, data: { estado: "CONTABILIZADO" } });
        await crearOActualizarVepDespacho(tx, despachoId);
        return { asientoNumero: contabilizadoCruz.numero };
      }

      const asiento = await crearAsientoDespacho(despachoId, tx);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // Cargar items del despacho con producto + costo recalculado
      const despachoConItems = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: {
          codigo: true,
          fecha: true,
          items: {
            select: {
              id: true,
              cantidad: true,
              costoUnitario: true,
              itemEmbarque: { select: { id: true, productoId: true, costoUnitario: true } },
            },
          },
        },
      });
      if (!despachoConItems) {
        throw new AsientoError("DOMINIO_INVALIDO", "Despacho no existe.");
      }

      if (embarque.asientoZonaPrimariaId) {
        // Flujo modular: stock ya está en ZPA (ingresado al confirmar ZP).
        // Transferir cantidad despachada ZPA → destino preservando el costo
        // original del ItemEmbarque (no el promedio mezclado de la ZPA).
        const depositoZpa = await resolverDepositoZpa(tx, {
          codigo: embarque.codigo,
          depositoZonaPrimariaId: embarque.depositoZonaPrimariaId,
        });

        // Defensa en profundidad: validar stock disponible en ZPA antes
        // de transferir. Si la confirmación ZP no creó stock (embarque
        // legacy pre-Fase B sin backfill), falla acá con mensaje claro.
        for (const it of despachoConItems.items) {
          await validarDisponible(tx, it.itemEmbarque.productoId, depositoZpa.id, it.cantidad);
        }

        await aplicarTransferenciaDespacho(tx, {
          despachoId,
          despachoCodigo: despachoConItems.codigo,
          depositoZpaId: depositoZpa.id,
          depositoDestinoId: embarque.depositoDestinoId,
          fecha: despachoConItems.fecha,
          items: despachoConItems.items.map((i) => ({
            productoId: i.itemEmbarque.productoId,
            cantidad: i.cantidad,
            // Usa costoUnitario del ItemEmbarque (preservado en Fase B
            // al confirmar ZP), no el costo del rateio actual.
            costoUnitario: toDecimal(i.itemEmbarque.costoUnitario),
          })),
        });
      } else {
        // Flujo legacy: sin Zona Primaria previa. Stock ingresa
        // directamente al destino (puede ser NACIONAL o cualquier otro).
        await aplicarIngresoDespacho(tx, {
          depositoDestinoId: embarque.depositoDestinoId,
          fecha: despachoConItems.fecha,
          items: despachoConItems.items.map((i) => ({
            itemDespachoId: i.id,
            productoId: i.itemEmbarque.productoId,
            cantidad: i.cantidad,
            costoUnitario: toDecimal(i.costoUnitario),
          })),
        });
      }

      await tx.despacho.update({
        where: { id: despachoId },
        data: { estado: "CONTABILIZADO" },
      });

      // Auto-generar VepDespacho con la suma de tributos en ARS
      // (montos del despacho × TC del despacho). El operador lo paga
      // luego via pagarVepDespachoAction (Tesorería).
      await crearOActualizarVepDespacho(tx, despachoId);

      return { asientoNumero: contabilizado.numero };
    });

    revalidatePath("/comex/embarques");
    revalidatePath("/contabilidad/asientos");
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("contabilizarDespachoAction failed", err);
    return { ok: false, error: "Error inesperado al contabilizar." };
  }
}

// ============================================================
// Anular despacho — anula asiento + revierte stock + libera facturas
// ============================================================

export type AnularDespachoResult = { ok: true } | { ok: false; error: string };

export async function anularDespachoAction(despachoId: string): Promise<AnularDespachoResult> {
  if (!despachoId || typeof despachoId !== "string") {
    return { ok: false, error: "ID inválido." };
  }
  try {
    await db.$transaction(async (tx) => {
      const d = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: {
          id: true,
          codigo: true,
          estado: true,
          asientoId: true,
          embarque: {
            select: {
              id: true,
              codigo: true,
              depositoDestinoId: true,
              asientoZonaPrimariaId: true,
            },
          },
          items: {
            select: {
              cantidad: true,
              itemContenedorId: true,
              itemEmbarque: { select: { productoId: true } },
            },
          },
        },
      });
      if (!d) {
        throw new AsientoError("DOMINIO_INVALIDO", "Despacho no existe.");
      }
      if (d.estado === "ANULADO") {
        throw new AsientoError("ESTADO_INVALIDO", "Despacho ya está anulado.");
      }

      // Fork por contenido: si alguna línea tiene itemContenedorId es un
      // despacho CRUZADO (Fase 4) → la reversión de stock es la transferencia
      // DF→destino y además hay que devolver los counters de ItemContenedor
      // (cantidadDespachada → cantidadDisponible), incluso en BORRADOR (los
      // counters se consumieron al materializar, antes de contabilizar).
      const esCruzado = d.items.some((it) => it.itemContenedorId != null);

      if (esCruzado) {
        if (d.asientoId) {
          // Contabilizado: revertir stock DF→destino + anular asiento.
          if (d.embarque.depositoDestinoId) {
            for (const it of d.items) {
              await validarDisponible(
                tx,
                it.itemEmbarque.productoId,
                d.embarque.depositoDestinoId,
                it.cantidad,
              );
            }
          }
          // revertirTransferenciaDespacho borra las Transferencia +
          // MovimientoStock ligadas al despacho (sirve igual para la
          // nacionalización DF→destino del flujo cruzado).
          await revertirTransferenciaDespacho(tx, despachoId);
          await anularAsiento(d.asientoId, tx);
        }
        // Counters: siempre (BORRADOR o CONTABILIZADO).
        await revertirCountersDespacho(tx, despachoId);
      } else if (d.asientoId) {
        const usoFlujoZpa = !!d.embarque.asientoZonaPrimariaId;

        if (usoFlujoZpa && d.embarque.depositoDestinoId) {
          // Defensa en profundidad: si la mercadería ya fue vendida/
          // entregada desde el destino, revertir generaría stock negativo.
          // Validamos disponibilidad en el destino antes de revertir.
          for (const it of d.items) {
            await validarDisponible(
              tx,
              it.itemEmbarque.productoId,
              d.embarque.depositoDestinoId,
              it.cantidad,
            );
          }
          await revertirTransferenciaDespacho(tx, despachoId);
        } else {
          // Flujo legacy: stock ingresó directo al destino sin pasar por ZPA.
          await revertirIngresoDespacho(tx, despachoId);
        }

        await anularAsiento(d.asientoId, tx);
      }

      await tx.despacho.update({
        where: { id: despachoId },
        data: { estado: "ANULADO" },
      });

      // Marcar VepDespacho como ANULADO (no eliminarlo — preserva trail).
      // Si ya estaba PAGADO, no se anula automáticamente — el operador
      // debe revertir el pago primero. Detectamos eso aquí.
      const vep = await tx.vepDespacho.findUnique({
        where: { despachoId },
        select: { id: true, estado: true },
      });
      if (vep) {
        if (vep.estado === "PAGADO") {
          throw new AsientoError(
            "ESTADO_INVALIDO",
            "El VEP de este despacho ya fue pagado. Anule el pago en Tesorería antes de anular el despacho.",
          );
        }
        await tx.vepDespacho.delete({ where: { id: vep.id } });
      }

      // Liberar facturas linkadas para que puedan asignarse a un nuevo
      // despacho.
      await tx.embarqueCosto.updateMany({
        where: { despachoId },
        data: { despachoId: null },
      });
    });

    revalidatePath("/comex/embarques");
    revalidatePath("/contabilidad/asientos");
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError || err instanceof DespachoParcialError) {
      return { ok: false, error: err.message };
    }
    console.error("anularDespachoAction failed", err);
    return { ok: false, error: "Error inesperado al anular." };
  }
}

// ============================================================
// Eliminar despacho BORRADOR (sin asiento) — limpia ItemDespacho
// y libera facturas. NO permitido si está CONTABILIZADO.
// ============================================================

export type EliminarDespachoResult = { ok: true } | { ok: false; error: string };

export async function eliminarDespachoAction(despachoId: string): Promise<EliminarDespachoResult> {
  if (!despachoId || typeof despachoId !== "string") {
    return { ok: false, error: "ID inválido." };
  }
  try {
    await db.$transaction(async (tx) => {
      const d = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: {
          id: true,
          estado: true,
          embarqueId: true,
          items: {
            select: { itemContenedorId: true },
            take: 1,
            where: { itemContenedorId: { not: null } },
          },
        },
      });
      if (!d) {
        throw new AsientoError("DOMINIO_INVALIDO", "Despacho no existe.");
      }
      if (d.estado !== "BORRADOR") {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          "Sólo se eliminan despachos en BORRADOR. Para uno contabilizado, anulá.",
        );
      }
      // Borrador cruzado: devolver los counters (cantidadDespachada →
      // cantidadDisponible) antes de borrar, o quedarían inflados (la
      // materialización ya los había consumido). El delete en cascada
      // borra los ItemDespacho — por eso revertimos primero.
      if (d.items.length > 0) {
        await revertirCountersDespacho(tx, despachoId);
      }
      await tx.embarqueCosto.updateMany({
        where: { despachoId },
        data: { despachoId: null },
      });
      // ItemDespacho cascade borra al borrar el Despacho.
      await tx.despacho.delete({ where: { id: despachoId } });
    });
    revalidatePath("/comex/embarques");
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError || err instanceof DespachoParcialError) {
      return { ok: false, error: err.message };
    }
    console.error("eliminarDespachoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar." };
  }
}

// ============================================================
// VEP Despacho — generación al contabilizar
// ============================================================

/**
 * Crea o actualiza el VepDespacho asociado a un despacho recién
 * contabilizado. El monto total son los tributos aduaneros del despacho
 * (DIE + Tasa + Arancel + IVA + IVA Adic + IIBB + Ganancias) convertidos
 * a ARS via el TC oficializado del despacho.
 *
 * Idempotente: si ya existe un VEP en estado GENERADO para este despacho,
 * actualiza el montoTotal (caso re-contabilización tras anulación). No
 * toca VEPs PAGADO (situación anómala — el caller debe validar antes).
 */
async function crearOActualizarVepDespacho(
  tx: Prisma.TransactionClient,
  despachoId: string,
): Promise<void> {
  const d = await tx.despacho.findUnique({
    where: { id: despachoId },
    select: {
      tipoCambio: true,
      die: true,
      tasaEstadistica: true,
      arancelSim: true,
      iva: true,
      ivaAdicional: true,
      iibb: true,
      ganancias: true,
    },
  });
  if (!d) return;

  const tc = toDecimal(d.tipoCambio);
  const montoTotal = toDecimal(d.die)
    .plus(toDecimal(d.tasaEstadistica))
    .plus(toDecimal(d.arancelSim))
    .plus(toDecimal(d.iva))
    .plus(toDecimal(d.ivaAdicional))
    .plus(toDecimal(d.iibb))
    .plus(toDecimal(d.ganancias))
    .times(tc)
    .toDecimalPlaces(2);

  await tx.vepDespacho.upsert({
    where: { despachoId },
    create: {
      despachoId,
      montoTotal: money(montoTotal),
      estado: "GENERADO",
    },
    update: {
      // Solo actualiza si está en GENERADO; el caller ya validó que no
      // está en PAGADO.
      montoTotal: money(montoTotal),
    },
  });
}
