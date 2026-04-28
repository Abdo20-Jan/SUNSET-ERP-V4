"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, toDecimal } from "@/lib/decimal";
import {
  anularAsiento,
  AsientoError,
  contabilizarAsiento,
  crearAsientoDespacho,
} from "@/lib/services/asiento-automatico";
import {
  aplicarIngresoDespacho,
  revertirIngresoDespacho,
} from "@/lib/services/stock";
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

export async function listarDespachosDeEmbarque(
  embarqueId: string,
): Promise<DespachoListRow[]> {
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

export async function obtenerDespachoPorId(
  despachoId: string,
): Promise<DespachoDetalle | null> {
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
});

const decimalish = z.union([z.string(), z.number()]).transform((v) => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n >= 0 ? v.toString() : "0";
});

const crearDespachoSchema = z.object({
  embarqueId: z.string().min(1),
  fecha: z.union([z.string(), z.date()]),
  numeroOM: z.string().trim().optional().nullable(),
  tipoCambio: decimalish,
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

export async function crearDespachoAction(
  input: CrearDespachoInput,
): Promise<CrearDespachoResult> {
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
    const result = await db.$transaction(async (tx) => {
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
      const itemsEmbById = new Map(
        embarque.items.map((i) => [i.id, i.cantidad]),
      );
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
        const remanente =
          cantTotal - (yaDespachadoPorIE.get(it.itemEmbarqueId) ?? 0);
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
            throw new AsientoError(
              "DOMINIO_INVALIDO",
              `Factura ${fid} no existe.`,
            );
          }
          if (f.embarqueId !== embarque.id) {
            throw new AsientoError(
              "DOMINIO_INVALIDO",
              `Factura ${fid} no pertenece al embarque.`,
            );
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
    });

    revalidatePath(`/comex/embarques/${data.embarqueId}`);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
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
        select: { id: true, codigo: true, depositoDestinoId: true },
      });
      if (!embarque?.depositoDestinoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Embarque ${embarque?.codigo}: definí depósito destino antes de contabilizar.`,
        );
      }

      const asiento = await crearAsientoDespacho(despachoId, tx);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // Cargar items del despacho con producto + costo recalculado
      const despachoConItems = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: {
          fecha: true,
          items: {
            select: {
              id: true,
              cantidad: true,
              costoUnitario: true,
              itemEmbarque: { select: { productoId: true } },
            },
          },
        },
      });
      if (!despachoConItems) {
        throw new AsientoError("DOMINIO_INVALIDO", "Despacho no existe.");
      }

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

      await tx.despacho.update({
        where: { id: despachoId },
        data: { estado: "CONTABILIZADO" },
      });

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

export type AnularDespachoResult =
  | { ok: true }
  | { ok: false; error: string };

export async function anularDespachoAction(
  despachoId: string,
): Promise<AnularDespachoResult> {
  if (!despachoId || typeof despachoId !== "string") {
    return { ok: false, error: "ID inválido." };
  }
  try {
    await db.$transaction(async (tx) => {
      const d = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: { id: true, codigo: true, estado: true, asientoId: true },
      });
      if (!d) {
        throw new AsientoError("DOMINIO_INVALIDO", "Despacho no existe.");
      }
      if (d.estado === "ANULADO") {
        throw new AsientoError("ESTADO_INVALIDO", "Despacho ya está anulado.");
      }

      if (d.asientoId) {
        await anularAsiento(d.asientoId, tx);
        await revertirIngresoDespacho(tx, despachoId);
      }

      await tx.despacho.update({
        where: { id: despachoId },
        data: { estado: "ANULADO" },
      });

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
    if (err instanceof AsientoError) {
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

export type EliminarDespachoResult =
  | { ok: true }
  | { ok: false; error: string };

export async function eliminarDespachoAction(
  despachoId: string,
): Promise<EliminarDespachoResult> {
  if (!despachoId || typeof despachoId !== "string") {
    return { ok: false, error: "ID inválido." };
  }
  try {
    await db.$transaction(async (tx) => {
      const d = await tx.despacho.findUnique({
        where: { id: despachoId },
        select: { id: true, estado: true, embarqueId: true },
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
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("eliminarDespachoAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar." };
  }
}
