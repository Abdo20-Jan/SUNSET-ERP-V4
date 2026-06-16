"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { money, precioUnitario as toPrecioUnitario, toDecimal } from "@/lib/decimal";
import { isStockDualEnabled } from "@/lib/features";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoGasto,
  crearAsientoVenta,
} from "@/lib/services/asiento-automatico";
import { getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { VENTA_CODIGOS } from "@/lib/services/cuenta-registry";
import { calcularPercepcionIIBB } from "@/lib/services/percepcion-iibb";
import { crearEntregaBorradorPorDefecto } from "@/lib/services/entrega-borrador";
import { aplicarReservaSPD, liberarReservaSPD } from "@/lib/services/stock";
import {
  getDepositoPorDefecto,
  validarDepositoVenta,
  validarDisponible,
} from "@/lib/services/stock-helpers";
import {
  ChequeRecibidoEstado,
  CondicionPago,
  GastoEstado,
  Moneda,
  Prisma,
  TipoDeposito,
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
  // Disponible (físico − reservado) sumado en depósitos NACIONALES.
  disponible: number;
};

export type DepositoParaVenta = {
  id: string;
  nombre: string;
};

export type VentasListPage = {
  rows: VentaRow[];
  total: number;
  emitidas: number;
  borradores: number;
  canceladas: number;
};

export async function listarVentas(opts?: {
  page?: number;
  perPage?: number;
  incluirCanceladas?: boolean;
}): Promise<VentasListPage> {
  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const perPage = Math.max(1, Math.min(500, Math.floor(opts?.perPage ?? 50)));
  const skip = (page - 1) * perPage;
  const where = opts?.incluirCanceladas ? {} : { estado: { not: VentaEstado.CANCELADA } };

  const [rows, total, byEstado] = await Promise.all([
    db.venta.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { cliente: { select: { id: true, nombre: true } } },
      take: perPage,
      skip,
    }),
    db.venta.count({ where }),
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
    canceladas: counts.get(VentaEstado.CANCELADA) ?? 0,
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
      // Stock solo de depósitos NACIONALES (zona primaria/aduanera no es vendible).
      stockPorDeposito: {
        where: { deposito: { tipo: TipoDeposito.NACIONAL } },
        select: { cantidadFisica: true, cantidadReservada: true },
      },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    precioVenta: p.precioVenta.toString(),
    costoPromedio: p.costoPromedio.toString(),
    disponible: p.stockPorDeposito.reduce(
      (acc, s) => acc + (s.cantidadFisica - s.cantidadReservada),
      0,
    ),
  }));
}

export async function listarDepositosParaVenta(): Promise<DepositoParaVenta[]> {
  // Excluye depósitos de tipo ZONA_PRIMARIA — la mercadería ahí está
  // bajo custodia aduanera y no disponible para venta hasta ser
  // despachada (transferida al depósito nacional).
  const rows = await db.deposito.findMany({
    where: { activo: true, tipo: TipoDeposito.NACIONAL },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true },
  });
  return rows.map((d) => ({ id: d.id, nombre: d.nombre }));
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
    depositoId: string | null;
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
  // Factura de flete vinculada (Gasto). null cuando la venta no la tiene.
  fleteFactura: {
    proveedorId: string;
    facturaNumero: string | null;
    fechaFactura: string;
    moneda: Moneda;
    tipoCambio: string;
    subtotal: string;
    iva: string;
    iibb: string;
    otros: string;
  } | null;
};

export async function obtenerVentaPorId(id: string): Promise<VentaDetalle | null> {
  const v = await db.venta.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      chequesRecibidos: { orderBy: { fechaPago: "asc" } },
      fleteGasto: true,
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
      depositoId: it.depositoId,
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
    fleteFactura: v.fleteGasto
      ? {
          proveedorId: v.fleteGasto.proveedorId,
          facturaNumero: v.fleteGasto.facturaNumero,
          fechaFactura: v.fleteGasto.fecha.toISOString(),
          moneda: v.fleteGasto.moneda,
          tipoCambio: v.fleteGasto.tipoCambio.toString(),
          subtotal: v.fleteGasto.subtotal.toString(),
          iva: v.fleteGasto.iva.toString(),
          iibb: v.fleteGasto.iibb.toString(),
          otros: v.fleteGasto.otros.toString(),
        }
      : null,
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
    const parsed = Number.parseInt(ultimo.numero.slice(prefix.length), 10);
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
  // Depósito opcional por ítem (S3.1). Cuando es null/vacío cae al default
  // global resuelto en runtime (`getDepositoPorDefecto`).
  depositoId: z
    .string()
    .uuid()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const chequeRecibidoSchema = z.object({
  numero: z.string().trim().min(1).max(40),
  tipo: z.enum(["FISICO", "ECHEQ"]).default("FISICO"),
  cmc7: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  echeqId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  banco: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  emisor: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cuitEmisor: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  importe: z.string().regex(moneyRegex, "Importe inválido"),
  fechaEmision: z.string().min(1, "Fecha emisión requerida"),
  fechaPago: z.string().min(1, "Fecha pago requerida"),
});

// Factura de flete opcional: el flete de la venta capturado como factura
// de gasto (transportista) → CxP real + IVA crédito. Cuando viene presente,
// se crea/actualiza un Gasto vinculado (Gasto.ventaId) y el flete NO se
// contabiliza inline en el asiento de venta (lo hace el asiento del Gasto).
// `subtotal` = flete neto (base de rentabilidad → Venta.flete).
const fleteFacturaSchema = z.object({
  proveedorId: z.string().uuid("Seleccione transportista"),
  facturaNumero: z
    .string()
    .max(64)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  fechaFactura: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : null)),
  moneda: z.nativeEnum(Moneda),
  tipoCambio: z.string().regex(rateRegex, "TC inválido"),
  subtotal: z.string().regex(moneyRegex, "Subtotal flete inválido"),
  iva: z.string().regex(moneyRegex, "IVA inválido").default("0"),
  iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
  otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
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
    // Cuando viene null/ausente → comportamiento legado (flete número suelto).
    fleteFactura: fleteFacturaSchema.nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
    if (
      data.fleteFactura &&
      data.fleteFactura.moneda === Moneda.ARS &&
      data.fleteFactura.tipoCambio !== "1"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["fleteFactura", "tipoCambio"],
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

// Devuelve los importes raw (sin redondear) además de los redondeados
// para Decimal(18,2). Los totales de la venta deben sumarse a partir de
// los raw y redondearse al final, sino aparece desvío de ±1 cent vs lo
// que el form muestra en tiempo real (ej: 30 × 295519.2327 × 1.21 da
// 20.799.975,60 sumando raw, pero 20.799.975,61 si se redondea el IVA
// por línea antes de sumar).
function calcItem(item: { cantidad: number; precioUnitario: string; ivaPorcentaje: string }) {
  const subRaw = toDecimal(item.precioUnitario).times(item.cantidad);
  const ivaPct = toDecimal(item.ivaPorcentaje).dividedBy(100);
  const ivaRaw = subRaw.times(ivaPct);
  const totalRaw = subRaw.plus(ivaRaw);
  return {
    subRaw,
    ivaRaw,
    totalRaw,
    subtotal: subRaw.toDecimalPlaces(2),
    iva: ivaRaw.toDecimalPlaces(2),
    total: totalRaw.toDecimalPlaces(2),
  };
}

// Genera el próximo número de Gasto (G-AAAA-NNNN) dentro de una tx.
// Mismo formato que generarNumeroGasto (gastos.ts) — la unicidad real la
// garantiza Gasto.numero @unique + reintento de la transacción.
async function generarNumeroGastoEnTx(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `G-${year}-`;
  const ultimo = await tx.gasto.findFirst({
    where: { numero: { startsWith: prefix } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let next = 1;
  if (ultimo) {
    const parsed = Number.parseInt(ultimo.numero.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// Crea o actualiza el Gasto de flete vinculado a la venta (Gasto.ventaId).
// Una sola línea en la cuenta FLETE SOBRE VENTAS (5.5.1.60), misma cuenta
// que usaba el lanzamiento inline de crearAsientoVenta. Solo se permite
// mientras el gasto siga en BORRADOR (sin asiento). Devuelve el subtotal
// neto en la moneda de la venta para guardarlo en Venta.flete (rentabilidad).
async function upsertFleteGasto(
  tx: Prisma.TransactionClient,
  ventaId: string,
  ff: NonNullable<z.infer<typeof ventaInputSchema>["fleteFactura"]>,
  fechaVenta: Date,
): Promise<void> {
  const cuentaFleteId = await getOrCreateCuenta(tx, VENTA_CODIGOS.FLETE_GASTO);
  const subtotal = money(ff.subtotal);
  const total = money(toDecimal(ff.subtotal).plus(ff.iva).plus(ff.iibb).plus(ff.otros));
  // Sin fechaFactura, espelha la fecha de la venta — el gasto de flete está
  // vinculado a la venta y debe caer en el mismo período contable (su asiento
  // se contabiliza junto con el de la venta en emitirVentaAction).
  const fecha = ff.fechaFactura ? new Date(ff.fechaFactura) : fechaVenta;

  const existente = await tx.gasto.findUnique({
    where: { ventaId },
    select: { id: true, asientoId: true, estado: true },
  });

  if (existente) {
    if (existente.asientoId || existente.estado !== "BORRADOR") {
      throw new Error("Gasto de flete ya contabilizado; anule para editar.");
    }
    await tx.gasto.update({
      where: { id: existente.id },
      data: {
        proveedorId: ff.proveedorId,
        fecha,
        moneda: ff.moneda,
        tipoCambio: new Prisma.Decimal(ff.tipoCambio),
        facturaNumero: ff.facturaNumero,
        subtotal,
        iva: money(ff.iva),
        iibb: money(ff.iibb),
        otros: money(ff.otros),
        total,
      },
    });
    await tx.lineaGasto.deleteMany({ where: { gastoId: existente.id } });
    await tx.lineaGasto.create({
      data: {
        gastoId: existente.id,
        cuentaContableGastoId: cuentaFleteId,
        descripcion: "Flete sobre venta",
        subtotal,
      },
    });
    return;
  }

  const numero = await generarNumeroGastoEnTx(tx);
  const gasto = await tx.gasto.create({
    data: {
      numero,
      proveedorId: ff.proveedorId,
      ventaId,
      fecha,
      moneda: ff.moneda,
      tipoCambio: new Prisma.Decimal(ff.tipoCambio),
      facturaNumero: ff.facturaNumero,
      subtotal,
      iva: money(ff.iva),
      iibb: money(ff.iibb),
      otros: money(ff.otros),
      total,
    },
  });
  await tx.lineaGasto.create({
    data: {
      gastoId: gasto.id,
      cuentaContableGastoId: cuentaFleteId,
      descripcion: "Flete sobre venta",
      subtotal,
    },
  });
}

export async function guardarVentaAction(raw: VentaInput): Promise<VentaActionResult> {
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
  // Sumamos los importes raw (sin redondear por línea) y redondeamos
  // recién al asignar al header. Los ItemVenta sí guardan los importes
  // redondeados — schema obliga Decimal(18,2). Puede aparecer ±0,01
  // entre Σ ItemVenta y Venta.subtotal/iva en casos límite; es esperado.
  const subtotalRaw = itemsCalc.reduce((acc, i) => acc.plus(i.subRaw), toDecimal(0));
  const ivaRaw = itemsCalc.reduce((acc, i) => acc.plus(i.ivaRaw), toDecimal(0));
  const subtotal = money(subtotalRaw);
  const iva = money(ivaRaw);

  // Lookup cliente con provincia + jurisdicción para autocálculo de
  // Percepción IIBB. El monto se snapshot-ea en el momento de guardar
  // junto con alícuota usada y jurisdicción — vendas históricas deben
  // poder reproducirse aunque la alícuota cambie después.
  const clienteFiscal = await db.cliente.findUnique({
    where: { id: input.clienteId },
    select: {
      exentoPercepcionIIBB: true,
      alicuotaPercepcionIIBB: true,
      provincia: {
        select: {
          jurisdiccionIIBB: {
            select: {
              id: true,
              esAgentePercepcion: true,
              alicuotaPercepcion: true,
            },
          },
        },
      },
    },
  });
  const percepcion = clienteFiscal
    ? calcularPercepcionIIBB({
        subtotal: toDecimal(subtotal),
        cliente: clienteFiscal,
      })
    : { monto: toDecimal(0), alicuotaUsada: null, jurisdiccionId: null };
  const percepcionIIBBMoney = money(percepcion.monto);

  // IIBB jurisdiccional embutido en el precio (no se cobra adicional al
  // cliente). El total que paga el cliente es subtotal + iva + iibb_manual
  // + otros. La percepción se almacena como snapshot pero se trata como
  // gasto absorbido por Sunset (asiento DEBE 5.5.02 / HABER 2.1.3.05).
  // Igual que subtotal/iva, sumamos raw + iibb + otros antes de redondear
  // para que el total coincida con el del form en tiempo real.
  const total = money(
    subtotalRaw.plus(ivaRaw).plus(toDecimal(input.iibb)).plus(toDecimal(input.otros)),
  );

  try {
    const saved = await db.$transaction(async (tx) => {
      let id: string;
      const data = {
        numero: input.numero,
        clienteId: input.clienteId,
        fecha: new Date(input.fecha),
        fechaVencimiento: input.fechaVencimiento ? new Date(input.fechaVencimiento) : null,
        condicionPago: input.condicionPago,
        moneda: input.moneda,
        tipoCambio: new Prisma.Decimal(input.tipoCambio),
        subtotal: money(subtotal),
        iva: money(iva),
        iibb: money(input.iibb),
        percepcionIIBB: percepcionIIBBMoney,
        percepcionIIBBAlicuota: percepcion.alicuotaUsada
          ? new Prisma.Decimal(percepcion.alicuotaUsada.toString())
          : null,
        percepcionIIBBJurisdiccionId: percepcion.jurisdiccionId,
        otros: money(input.otros),
        // Con factura de flete, Venta.flete = subtotal neto (base de
        // rentabilidad); sin ella, el flete suelto legado. No afecta `total`.
        flete: input.fleteFactura ? money(input.fleteFactura.subtotal) : money(input.flete),
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
          depositoId: it.depositoId,
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
            fechaEmision: new Date(`${c.fechaEmision}T12:00:00Z`),
            fechaPago: new Date(`${c.fechaPago}T12:00:00Z`),
          })),
        });
      }

      // Factura de flete vinculada (Gasto). Presente → crear/actualizar el
      // Gasto. Ausente en edición → eliminar el gasto BORRADOR previo (si lo
      // hay) para volver al flete suelto/sin flete.
      if (input.fleteFactura) {
        await upsertFleteGasto(tx, id, input.fleteFactura, new Date(input.fecha));
      } else {
        const previo = await tx.gasto.findUnique({
          where: { ventaId: id },
          select: { id: true, asientoId: true, estado: true },
        });
        if (previo) {
          if (previo.asientoId || previo.estado !== "BORRADOR") {
            throw new Error("Gasto de flete ya contabilizado; anule para quitar el flete.");
          }
          await tx.gasto.delete({ where: { id: previo.id } });
        }
      }

      return tx.venta.findUniqueOrThrow({
        where: { id },
        select: { id: true, numero: true },
      });
    });

    revalidatePath("/ventas");
    revalidatePath(`/ventas/${saved.id}`);
    revalidatePath("/tesoreria/cuentas-a-pagar");
    return { ok: true, id: saved.id, numero: saved.numero };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: `El número "${input.numero}" ya existe.` };
    }
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error inesperado al guardar la venta." };
  }
}

type VentaEmisionItem = {
  productoId: string;
  cantidad: number;
  depositoId: string | null;
};
type TxClient = Prisma.TransactionClient;

async function reservarStockEmision(
  tx: TxClient,
  items: readonly VentaEmisionItem[],
): Promise<void> {
  if (!isStockDualEnabled()) return;
  const defaultDepId = await getDepositoPorDefecto(tx);
  for (const it of items) {
    const depId = it.depositoId ?? defaultDepId;
    // Defensa en profundidad: el dropdown ya filtra ZPA, pero acá
    // bloqueamos cualquier bypass (ej: API directo).
    await validarDepositoVenta(tx, depId);
    await validarDisponible(tx, it.productoId, depId, it.cantidad);
    await aplicarReservaSPD(tx, it.productoId, depId, it.cantidad);
  }
}

async function liberarReservasAnulacion(
  tx: TxClient,
  items: readonly VentaEmisionItem[],
): Promise<void> {
  if (!isStockDualEnabled()) return;
  const defaultDepId = await getDepositoPorDefecto(tx);
  for (const it of items) {
    const depId = it.depositoId ?? defaultDepId;
    await liberarReservaSPD(tx, it.productoId, depId, it.cantidad);
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
          asientoId: true,
          numero: true,
          fecha: true,
          items: {
            select: { productoId: true, cantidad: true, depositoId: true },
          },
          // Gasto de flete vinculado: se contabiliza junto con la venta.
          fleteGasto: { select: { id: true, asientoId: true, estado: true } },
        },
      });
      if (!v) throw new AsientoError("DOMINIO_INVALIDO", "Venta no existe.");
      if (v.asientoId) {
        throw new AsientoError("DOMINIO_INVALIDO", `Venta ${v.numero} ya tiene asiento.`);
      }
      await reservarStockEmision(tx, v.items);
      const asiento = await crearAsientoVenta(ventaId, tx);
      const cont = await contabilizarAsiento(asiento.id, tx);
      // Contabilizar la factura de flete vinculada (DEBE flete + IVA crédito /
      // HABER proveedor → CxP real). Solo si está en BORRADOR sin asiento.
      if (v.fleteGasto && !v.fleteGasto.asientoId && v.fleteGasto.estado === "BORRADOR") {
        const asientoGasto = await crearAsientoGasto(v.fleteGasto.id, tx);
        await contabilizarAsiento(asientoGasto.id, tx);
      }
      // Stock-dual: deja una entrega BORRADOR (100% de los items, por depósito)
      // pendiente de confirmar. Hace visible el remito en la venta y evita que
      // la cuenta-puente 1.1.5.03 acumule olvidada. El asiento de baja se genera
      // recién al CONFIRMAR la entrega.
      if (isStockDualEnabled()) {
        await crearEntregaBorradorPorDefecto(tx, ventaId, v.fecha);
      }
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

function ensureSinEntregasConfirmadas(entregas: readonly { numero: string }[]): void {
  if (entregas.length === 0 || !isStockDualEnabled()) return;
  const numeros = entregas.map((e) => e.numero).join(", ");
  throw new AsientoError(
    "DOMINIO_INVALIDO",
    `Venta tiene entrega(s) confirmada(s) (${numeros}). Anular entregas antes de anular la venta.`,
  );
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
            select: { productoId: true, cantidad: true, depositoId: true },
          },
          entregas: {
            where: { estado: "CONFIRMADA" },
            select: { numero: true },
          },
          // ChequeRecibido vinculados pelo FK direto. Anular venda
          // sem tratar cheques ativos deixa órfãos: estado != ANULADO
          // mas vinculado a venda CANCELADA + asiento de cobro
          // ainda CONTABILIZADO. Reverter na mesma transação.
          chequesRecibidos: {
            where: { estado: { not: ChequeRecibidoEstado.ANULADO } },
            select: { id: true, asientoCobroId: true },
          },
          // Gasto de flete vinculado: se anula junto con la venta.
          fleteGasto: { select: { id: true, asientoId: true, estado: true } },
        },
      });
      if (!v) {
        throw new AsientoError("DOMINIO_INVALIDO", "Venta no existe.");
      }
      ensureSinEntregasConfirmadas(v.entregas);

      // Anular la factura de flete vinculada: reversa su asiento (CxP + IVA
      // crédito) y marca el gasto ANULADO. Espeja anularGastoAction.
      if (v.fleteGasto && v.fleteGasto.estado !== "ANULADO") {
        if (v.fleteGasto.asientoId) {
          await anularAsiento(v.fleteGasto.asientoId, tx);
        }
        await tx.gasto.update({
          where: { id: v.fleteGasto.id },
          data: { estado: GastoEstado.ANULADO },
        });
      }

      // Anular cheques ativos antes de reverter o asiento da venda.
      // Se o cheque já foi acreditado (ACREDITADO/DEPOSITADO), o
      // asiento de cobro reverte o crédito bancário — efeito desejado
      // ao anular a venda.
      for (const cheque of v.chequesRecibidos) {
        if (cheque.asientoCobroId) {
          await anularAsiento(cheque.asientoCobroId, tx);
        }
        await tx.chequeRecibido.update({
          where: { id: cheque.id },
          data: { estado: ChequeRecibidoEstado.ANULADO, asientoCobroId: null },
        });
      }

      if (!v.asientoId) {
        await tx.venta.update({
          where: { id: ventaId },
          data: { estado: VentaEstado.CANCELADA },
        });
        return;
      }
      await liberarReservasAnulacion(tx, v.items);
      await anularAsiento(v.asientoId, tx);
    });
    revalidatePath("/ventas");
    revalidatePath(`/ventas/${ventaId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la venta." };
  }
}
