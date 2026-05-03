"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  money,
  precioUnitario as toPrecioUnitario,
  sumMoney,
  toDecimal,
} from "@/lib/decimal";
import { isStockDualEnabled } from "@/lib/features";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoVenta,
} from "@/lib/services/asiento-automatico";
import { aplicarReservaSPD, liberarReservaSPD } from "@/lib/services/stock";
import {
  getDepositoPorDefecto,
  validarDisponible,
} from "@/lib/services/stock-helpers";
import {
  CondicionPago,
  Moneda,
  Prisma,
  VentaEstado,
} from "@/generated/prisma/client";

export type VentaRow = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  cliente: { id: string; nombre: string };
  moneda: Moneda;
  subtotal: string;
  iva: string;
  total: string;
  estado: VentaEstado;
  asientoId: string | null;
};

export type ClienteParaVenta = {
  id: string;
  nombre: string;
  diasPagoDefault: number | null;
  condicionPagoDefault: CondicionPago;
};

export type ProductoParaVenta = {
  id: string;
  codigo: string;
  nombre: string;
  precioVenta: string;
  costoPromedio: string;
};

export type VentasListPage = {
  rows: VentaRow[];
  total: number;
  emitidas: number;
  borradores: number;
};

export async function listarVentas(opts?: {
  page?: number;
  perPage?: number;
}): Promise<VentasListPage> {
  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const perPage = Math.max(1, Math.min(500, Math.floor(opts?.perPage ?? 50)));
  const skip = (page - 1) * perPage;

  const [rows, total, byEstado] = await Promise.all([
    db.venta.findMany({
      orderBy: { createdAt: "desc" },
      include: { cliente: { select: { id: true, nombre: true } } },
      take: perPage,
      skip,
    }),
    db.venta.count(),
    db.venta.groupBy({ by: ["estado"], _count: { _all: true } }),
  ]);

  const counts = new Map(byEstado.map((g) => [g.estado, g._count._all]));

  return {
    rows: rows.map((v) => ({
      id: v.id,
      numero: v.numero,
      fecha: v.fecha.toISOString(),
      fechaVencimiento: v.fechaVencimiento?.toISOString() ?? null,
      cliente: v.cliente,
      moneda: v.moneda,
      subtotal: v.subtotal.toString(),
      iva: v.iva.toString(),
      total: v.total.toString(),
      estado: v.estado,
      asientoId: v.asientoId,
    })),
    total,
    emitidas: counts.get(VentaEstado.EMITIDA) ?? 0,
    borradores: counts.get(VentaEstado.BORRADOR) ?? 0,
  };
}

export async function listarClientesParaVenta(): Promise<ClienteParaVenta[]> {
  const rows = await db.cliente.findMany({
    where: { estado: "activo" },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      diasPagoDefault: true,
      condicionPagoDefault: true,
    },
  });
  return rows.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    diasPagoDefault: c.diasPagoDefault,
    condicionPagoDefault: c.condicionPagoDefault,
  }));
}

export async function listarProductosParaVenta(): Promise<ProductoParaVenta[]> {
  const rows = await db.producto.findMany({
    where: { activo: true },
    orderBy: { codigo: "asc" },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      precioVenta: true,
      costoPromedio: true,
    },
  });
  return rows.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    precioVenta: p.precioVenta.toString(),
    costoPromedio: p.costoPromedio.toString(),
  }));
}

export type VentaDetalle = {
  id: string;
  numero: string;
  clienteId: string;
  fecha: string;
  fechaVencimiento: string | null;
  condicionPago: CondicionPago;
  moneda: Moneda;
  tipoCambio: string;
  subtotal: string;
  iva: string;
  iibb: string;
  otros: string;
  flete: string;
  total: string;
  estado: VentaEstado;
  asientoId: string | null;
  pedidoVentaId: number | null;
  notas: string | null;
  items: Array<{
    id: number;
    productoId: string;
    cantidad: number;
    precioUnitario: string;
    subtotal: string;
    iva: string;
    total: string;
  }>;
  chequesRecibidos: Array<{
    id: number;
    numero: string;
    tipo: string;
    banco: string | null;
    emisor: string | null;
    cuitEmisor: string | null;
    importe: string;
    fechaEmision: string;
    fechaPago: string;
    estado: string;
  }>;
};

export async function obtenerVentaPorId(
  id: string,
): Promise<VentaDetalle | null> {
  const v = await db.venta.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      chequesRecibidos: { orderBy: { fechaPago: "asc" } },
    },
  });
  if (!v) return null;
  return {
    id: v.id,
    numero: v.numero,
    clienteId: v.clienteId,
    fecha: v.fecha.toISOString(),
    fechaVencimiento: v.fechaVencimiento?.toISOString() ?? null,
    condicionPago: v.condicionPago,
    moneda: v.moneda,
    tipoCambio: v.tipoCambio.toString(),
    subtotal: v.subtotal.toString(),
    iva: v.iva.toString(),
    iibb: v.iibb.toString(),
    otros: v.otros.toString(),
    flete: v.flete.toString(),
    total: v.total.toString(),
    estado: v.estado,
    asientoId: v.asientoId,
    pedidoVentaId: v.pedidoVentaId,
    notas: v.notas,
    items: v.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario.toString(),
      subtotal: it.subtotal.toString(),
      iva: it.iva.toString(),
      total: it.total.toString(),
    })),
    chequesRecibidos: v.chequesRecibidos.map((c) => ({
      id: c.id,
      numero: c.numero,
      tipo: c.tipo,
      banco: c.banco,
      emisor: c.emisor,
      cuitEmisor: c.cuitEmisor,
      importe: c.importe.toString(),
      fechaEmision: c.fechaEmision.toISOString(),
      fechaPago: c.fechaPago.toISOString(),
      estado: c.estado,
    })),
  };
}

export async function generarNumeroVenta(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `V-${year}-`;
  const ultimo = await db.venta.findFirst({
    where: { numero: { startsWith: prefix } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let next = 1;
  if (ultimo) {
    const parsed = parseInt(ultimo.numero.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

const moneyRegex = /^\d+(\.\d{1,2})?$/;
// Precio unitario admite hasta 4 decimales — útil para ventas de gran
// volumen donde el redondeo a 2 decimales del unitario distorsiona el
// total final (ej: 295519.2313 × 250 = 73.879.807,82 vs 295519.23 × 250
// = 73.879.807,50 — diferencia de 32 centavos por unidad).
const precioUnitarioRegex = /^\d+(\.\d{1,4})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const itemSchema = z.object({
  productoId: z.string().uuid("Seleccione un producto"),
  cantidad: z.number().int().positive("Cantidad > 0"),
  precioUnitario: z.string().regex(precioUnitarioRegex, "Precio inválido (máx. 4 decimales)"),
  ivaPorcentaje: z.string().regex(/^\d+(\.\d{1,2})?$/, "IVA% inválido"),
});

const chequeRecibidoSchema = z.object({
  numero: z.string().trim().min(1).max(40),
  tipo: z.enum(["FISICO", "ECHEQ"]).default("FISICO"),
  cmc7: z.string().trim().max(40).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  echeqId: z.string().trim().max(40).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  banco: z.string().trim().max(80).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  emisor: z.string().trim().max(120).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cuitEmisor: z.string().trim().max(20).optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  importe: z.string().regex(moneyRegex, "Importe inválido"),
  fechaEmision: z.string().min(1, "Fecha emisión requerida"),
  fechaPago: z.string().min(1, "Fecha pago requerida"),
});

const ventaInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    numero: z.string().min(1).max(32),
    clienteId: z.string().uuid("Seleccione cliente"),
    fecha: z.string().min(1, "Fecha requerida"),
    fechaVencimiento: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    condicionPago: z.nativeEnum(CondicionPago),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
    otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
    flete: z.string().regex(moneyRegex, "Flete inválido").default("0"),
    notas: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    items: z.array(itemSchema).min(1, "Al menos un ítem"),
    cheques: z.array(chequeRecibidoSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
    if (data.fechaVencimiento) {
      if (new Date(data.fechaVencimiento) < new Date(data.fecha)) {
        ctx.addIssue({
          code: "custom",
          path: ["fechaVencimiento"],
          message: "Fecha de vencimiento no puede ser anterior a la factura",
        });
      }
    }
  });

export type VentaInput = z.input<typeof ventaInputSchema>;

export type VentaActionResult =
  | { ok: true; id: string; numero: string }
  | { ok: false; error: string };

function calcItem(item: {
  cantidad: number;
  precioUnitario: string;
  ivaPorcentaje: string;
}) {
  const sub = toDecimal(item.precioUnitario).times(item.cantidad);
  const ivaPct = toDecimal(item.ivaPorcentaje).dividedBy(100);
  const iva = sub.times(ivaPct);
  return {
    subtotal: sub.toDecimalPlaces(2),
    iva: iva.toDecimalPlaces(2),
    total: sub.plus(iva).toDecimalPlaces(2),
  };
}

export async function guardarVentaAction(
  raw: VentaInput,
): Promise<VentaActionResult> {
  const parsed = ventaInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first.path.join(".")}: ${first.message}` };
  }
  const input = parsed.data;

  const itemsCalc = input.items.map((it) => ({
    ...it,
    ...calcItem(it),
  }));
  const subtotal = sumMoney(itemsCalc.map((i) => i.subtotal));
  const iva = sumMoney(itemsCalc.map((i) => i.iva));
  const total = sumMoney([subtotal, iva, input.iibb, input.otros]);

  try {
    const saved = await db.$transaction(async (tx) => {
      let id: string;
      const data = {
        numero: input.numero,
        clienteId: input.clienteId,
        fecha: new Date(input.fecha),
        fechaVencimiento: input.fechaVencimiento
          ? new Date(input.fechaVencimiento)
          : null,
        condicionPago: input.condicionPago,
        moneda: input.moneda,
        tipoCambio: new Prisma.Decimal(input.tipoCambio),
        subtotal: money(subtotal),
        iva: money(iva),
        iibb: money(input.iibb),
        otros: money(input.otros),
        flete: money(input.flete),
        total: money(total),
        notas: input.notas,
      };

      if (input.id) {
        const actual = await tx.venta.findUnique({
          where: { id: input.id },
          select: { estado: true, asientoId: true },
        });
        if (!actual) throw new Error("Venta no existe.");
        if (actual.asientoId) {
          throw new Error("Venta ya emitida; anule el asiento para editar.");
        }
        const v = await tx.venta.update({
          where: { id: input.id },
          data,
        });
        await tx.itemVenta.deleteMany({ where: { ventaId: v.id } });
        id = v.id;
      } else {
        const v = await tx.venta.create({ data });
        id = v.id;
      }

      await tx.itemVenta.createMany({
        data: itemsCalc.map((it) => ({
          ventaId: id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: toPrecioUnitario(it.precioUnitario),
          subtotal: money(it.subtotal),
          iva: money(it.iva),
          total: money(it.total),
        })),
      });

      // Cheques de terceros recibidos como cobro de la venta. Se borran
      // los anteriores (en edición) y se recrean según el input. Solo
      // permitido cuando la venta sigue en BORRADOR (los EN_CARTERA en
      // ventas EMITIDAS deben gestionarse desde su entidad propia).
      await tx.chequeRecibido.deleteMany({ where: { ventaId: id } });
      if (input.cheques && input.cheques.length > 0) {
        await tx.chequeRecibido.createMany({
          data: input.cheques.map((c) => ({
            ventaId: id,
            numero: c.numero,
            tipo: c.tipo,
            cmc7: c.cmc7,
            echeqId: c.echeqId,
            banco: c.banco,
            emisor: c.emisor,
            cuitEmisor: c.cuitEmisor,
            importe: money(c.importe),
            fechaEmision: new Date(c.fechaEmision + "T12:00:00Z"),
            fechaPago: new Date(c.fechaPago + "T12:00:00Z"),
          })),
        });
      }

      return tx.venta.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/ventas");
    revalidatePath(`/ventas/${saved.id}`);
    return { ok: true, id: saved.id, numero: saved.numero };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, error: `El número "${input.numero}" ya existe.` };
    }
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error inesperado al guardar la venta." };
  }
}

export async function emitirVentaAction(
  ventaId: string,
): Promise<{ ok: true; numeroAsiento: number } | { ok: false; error: string }> {
  try {
    const result = await db.$transaction(async (tx) => {
      const v = await tx.venta.findUnique({
        where: { id: ventaId },
        select: {
          estado: true,
          asientoId: true,
          numero: true,
          items: {
            select: {
              productoId: true,
              cantidad: true,
              producto: { select: { codigo: true } },
            },
          },
        },
      });
      if (!v) throw new AsientoError("DOMINIO_INVALIDO", "Venta no existe.");
      if (v.asientoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Venta ${v.numero} ya tiene asiento.`,
        );
      }

      // W3.5 — reserva de stock al emitir, gated por flag.
      // Cuando off, comportamiento legacy: no toca StockPorDeposito.
      // Cuando on, valida disponibilidad por (producto, depósito default)
      // y aplica reserva. La cuenta provisória 1.1.5.03 ya se usa en
      // crearAsientoVenta (asiento dual).
      if (isStockDualEnabled()) {
        const depositoId = await getDepositoPorDefecto(tx);
        // Validar disponibilidad agrupada (varios items pueden tocar el mismo
        // producto): hacer reservas item por item; cada validarDisponible
        // mira el estado actualizado.
        for (const it of v.items) {
          await validarDisponible(tx, it.productoId, depositoId, it.cantidad);
          await aplicarReservaSPD(tx, it.productoId, depositoId, it.cantidad);
        }
      }

      const asiento = await crearAsientoVenta(ventaId, tx);
      const cont = await contabilizarAsiento(asiento.id, tx);
      await tx.venta.update({
        where: { id: ventaId },
        data: { estado: VentaEstado.EMITIDA },
      });
      return cont.numero;
    });
    revalidatePath("/ventas");
    revalidatePath(`/ventas/${ventaId}`);
    return { ok: true, numeroAsiento: result };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al emitir la venta." };
  }
}

export async function anularVentaAction(
  ventaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.$transaction(async (tx) => {
      const v = await tx.venta.findUnique({
        where: { id: ventaId },
        select: {
          asientoId: true,
          items: {
            select: { productoId: true, cantidad: true },
          },
          entregas: {
            where: { estado: "CONFIRMADA" },
            select: { id: true, numero: true },
          },
        },
      });
      if (!v) {
        throw new AsientoError("DOMINIO_INVALIDO", "Venta no existe.");
      }
      // W3.5 — bloquear anulación si hay entrega CONFIRMADA: el operador
      // debe anular las entregas primero (cascada manual) para que el
      // stock vuelva al depósito antes de revertir asiento + reserva.
      if (v.entregas.length > 0 && isStockDualEnabled()) {
        const numeros = v.entregas.map((e) => e.numero).join(", ");
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Venta tiene entrega(s) confirmada(s) (${numeros}). Anular entregas antes de anular la venta.`,
        );
      }

      if (!v.asientoId) {
        await tx.venta.update({
          where: { id: ventaId },
          data: { estado: VentaEstado.CANCELADA },
        });
        return;
      }

      // W3.5 — liberar reservas si corresponde, antes de anular asiento.
      if (isStockDualEnabled()) {
        const depositoId = await getDepositoPorDefecto(tx);
        for (const it of v.items) {
          await liberarReservaSPD(tx, it.productoId, depositoId, it.cantidad);
        }
      }

      await anularAsiento(v.asientoId, tx);
      // anularEnTx ya cancela y desvincula la venta.
    });
    revalidatePath("/ventas");
    revalidatePath(`/ventas/${ventaId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la venta." };
  }
}
