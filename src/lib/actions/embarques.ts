"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import { calcularCif, calcularRateioEmbarque } from "@/lib/services/comex";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoEmbarque,
} from "@/lib/services/asiento-automatico";
import { aplicarIngresoEmbarque } from "@/lib/services/stock";
import type { ProveedorOption } from "@/components/proveedor-combobox";
import type { ProductoOption } from "@/components/producto-combobox";
import {
  EmbarqueEstado,
  Moneda,
  Prisma,
} from "@/generated/prisma/client";

export type EmbarqueRow = {
  id: string;
  codigo: string;
  estado: EmbarqueEstado;
  moneda: Moneda;
  tipoCambio: string;
  fobTotal: string;
  cifTotal: string;
  costoTotal: string;
  proveedor: {
    id: string;
    nombre: string;
    pais: string;
  };
  itemsCount: number;
  createdAt: string;
};

export type EmbarqueListFilters = {
  estado?: EmbarqueEstado;
  moneda?: Moneda;
  proveedorId?: string;
};

export async function listarEmbarques(
  filtros?: EmbarqueListFilters,
): Promise<EmbarqueRow[]> {
  const where: Prisma.EmbarqueWhereInput = {};
  if (filtros?.estado) where.estado = filtros.estado;
  if (filtros?.moneda) where.moneda = filtros.moneda;
  if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;

  const embarques = await db.embarque.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      proveedor: { select: { id: true, nombre: true, pais: true } },
      _count: { select: { items: true } },
    },
  });

  return embarques.map((e) => ({
    id: e.id,
    codigo: e.codigo,
    estado: e.estado,
    moneda: e.moneda,
    tipoCambio: e.tipoCambio.toString(),
    fobTotal: e.fobTotal.toString(),
    cifTotal: e.cifTotal.toString(),
    costoTotal: e.costoTotal.toString(),
    proveedor: e.proveedor,
    itemsCount: e._count.items,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function listarProveedoresParaEmbarque(): Promise<ProveedorOption[]> {
  const proveedores = await db.proveedor.findMany({
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, pais: true },
  });
  return proveedores;
}

export type DepositoOption = {
  id: string;
  nombre: string;
};

export async function listarDepositosParaEmbarque(): Promise<DepositoOption[]> {
  const depositos = await db.deposito.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true },
  });
  return depositos;
}

export async function listarProductosParaEmbarque(): Promise<ProductoOption[]> {
  const productos = await db.producto.findMany({
    orderBy: { codigo: "asc" },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      marca: true,
      medida: true,
    },
  });
  return productos;
}

export type EmbarqueDetalle = {
  id: string;
  codigo: string;
  proveedorId: string;
  depositoDestinoId: string | null;
  estado: EmbarqueEstado;
  moneda: Moneda;
  tipoCambio: string;
  fobTotal: string;
  flete: string;
  seguro: string;
  cifTotal: string;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva: string;
  ivaAdicional: string;
  ganancias: string;
  iibb: string;
  gastosPortuarios: string;
  honorariosDespachante: string;
  costoTotal: string;
  asiento: {
    id: string;
    numero: number;
    estado: string;
  } | null;
  items: Array<{
    id: number;
    productoId: string;
    cantidad: number;
    precioUnitarioFob: string;
  }>;
};

export async function obtenerEmbarquePorId(
  id: string,
): Promise<EmbarqueDetalle | null> {
  const embarque = await db.embarque.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      asiento: { select: { id: true, numero: true, estado: true } },
    },
  });

  if (!embarque) return null;

  return {
    id: embarque.id,
    codigo: embarque.codigo,
    proveedorId: embarque.proveedorId,
    depositoDestinoId: embarque.depositoDestinoId,
    estado: embarque.estado,
    moneda: embarque.moneda,
    tipoCambio: embarque.tipoCambio.toString(),
    fobTotal: embarque.fobTotal.toString(),
    flete: embarque.flete.toString(),
    seguro: embarque.seguro.toString(),
    cifTotal: embarque.cifTotal.toString(),
    die: embarque.die.toString(),
    tasaEstadistica: embarque.tasaEstadistica.toString(),
    arancelSim: embarque.arancelSim.toString(),
    iva: embarque.iva.toString(),
    ivaAdicional: embarque.ivaAdicional.toString(),
    ganancias: embarque.ganancias.toString(),
    iibb: embarque.iibb.toString(),
    gastosPortuarios: embarque.gastosPortuarios.toString(),
    honorariosDespachante: embarque.honorariosDespachante.toString(),
    costoTotal: embarque.costoTotal.toString(),
    asiento: embarque.asiento
      ? {
          id: embarque.asiento.id,
          numero: embarque.asiento.numero,
          estado: embarque.asiento.estado,
        }
      : null,
    items: embarque.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitarioFob: it.precioUnitarioFob.toString(),
    })),
  };
}

export async function generarCodigoEmbarque(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `EMB-${year}-`;

  const ultimo = await db.embarque.findFirst({
    where: { codigo: { startsWith: prefix } },
    orderBy: { codigo: "desc" },
    select: { codigo: true },
  });

  let next = 1;
  if (ultimo) {
    const suffix = ultimo.codigo.slice(prefix.length);
    const parsed = parseInt(suffix, 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  return `${prefix}${String(next).padStart(3, "0")}`;
}

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const inputSchema = z
  .object({
    id: z.string().uuid().optional(),
    codigo: z.string().min(1, "Código requerido").max(32),
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    depositoDestinoId: z.string().uuid("Seleccione un depósito de destino"),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
    estado: z.nativeEnum(EmbarqueEstado),
    flete: z.string().regex(moneyRegex, "Valor inválido"),
    seguro: z.string().regex(moneyRegex, "Valor inválido"),
    die: z.string().regex(moneyRegex, "Valor inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Valor inválido"),
    arancelSim: z.string().regex(moneyRegex, "Valor inválido"),
    iva: z.string().regex(moneyRegex, "Valor inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Valor inválido"),
    ganancias: z.string().regex(moneyRegex, "Valor inválido"),
    iibb: z.string().regex(moneyRegex, "Valor inválido"),
    gastosPortuarios: z.string().regex(moneyRegex, "Valor inválido"),
    honorariosDespachante: z.string().regex(moneyRegex, "Valor inválido"),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid("Seleccione un producto"),
          cantidad: z.number().int().positive("Cantidad > 0"),
          precioUnitarioFob: z.string().regex(moneyRegex, "Valor inválido"),
        }),
      )
      .min(1, "Agregue al menos un ítem"),
  })
  .superRefine((data, ctx) => {
    if (data.estado === EmbarqueEstado.CERRADO) {
      ctx.addIssue({
        code: "custom",
        path: ["estado"],
        message:
          "Para cerrar el embarque utilice la acción 'Cerrar y Contabilizar'.",
      });
    }
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, tipo de cambio debe ser 1",
      });
    }
  });

export type GuardarEmbarqueInput = z.infer<typeof inputSchema>;

export type GuardarEmbarqueResult =
  | { ok: true; id: string; codigo: string }
  | { ok: false; error: string };

export async function guardarEmbarqueAction(
  raw: GuardarEmbarqueInput,
): Promise<GuardarEmbarqueResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `${first.path.join(".")}: ${first.message}`,
    };
  }
  const input = parsed.data;

  const fobTotal = sumMoney(
    input.items.map((it) =>
      toDecimal(it.precioUnitarioFob).times(it.cantidad),
    ),
  );
  const cifTotal = calcularCif(fobTotal, input.flete, input.seguro);
  const costoTotal = sumMoney([
    fobTotal,
    input.flete,
    input.seguro,
    input.die,
    input.tasaEstadistica,
    input.arancelSim,
    input.gastosPortuarios,
    input.honorariosDespachante,
  ]);

  const data = {
    codigo: input.codigo,
    proveedorId: input.proveedorId,
    depositoDestinoId: input.depositoDestinoId,
    estado: input.estado,
    moneda: input.moneda,
    tipoCambio: new Prisma.Decimal(input.tipoCambio),
    fobTotal: money(fobTotal),
    flete: money(input.flete),
    seguro: money(input.seguro),
    cifTotal: money(cifTotal),
    die: money(input.die),
    tasaEstadistica: money(input.tasaEstadistica),
    arancelSim: money(input.arancelSim),
    iva: money(input.iva),
    ivaAdicional: money(input.ivaAdicional),
    ganancias: money(input.ganancias),
    iibb: money(input.iibb),
    gastosPortuarios: money(input.gastosPortuarios),
    honorariosDespachante: money(input.honorariosDespachante),
    costoTotal: money(costoTotal),
  };

  try {
    const saved = await db.$transaction(async (tx) => {
      if (input.id) {
        const actual = await tx.embarque.findUnique({
          where: { id: input.id },
          select: { estado: true },
        });
        if (actual?.estado === EmbarqueEstado.CERRADO) {
          throw new Error(
            "El embarque está CERRADO y no puede editarse. Anule el asiento primero.",
          );
        }
        const embarque = await tx.embarque.update({
          where: { id: input.id },
          data,
        });
        await tx.itemEmbarque.deleteMany({
          where: { embarqueId: embarque.id },
        });
        await tx.itemEmbarque.createMany({
          data: input.items.map((it) => ({
            embarqueId: embarque.id,
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitarioFob: money(it.precioUnitarioFob),
          })),
        });
        return embarque;
      }

      return tx.embarque.create({
        data: {
          ...data,
          items: {
            create: input.items.map((it) => ({
              productoId: it.productoId,
              cantidad: it.cantidad,
              precioUnitarioFob: money(it.precioUnitarioFob),
            })),
          },
        },
      });
    });

    revalidatePath("/comex/embarques");
    revalidatePath(`/comex/embarques/${saved.id}`);

    return { ok: true, id: saved.id, codigo: saved.codigo };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        ok: false,
        error: `El código "${input.codigo}" ya está en uso.`,
      };
    }
    if (err instanceof Error && err.message.includes("CERRADO")) {
      return { ok: false, error: err.message };
    }
    console.error("guardarEmbarqueAction", err);
    return {
      ok: false,
      error: "No se pudo guardar el embarque. Intente nuevamente.",
    };
  }
}

// ============================================================
// Cierre y contabilización (PASO 4)
// ============================================================

export type CerrarEmbarqueResult =
  | { ok: true; asientoId: string; asientoNumero: number }
  | { ok: false; error: string };

export async function cerrarYContabilizarEmbarqueAction(
  embarqueId: string,
): Promise<CerrarEmbarqueResult> {
  if (!embarqueId || typeof embarqueId !== "string") {
    return { ok: false, error: "ID de embarque inválido." };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const embarque = await tx.embarque.findUnique({
        where: { id: embarqueId },
        include: { items: { orderBy: { id: "asc" } } },
      });

      if (!embarque) {
        throw new AsientoError("DOMINIO_INVALIDO", "El embarque no existe.");
      }
      if (embarque.estado === EmbarqueEstado.CERRADO) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} ya está CERRADO.`,
        );
      }
      if (embarque.asientoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo} ya tiene un asiento asociado.`,
        );
      }
      if (!embarque.depositoDestinoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo} no tiene depósito de destino asignado.`,
        );
      }
      if (embarque.items.length === 0) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo} no tiene ítems.`,
        );
      }

      const asiento = await crearAsientoEmbarque(embarqueId, tx);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      const rateio = calcularRateioEmbarque(
        {
          fobTotal: embarque.fobTotal,
          flete: embarque.flete,
          seguro: embarque.seguro,
          die: embarque.die,
          tasaEstadistica: embarque.tasaEstadistica,
          arancelSim: embarque.arancelSim,
          gastosPortuarios: embarque.gastosPortuarios,
          honorariosDespachante: embarque.honorariosDespachante,
        },
        embarque.items.map((it) => ({
          id: it.id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitarioFob: it.precioUnitarioFob,
        })),
      );

      await aplicarIngresoEmbarque(tx, {
        depositoDestinoId: embarque.depositoDestinoId,
        fecha: new Date(),
        items: rateio.map((r) => ({
          itemEmbarqueId: r.id,
          productoId: r.productoId,
          cantidad: r.cantidad,
          costoUnitario: r.costoUnitario,
        })),
      });

      await tx.embarque.update({
        where: { id: embarqueId },
        data: { estado: EmbarqueEstado.CERRADO },
      });

      return {
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
      };
    });

    revalidatePath("/comex/embarques");
    revalidatePath(`/comex/embarques/${embarqueId}`);
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("cerrarYContabilizarEmbarqueAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al cerrar el embarque.",
    };
  }
}

function mapAsientoErrorMessage(err: AsientoError): string {
  switch (err.code) {
    case "DESBALANCEADO":
      return "El asiento está desbalanceado: Debe ≠ Haber.";
    case "LINEA_INVALIDA":
      return err.message;
    case "CUENTA_INVALIDA":
      return err.message;
    case "CUENTA_INACTIVA":
      return "Una cuenta contable está inactiva.";
    case "CUENTA_SINTETICA":
      return "Una cuenta contable es sintética.";
    case "PERIODO_INEXISTENTE":
      return "No hay período contable ABIERTO para la fecha actual.";
    case "PERIODO_CERRADO":
      return "El período contable está cerrado.";
    case "ASIENTO_INEXISTENTE":
      return "El asiento no existe.";
    case "ESTADO_INVALIDO":
      return err.message;
    case "NUMERACION_FALHOU":
      return "No se pudo asignar número al asiento. Reintente.";
    case "DOMINIO_INVALIDO":
      return err.message;
    default:
      return err.message;
  }
}
