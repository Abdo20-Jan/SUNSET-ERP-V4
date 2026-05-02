"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import { calcularRateioEmbarque } from "@/lib/services/comex";
import {
  anularAsiento,
  AsientoError,
  contabilizarAsiento,
  crearAsientoEmbarque,
  crearAsientoZonaPrimaria,
} from "@/lib/services/asiento-automatico";
import { aplicarIngresoEmbarque } from "@/lib/services/stock";
import type { ProveedorOption } from "@/components/proveedor-combobox";
import type { ProductoOption } from "@/components/producto-combobox";
import type { CuentaOption } from "@/components/cuenta-combobox";
import {
  CuentaCategoria,
  CuentaTipo,
  EmbarqueEstado,
  Incoterm,
  Moneda,
  Prisma,
  TipoCostoEmbarque,
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
  incoterm: Incoterm | null;
  lugarIncoterm: string | null;
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

export type EmbarquesListPage = {
  rows: EmbarqueRow[];
  total: number;
};

export async function listarEmbarques(
  filtros?: EmbarqueListFilters & { page?: number; perPage?: number },
): Promise<EmbarquesListPage> {
  const where: Prisma.EmbarqueWhereInput = {};
  if (filtros?.estado) where.estado = filtros.estado;
  if (filtros?.moneda) where.moneda = filtros.moneda;
  if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;

  const page = Math.max(1, Math.floor(filtros?.page ?? 1));
  const perPage = Math.max(1, Math.min(500, Math.floor(filtros?.perPage ?? 50)));
  const skip = (page - 1) * perPage;

  const [embarques, total] = await Promise.all([
    db.embarque.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        proveedor: { select: { id: true, nombre: true, pais: true } },
        _count: { select: { items: true } },
      },
      take: perPage,
      skip,
    }),
    db.embarque.count({ where }),
  ]);

  return {
    rows: embarques.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      estado: e.estado,
      moneda: e.moneda,
      tipoCambio: e.tipoCambio.toString(),
      fobTotal: e.fobTotal.toString(),
      cifTotal: e.cifTotal.toString(),
      costoTotal: e.costoTotal.toString(),
      incoterm: e.incoterm,
      lugarIncoterm: e.lugarIncoterm,
      proveedor: e.proveedor,
      itemsCount: e._count.items,
      createdAt: e.createdAt.toISOString(),
    })),
    total,
  };
}

export async function listarProveedoresParaEmbarque(): Promise<ProveedorOption[]> {
  const proveedores = await db.proveedor.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      pais: true,
      cuentaGastoContableId: true,
      tipoProveedor: true,
    },
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

// Cuentas elegibles para "cuenta gasto" en costos logísticos: ANALITICA
// activa, de categoría EGRESO (5.x.x.x) o ACTIVO (1.x.x.x — para
// capitalizar como Mercaderías en tránsito).
export async function listarCuentasParaCostoLogistico(): Promise<CuentaOption[]> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
      categoria: { in: [CuentaCategoria.EGRESO, CuentaCategoria.ACTIVO] },
    },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });
  return cuentas.map((c) => ({
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
  }));
}

export type EmbarqueCostoLineaDetalle = {
  id: number;
  tipo: TipoCostoEmbarque;
  cuentaContableGastoId: number;
  descripcion: string | null;
  subtotal: string;
};

export type EmbarqueCostoDetalle = {
  id: number;
  proveedorId: string;
  moneda: Moneda;
  tipoCambio: string;
  facturaNumero: string | null;
  fechaFactura: string | null;
  momento: "ZONA_PRIMARIA" | "DESPACHO";
  iva: string;
  iibb: string;
  otros: string;
  notas: string | null;
  lineas: EmbarqueCostoLineaDetalle[];
};

export type EmbarqueDetalle = {
  id: string;
  codigo: string;
  proveedorId: string;
  depositoDestinoId: string | null;
  estado: EmbarqueEstado;
  moneda: Moneda;
  tipoCambio: string;
  incoterm: Incoterm | null;
  lugarIncoterm: string | null;
  valorFleteOrigen: string | null;
  valorSeguroOrigen: string | null;
  nombreBuque: string | null;
  lineaMaritima: string | null;
  fechaEmpaque: string | null;
  lugarTransbordo: string | null;
  fechaTransbordo: string | null;
  fechaSalida: string | null;
  fechaLlegada: string | null;
  diasPagoDespuesLlegada: number | null;
  fobTotal: string;
  cifTotal: string;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva: string;
  ivaAdicional: string;
  ganancias: string;
  iibb: string;
  costoTotal: string;
  asiento: {
    id: string;
    numero: number;
    estado: string;
  } | null;
  asientoZonaPrimaria: {
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
  costos: EmbarqueCostoDetalle[];
};

export async function obtenerEmbarquePorId(
  id: string,
): Promise<EmbarqueDetalle | null> {
  const embarque = await db.embarque.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      costos: {
        orderBy: { id: "asc" },
        include: { lineas: { orderBy: { id: "asc" } } },
      },
      asiento: { select: { id: true, numero: true, estado: true } },
      asientoZonaPrimaria: { select: { id: true, numero: true, estado: true } },
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
    incoterm: embarque.incoterm,
    lugarIncoterm: embarque.lugarIncoterm,
    valorFleteOrigen:
      embarque.valorFleteOrigen !== null
        ? embarque.valorFleteOrigen.toString()
        : null,
    valorSeguroOrigen:
      embarque.valorSeguroOrigen !== null
        ? embarque.valorSeguroOrigen.toString()
        : null,
    nombreBuque: embarque.nombreBuque,
    lineaMaritima: embarque.lineaMaritima,
    fechaEmpaque: embarque.fechaEmpaque?.toISOString() ?? null,
    lugarTransbordo: embarque.lugarTransbordo,
    fechaTransbordo: embarque.fechaTransbordo?.toISOString() ?? null,
    fechaSalida: embarque.fechaSalida?.toISOString() ?? null,
    fechaLlegada: embarque.fechaLlegada?.toISOString() ?? null,
    diasPagoDespuesLlegada: embarque.diasPagoDespuesLlegada,
    fobTotal: embarque.fobTotal.toString(),
    cifTotal: embarque.cifTotal.toString(),
    die: embarque.die.toString(),
    tasaEstadistica: embarque.tasaEstadistica.toString(),
    arancelSim: embarque.arancelSim.toString(),
    iva: embarque.iva.toString(),
    ivaAdicional: embarque.ivaAdicional.toString(),
    ganancias: embarque.ganancias.toString(),
    iibb: embarque.iibb.toString(),
    costoTotal: embarque.costoTotal.toString(),
    asiento: embarque.asiento
      ? {
          id: embarque.asiento.id,
          numero: embarque.asiento.numero,
          estado: embarque.asiento.estado,
        }
      : null,
    asientoZonaPrimaria: embarque.asientoZonaPrimaria
      ? {
          id: embarque.asientoZonaPrimaria.id,
          numero: embarque.asientoZonaPrimaria.numero,
          estado: embarque.asientoZonaPrimaria.estado,
        }
      : null,
    items: embarque.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitarioFob: it.precioUnitarioFob.toString(),
    })),
    costos: embarque.costos.map((c) => ({
      id: c.id,
      proveedorId: c.proveedorId,
      moneda: c.moneda,
      tipoCambio: c.tipoCambio.toString(),
      facturaNumero: c.facturaNumero,
      fechaFactura: c.fechaFactura?.toISOString() ?? null,
      momento: c.momento,
      iva: c.iva.toString(),
      iibb: c.iibb.toString(),
      otros: c.otros.toString(),
      notas: c.notas,
      lineas: c.lineas.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        cuentaContableGastoId: l.cuentaContableGastoId,
        descripcion: l.descripcion,
        subtotal: l.subtotal.toString(),
      })),
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

const costoLineaSchema = z.object({
  tipo: z.nativeEnum(TipoCostoEmbarque),
  cuentaContableGastoId: z.number().int().positive("Seleccione la cuenta"),
  descripcion: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
});

const costoSchema = z.object({
  proveedorId: z.string().uuid("Seleccione un proveedor"),
  moneda: z.nativeEnum(Moneda),
  tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
  facturaNumero: z
    .string()
    .max(64)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  fechaFactura: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.trim().length === 0) return null;
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    }),
  momento: z.enum(["ZONA_PRIMARIA", "DESPACHO"]).default("DESPACHO"),
  // IVA/IIBB/otros a nivel factura (no por línea)
  iva: z.string().regex(moneyRegex, "IVA inválido").default("0"),
  iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
  otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
  notas: z
    .string()
    .max(500)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  lineas: z.array(costoLineaSchema).min(1, "Agregue al menos un gasto"),
});

export type CostoEmbarqueLineaInput = z.input<typeof costoLineaSchema>;
export type CostoEmbarqueInput = z.input<typeof costoSchema>;

const inputSchema = z
  .object({
    id: z.string().uuid().optional(),
    codigo: z.string().min(1, "Código requerido").max(32),
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    depositoDestinoId: z.string().uuid("Seleccione un depósito de destino"),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
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
    // Valores informativos cuando incoterm = CIF (flete + seguro contratados
    // por el proveedor) o CFR (sólo flete). Vacíos = null.
    valorFleteOrigen: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine(
        (v) => v === null || moneyRegex.test(v),
        "Valor de flete inválido",
      ),
    valorSeguroOrigen: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine(
        (v) => v === null || moneyRegex.test(v),
        "Valor de seguro inválido",
      ),
    // Datos de transporte
    nombreBuque: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lineaMaritima: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lugarTransbordo: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    fechaEmpaque: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    fechaTransbordo: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    fechaSalida: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    fechaLlegada: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    diasPagoDespuesLlegada: z
      .union([z.number().int().min(0), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null || v === "") return null;
        const n = typeof v === "string" ? parseInt(v, 10) : v;
        return Number.isFinite(n) && n >= 0 ? n : null;
      }),
    estado: z.nativeEnum(EmbarqueEstado),
    die: z.string().regex(moneyRegex, "Valor inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Valor inválido"),
    arancelSim: z.string().regex(moneyRegex, "Valor inválido"),
    iva: z.string().regex(moneyRegex, "Valor inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Valor inválido"),
    ganancias: z.string().regex(moneyRegex, "Valor inválido"),
    iibb: z.string().regex(moneyRegex, "Valor inválido"),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid("Seleccione un producto"),
          cantidad: z.number().int().positive("Cantidad > 0"),
          precioUnitarioFob: z.string().regex(moneyRegex, "Valor inválido"),
        }),
      )
      .min(1, "Agregue al menos un ítem"),
    costos: z.array(costoSchema).default([]),
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
    data.costos.forEach((c, idx) => {
      if (c.moneda === Moneda.ARS && c.tipoCambio !== "1") {
        ctx.addIssue({
          code: "custom",
          path: ["costos", idx, "tipoCambio"],
          message: "Para ARS, tipo de cambio debe ser 1",
        });
      }
    });
  });

export type GuardarEmbarqueInput = z.input<typeof inputSchema>;

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

  // costoTotal del embarque (en ARS) = FOB×TC + flete/seguro origen×TC
  // (CIF/CFR) + Σ (subtotal de cada línea ×TC de su factura) + tributos
  // aduaneros×TC. Despacho llega en moneda del embarque, AFIP cobra en
  // pesos al cierre.
  const tcEmb = toDecimal(input.tipoCambio);
  const fobArs = toDecimal(fobTotal).times(tcEmb);
  const fleteOrigenArs = input.valorFleteOrigen
    ? toDecimal(input.valorFleteOrigen).times(tcEmb)
    : toDecimal(0);
  const seguroOrigenArs = input.valorSeguroOrigen
    ? toDecimal(input.valorSeguroOrigen).times(tcEmb)
    : toDecimal(0);
  const costosSubtotalArs = input.costos.reduce((acc, factura) => {
    const tc = toDecimal(factura.tipoCambio);
    const subtotalFactura = factura.lineas.reduce(
      (a, l) => a.plus(toDecimal(l.subtotal)),
      toDecimal(0),
    );
    return acc.plus(subtotalFactura.times(tc));
  }, toDecimal(0));
  const tributosArs = sumMoney([
    toDecimal(input.die).times(tcEmb),
    toDecimal(input.tasaEstadistica).times(tcEmb),
    toDecimal(input.arancelSim).times(tcEmb),
  ]);
  const costoTotal = sumMoney([
    fobArs,
    fleteOrigenArs,
    seguroOrigenArs,
    costosSubtotalArs,
    tributosArs,
  ]);

  // CIF: FOB + flete + seguro contratados en origen (CIF/CFR del proveedor)
  // + líneas locales tipo FLETE_INTERNACIONAL / SEGURO_MARITIMO. Es la base
  // imponible aduanera (sin tributos).
  function sumLineasPorTipo(tipo: TipoCostoEmbarque) {
    return input.costos.reduce((acc, factura) => {
      const tc = toDecimal(factura.tipoCambio);
      const sub = factura.lineas
        .filter((l) => l.tipo === tipo)
        .reduce((a, l) => a.plus(toDecimal(l.subtotal)), toDecimal(0));
      return acc.plus(sub.times(tc));
    }, toDecimal(0));
  }
  const fleteIntlArs = sumLineasPorTipo(TipoCostoEmbarque.FLETE_INTERNACIONAL);
  const seguroIntlArs = sumLineasPorTipo(TipoCostoEmbarque.SEGURO_MARITIMO);
  const cifTotalArs = fobArs
    .plus(fleteOrigenArs)
    .plus(seguroOrigenArs)
    .plus(fleteIntlArs)
    .plus(seguroIntlArs);

  const data = {
    codigo: input.codigo,
    proveedorId: input.proveedorId,
    depositoDestinoId: input.depositoDestinoId,
    estado: input.estado,
    moneda: input.moneda,
    tipoCambio: new Prisma.Decimal(input.tipoCambio),
    incoterm: input.incoterm,
    lugarIncoterm: input.lugarIncoterm,
    valorFleteOrigen:
      input.valorFleteOrigen !== null
        ? new Prisma.Decimal(input.valorFleteOrigen)
        : null,
    valorSeguroOrigen:
      input.valorSeguroOrigen !== null
        ? new Prisma.Decimal(input.valorSeguroOrigen)
        : null,
    nombreBuque: input.nombreBuque,
    lineaMaritima: input.lineaMaritima,
    fechaEmpaque: input.fechaEmpaque,
    lugarTransbordo: input.lugarTransbordo,
    fechaTransbordo: input.fechaTransbordo,
    fechaSalida: input.fechaSalida,
    fechaLlegada: input.fechaLlegada,
    diasPagoDespuesLlegada: input.diasPagoDespuesLlegada,
    fobTotal: money(fobTotal),
    cifTotal: money(cifTotalArs),
    die: money(input.die),
    tasaEstadistica: money(input.tasaEstadistica),
    arancelSim: money(input.arancelSim),
    iva: money(input.iva),
    ivaAdicional: money(input.ivaAdicional),
    ganancias: money(input.ganancias),
    iibb: money(input.iibb),
    costoTotal: money(costoTotal),
  };

  try {
    const saved = await db.$transaction(async (tx) => {
      let embarqueId: string;

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
        embarqueId = embarque.id;
        await tx.itemEmbarque.deleteMany({ where: { embarqueId } });
        await tx.embarqueCosto.deleteMany({ where: { embarqueId } });
      } else {
        const embarque = await tx.embarque.create({ data });
        embarqueId = embarque.id;
      }

      if (input.items.length > 0) {
        await tx.itemEmbarque.createMany({
          data: input.items.map((it) => ({
            embarqueId,
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitarioFob: money(it.precioUnitarioFob),
          })),
        });
      }

      for (const factura of input.costos) {
        const created = await tx.embarqueCosto.create({
          data: {
            embarqueId,
            proveedorId: factura.proveedorId,
            moneda: factura.moneda,
            tipoCambio: new Prisma.Decimal(factura.tipoCambio),
            facturaNumero: factura.facturaNumero,
            fechaFactura: factura.fechaFactura,
            momento: factura.momento,
            iva: money(factura.iva),
            iibb: money(factura.iibb),
            otros: money(factura.otros),
            notas: factura.notas,
          },
        });
        if (factura.lineas.length > 0) {
          await tx.embarqueCostoLinea.createMany({
            data: factura.lineas.map((l) => ({
              embarqueCostoId: created.id,
              tipo: l.tipo,
              cuentaContableGastoId: l.cuentaContableGastoId,
              descripcion: l.descripcion,
              subtotal: money(l.subtotal),
            })),
          });
        }
      }

      return tx.embarque.findUniqueOrThrow({
        where: { id: embarqueId },
        select: { id: true, codigo: true },
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
// Confirmación de Zona Primaria (PASO 3.5)
// ============================================================
//
// Genera asiento parcial: FOB + facturas con momento === ZONA_PRIMARIA.
// La mercadería queda en 1.1.5.02 MERCADERÍAS EN TRÁNSITO sin
// disponibilidad de stock. El despacho posterior (cierre) sigue.

export type ConfirmarZonaPrimariaResult =
  | { ok: true; asientoId: string; asientoNumero: number }
  | { ok: false; error: string };

export async function confirmarZonaPrimariaAction(
  embarqueId: string,
  fechaIso?: string,
): Promise<ConfirmarZonaPrimariaResult> {
  if (!embarqueId || typeof embarqueId !== "string") {
    return { ok: false, error: "ID de embarque inválido." };
  }

  // Parsear fecha opcional. Si viene, debe ser ISO válido. Si no, queda undefined
  // y crearAsiento usa new Date() por compatibilidad.
  let fecha: Date | undefined;
  if (fechaIso) {
    const d = new Date(fechaIso);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Fecha de zona primaria inválida." };
    }
    fecha = d;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const embarque = await tx.embarque.findUnique({
        where: { id: embarqueId },
        include: {
          costos: {
            orderBy: { id: "asc" },
            include: { lineas: { orderBy: { id: "asc" } } },
          },
        },
      });

      if (!embarque) {
        throw new AsientoError("DOMINIO_INVALIDO", "El embarque no existe.");
      }
      if (embarque.asientoZonaPrimariaId) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} ya tiene zona primaria confirmada.`,
        );
      }
      if (embarque.asientoId) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} ya está cerrado/despachado.`,
        );
      }

      const tieneFacturasZP = embarque.costos.some((f) => f.momento === "ZONA_PRIMARIA");
      const tieneFob = Number(embarque.fobTotal) > 0;
      if (!tieneFob && !tieneFacturasZP) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo}: no hay FOB ni facturas marcadas como Zona Primaria.`,
        );
      }

      const asiento = await crearAsientoZonaPrimaria(embarqueId, tx, fecha);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // Persistir fecha del fato contábil en el embarque (no la del clic).
      await tx.embarque.update({
        where: { id: embarqueId },
        data: { fechaZonaPrimaria: fecha ?? new Date() },
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
    console.error("confirmarZonaPrimariaAction failed", err);
    return { ok: false, error: "Error inesperado al confirmar zona primaria." };
  }
}

// Revertir zona primaria — anula el asiento ZP y deja el embarque
// disponible para corregir facturas/FOB y volver a confirmar. NO toca
// stock (en ZP no se generan MovimientoStock). Sólo permitido si el
// embarque NO tiene cierre (asientoId) — primero anular el cierre.

export type RevertirZonaPrimariaResult =
  | { ok: true }
  | { ok: false; error: string };

export async function revertirZonaPrimariaAction(
  embarqueId: string,
): Promise<RevertirZonaPrimariaResult> {
  if (!embarqueId || typeof embarqueId !== "string") {
    return { ok: false, error: "ID de embarque inválido." };
  }

  try {
    await db.$transaction(async (tx) => {
      const embarque = await tx.embarque.findUnique({
        where: { id: embarqueId },
        select: {
          id: true,
          codigo: true,
          asientoZonaPrimariaId: true,
          asientoId: true,
        },
      });

      if (!embarque) {
        throw new AsientoError("DOMINIO_INVALIDO", "El embarque no existe.");
      }
      if (!embarque.asientoZonaPrimariaId) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} no tiene zona primaria confirmada.`,
        );
      }
      if (embarque.asientoId) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} ya tiene cierre — anule primero el asiento de cierre.`,
        );
      }

      await anularAsiento(embarque.asientoZonaPrimariaId, tx);

      await tx.embarque.update({
        where: { id: embarqueId },
        data: {
          asientoZonaPrimariaId: null,
          estado: EmbarqueEstado.EN_PUERTO,
        },
      });
    });

    revalidatePath("/comex/embarques");
    revalidatePath(`/comex/embarques/${embarqueId}`);
    revalidatePath("/contabilidad/asientos");

    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("revertirZonaPrimariaAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al revertir zona primaria.",
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
  fechaIso?: string,
): Promise<CerrarEmbarqueResult> {
  if (!embarqueId || typeof embarqueId !== "string") {
    return { ok: false, error: "ID de embarque inválido." };
  }

  // Parsear fecha opcional del cierre. Si viene, ISO válido obligatorio.
  let fecha: Date | undefined;
  if (fechaIso) {
    const d = new Date(fechaIso);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Fecha de cierre inválida." };
    }
    fecha = d;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const embarque = await tx.embarque.findUnique({
        where: { id: embarqueId },
        include: {
          items: { orderBy: { id: "asc" } },
          costos: {
            orderBy: { id: "asc" },
            include: { lineas: { orderBy: { id: "asc" } } },
          },
        },
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

      const asiento = await crearAsientoEmbarque(embarqueId, tx, fecha);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // Para el rateio aplanamos cada línea de cada factura: el TC de la
      // factura aplica a cada línea (todas las líneas comparten moneda y TC).
      const costosRateio = embarque.costos.flatMap((factura) =>
        factura.lineas.map((l) => ({
          subtotal: l.subtotal,
          tipoCambio: factura.tipoCambio,
        })),
      );
      const rateio = calcularRateioEmbarque(
        {
          fobTotal: embarque.fobTotal,
          embarqueTipoCambio: embarque.tipoCambio,
          costos: costosRateio,
          die: embarque.die,
          tasaEstadistica: embarque.tasaEstadistica,
          arancelSim: embarque.arancelSim,
          valorFleteOrigen: embarque.valorFleteOrigen,
          valorSeguroOrigen: embarque.valorSeguroOrigen,
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
        fecha: fecha ?? new Date(),
        items: rateio.map((r) => ({
          itemEmbarqueId: r.id,
          productoId: r.productoId,
          cantidad: r.cantidad,
          costoUnitario: r.costoUnitario,
        })),
      });

      await tx.embarque.update({
        where: { id: embarqueId },
        data: {
          estado: EmbarqueEstado.CERRADO,
          fechaCierre: fecha ?? new Date(),
        },
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
