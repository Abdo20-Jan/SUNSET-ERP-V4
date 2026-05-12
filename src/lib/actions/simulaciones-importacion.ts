"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, toDecimal } from "@/lib/decimal";
import type { ProveedorOption } from "@/components/proveedor-combobox";
import type { ProductoOption } from "@/components/producto-combobox";
import { Incoterm, Moneda, TipoCostoEmbarque } from "@/generated/prisma/client";

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

export type SimulacionRow = {
  id: string;
  codigo: string;
  nombre: string | null;
  moneda: Moneda;
  tipoCambio: string;
  incoterm: Incoterm | null;
  proveedor: { id: string; nombre: string; pais: string } | null;
  itemsCount: number;
  fobTotal: string;
  costoTotalNacionalizado: string;
  createdAt: string;
};

export type SimulacionItemDetalle = {
  id: number;
  productoId: string | null;
  descripcionLibre: string | null;
  cantidad: number;
  precioUnitarioFob: string;
  precioVentaUnitario: string | null;
};

export type SimulacionCostoDetalle = {
  id: number;
  tipo: TipoCostoEmbarque;
  descripcion: string | null;
  subtotal: string;
  moneda: Moneda;
  tipoCambio: string;
};

export type SimulacionDetalle = {
  id: string;
  codigo: string;
  nombre: string | null;
  proveedorId: string | null;
  moneda: Moneda;
  tipoCambio: string;
  incoterm: Incoterm | null;
  lugarIncoterm: string | null;
  valorFleteOrigen: string | null;
  valorSeguroOrigen: string | null;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva: string;
  ivaAdicional: string;
  ganancias: string;
  iibb: string;
  notas: string | null;
  items: SimulacionItemDetalle[];
  costos: SimulacionCostoDetalle[];
  createdAt: string;
  updatedAt: string;
};

export async function listarSimulaciones(): Promise<SimulacionRow[]> {
  const rows = await db.simulacionImportacion.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      proveedor: { select: { id: true, nombre: true, pais: true } },
      items: { select: { cantidad: true, precioUnitarioFob: true } },
      costos: { select: { subtotal: true, tipoCambio: true } },
    },
  });

  return rows.map((s) => {
    const fobTotal = s.items.reduce(
      (acc, it) => acc.plus(toDecimal(it.precioUnitarioFob).times(it.cantidad)),
      toDecimal(0),
    );
    const tcEmb = toDecimal(s.tipoCambio);
    const fobArs = fobTotal.times(tcEmb);
    const fleteOrigenArs = s.valorFleteOrigen
      ? toDecimal(s.valorFleteOrigen).times(tcEmb)
      : toDecimal(0);
    const seguroOrigenArs = s.valorSeguroOrigen
      ? toDecimal(s.valorSeguroOrigen).times(tcEmb)
      : toDecimal(0);
    const costosArs = s.costos.reduce(
      (acc, c) => acc.plus(toDecimal(c.subtotal).times(toDecimal(c.tipoCambio))),
      toDecimal(0),
    );
    const tributosArs = toDecimal(s.die)
      .plus(toDecimal(s.tasaEstadistica))
      .plus(toDecimal(s.arancelSim))
      .times(tcEmb);
    const costoTotal = fobArs
      .plus(fleteOrigenArs)
      .plus(seguroOrigenArs)
      .plus(costosArs)
      .plus(tributosArs);

    return {
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      moneda: s.moneda,
      tipoCambio: s.tipoCambio.toString(),
      incoterm: s.incoterm,
      proveedor: s.proveedor,
      itemsCount: s.items.length,
      fobTotal: fobTotal.toDecimalPlaces(2).toString(),
      costoTotalNacionalizado: costoTotal.toDecimalPlaces(2).toString(),
      createdAt: s.createdAt.toISOString(),
    };
  });
}

export async function obtenerSimulacionPorId(id: string): Promise<SimulacionDetalle | null> {
  const s = await db.simulacionImportacion.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      costos: { orderBy: { id: "asc" } },
    },
  });
  if (!s) return null;
  return {
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    proveedorId: s.proveedorId,
    moneda: s.moneda,
    tipoCambio: s.tipoCambio.toString(),
    incoterm: s.incoterm,
    lugarIncoterm: s.lugarIncoterm,
    valorFleteOrigen: s.valorFleteOrigen?.toString() ?? null,
    valorSeguroOrigen: s.valorSeguroOrigen?.toString() ?? null,
    die: s.die.toString(),
    tasaEstadistica: s.tasaEstadistica.toString(),
    arancelSim: s.arancelSim.toString(),
    iva: s.iva.toString(),
    ivaAdicional: s.ivaAdicional.toString(),
    ganancias: s.ganancias.toString(),
    iibb: s.iibb.toString(),
    notas: s.notas,
    items: s.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      descripcionLibre: it.descripcionLibre,
      cantidad: it.cantidad,
      precioUnitarioFob: it.precioUnitarioFob.toString(),
      precioVentaUnitario: it.precioVentaUnitario?.toString() ?? null,
    })),
    costos: s.costos.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      descripcion: c.descripcion,
      subtotal: c.subtotal.toString(),
      moneda: c.moneda,
      tipoCambio: c.tipoCambio.toString(),
    })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function generarCodigoSimulacion(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SIM-${year}-`;
  const ultimo = await db.simulacionImportacion.findFirst({
    where: { codigo: { startsWith: prefix } },
    orderBy: { codigo: "desc" },
    select: { codigo: true },
  });
  let next = 1;
  if (ultimo) {
    const parsed = Number.parseInt(ultimo.codigo.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function listarProveedoresParaSimulacion(): Promise<ProveedorOption[]> {
  return db.proveedor.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      pais: true,
      cuentaGastoContableId: true,
      tipoProveedor: true,
    },
  });
}

export async function listarProductosParaSimulacion(): Promise<ProductoOption[]> {
  return db.producto.findMany({
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, marca: true, medida: true },
  });
}

const itemSchema = z.object({
  productoId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  descripcionLibre: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  cantidad: z.number().int().positive("Cantidad > 0"),
  precioUnitarioFob: z.string().regex(moneyRegex, "FOB inválido"),
  precioVentaUnitario: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
    .refine((v) => v === null || moneyRegex.test(v), "Precio venta inválido"),
});

const costoSchema = z.object({
  tipo: z.nativeEnum(TipoCostoEmbarque),
  descripcion: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
  moneda: z.nativeEnum(Moneda),
  tipoCambio: z.string().regex(rateRegex, "TC inválido"),
});

const inputSchema = z
  .object({
    id: z.string().uuid().optional(),
    codigo: z.string().trim().min(1, "Código requerido").max(32),
    nombre: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    proveedorId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    incoterm: z
      .nativeEnum(Incoterm)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    lugarIncoterm: z
      .string()
      .max(80)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    valorFleteOrigen: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine((v) => v === null || moneyRegex.test(v), "Flete origen inválido"),
    valorSeguroOrigen: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine((v) => v === null || moneyRegex.test(v), "Seguro origen inválido"),
    die: z.string().regex(moneyRegex, "Inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Inválido"),
    arancelSim: z.string().regex(moneyRegex, "Inválido"),
    iva: z.string().regex(moneyRegex, "Inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Inválido"),
    ganancias: z.string().regex(moneyRegex, "Inválido"),
    iibb: z.string().regex(moneyRegex, "Inválido"),
    notas: z
      .string()
      .max(2000)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    items: z.array(itemSchema).min(1, "Agregue al menos un ítem"),
    costos: z.array(costoSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
    data.costos.forEach((c, idx) => {
      if (c.moneda === Moneda.ARS && c.tipoCambio !== "1") {
        ctx.addIssue({
          code: "custom",
          path: ["costos", idx, "tipoCambio"],
          message: "Para ARS, TC=1",
        });
      }
    });
    data.items.forEach((it, idx) => {
      if (!it.productoId && !it.descripcionLibre) {
        ctx.addIssue({
          code: "custom",
          path: ["items", idx, "productoId"],
          message: "Indique producto o descripción libre",
        });
      }
    });
  });

export type GuardarSimulacionInput = z.input<typeof inputSchema>;

export type GuardarSimulacionResult =
  | { ok: true; id: string; codigo: string }
  | { ok: false; error: string };

export async function guardarSimulacionAction(
  raw: GuardarSimulacionInput,
): Promise<GuardarSimulacionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `${first.path.join(".")}: ${first.message}`,
    };
  }
  const input = parsed.data;

  try {
    const saved = await db.$transaction(async (tx) => {
      const data = {
        codigo: input.codigo,
        nombre: input.nombre,
        proveedorId: input.proveedorId,
        moneda: input.moneda,
        tipoCambio: toDecimal(input.tipoCambio).toDecimalPlaces(6).toString(),
        incoterm: input.incoterm,
        lugarIncoterm: input.lugarIncoterm,
        valorFleteOrigen: input.valorFleteOrigen ? money(input.valorFleteOrigen) : null,
        valorSeguroOrigen: input.valorSeguroOrigen ? money(input.valorSeguroOrigen) : null,
        die: money(input.die),
        tasaEstadistica: money(input.tasaEstadistica),
        arancelSim: money(input.arancelSim),
        iva: money(input.iva),
        ivaAdicional: money(input.ivaAdicional),
        ganancias: money(input.ganancias),
        iibb: money(input.iibb),
        notas: input.notas,
      };

      let id: string;
      if (input.id) {
        const existing = await tx.simulacionImportacion.findUnique({
          where: { id: input.id },
          select: { id: true },
        });
        if (!existing) throw new Error("Simulación no encontrada");
        await tx.simulacionImportacion.update({ where: { id: input.id }, data });
        await tx.itemSimulacionImportacion.deleteMany({ where: { simulacionId: input.id } });
        await tx.costoSimulacionImportacion.deleteMany({ where: { simulacionId: input.id } });
        id = input.id;
      } else {
        const created = await tx.simulacionImportacion.create({ data });
        id = created.id;
      }

      await tx.itemSimulacionImportacion.createMany({
        data: input.items.map((it) => ({
          simulacionId: id,
          productoId: it.productoId,
          descripcionLibre: it.descripcionLibre,
          cantidad: it.cantidad,
          precioUnitarioFob: money(it.precioUnitarioFob),
          precioVentaUnitario: it.precioVentaUnitario ? money(it.precioVentaUnitario) : null,
        })),
      });

      if (input.costos.length > 0) {
        await tx.costoSimulacionImportacion.createMany({
          data: input.costos.map((c) => ({
            simulacionId: id,
            tipo: c.tipo,
            descripcion: c.descripcion,
            subtotal: money(c.subtotal),
            moneda: c.moneda,
            tipoCambio: toDecimal(c.tipoCambio).toDecimalPlaces(6).toString(),
          })),
        });
      }

      return { id, codigo: input.codigo };
    });

    revalidatePath("/comex/simulaciones");
    revalidatePath(`/comex/simulaciones/${saved.id}`);
    return { ok: true, id: saved.id, codigo: saved.codigo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al guardar la simulación";
    return { ok: false, error: msg };
  }
}

export type EliminarSimulacionResult = { ok: true } | { ok: false; error: string };

export async function eliminarSimulacionAction(id: string): Promise<EliminarSimulacionResult> {
  try {
    await db.simulacionImportacion.delete({ where: { id } });
    revalidatePath("/comex/simulaciones");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al eliminar";
    return { ok: false, error: msg };
  }
}
