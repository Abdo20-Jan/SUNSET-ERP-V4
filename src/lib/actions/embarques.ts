"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { money, sumMoney, toDecimal } from "@/lib/decimal";
import { calcularRateioEmbarque, calcularRateioZonaPrimaria } from "@/lib/services/comex";
import { resolverDepositoZpa } from "@/lib/services/embarque-zpa";
import {
  anularAsiento,
  anularAsientoEmbarqueCosto,
  AsientoError,
  contabilizarAsiento,
  crearAsientoArriboComex,
  crearAsientoEmbarque,
  crearAsientoEmbarqueCosto,
  crearAsientoZonaPrimaria,
} from "@/lib/services/asiento-automatico";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import {
  aplicarIngresoEmbarque,
  aplicarIngresoEmbarqueZpa,
  revertirIngresoEmbarque,
} from "@/lib/services/stock";
import type { ProveedorOption } from "@/components/proveedor-combobox";
import type { ProductoOption } from "@/components/producto-combobox";
import type { CuentaOption } from "@/components/cuenta-combobox";
import {
  CuentaCategoria,
  CuentaTipo,
  DespachoEstado,
  EmbarqueEstado,
  Incoterm,
  Moneda,
  Prisma,
  TipoCostoEmbarque,
} from "@/generated/prisma/client";
import type { ContenedorEstado } from "@/generated/prisma/client";
import {
  type CostoLite,
  deriveBloqueo,
  deriveEtaTono,
  deriveStatusCosto,
  deriveStatusPago,
  type EtaTono,
  fobEnUsd,
  resolverVistaFiltro,
  type StatusCostoUi,
  type StatusPagoUi,
  type VistaId,
} from "@/lib/services/comex-worklist-derivaciones";
import { embarqueInputSchema, type GuardarEmbarqueInput } from "./embarque-schema";

export type EmbarqueWorklistRow = {
  id: string;
  codigo: string;
  estado: EmbarqueEstado;
  moneda: Moneda;
  tipoCambio: string;
  /** FOB en moneda NATIVA del embarque. */
  fobTotal: string;
  /** FOB normalizado a USD (valor comercial; ARS-nativo ÷ TC del embarque). */
  fobUsd: string;
  /** Landed cost (ARS). `null` cuando el caller no tiene `VER_COSTO_LANDED` (gate). */
  costoTotal: string | null;
  incoterm: Incoterm | null;
  lugarIncoterm: string | null;
  proveedor: { id: string; nombre: string; pais: string };
  /** Plano (= proveedor.nombre) para quick-search / chips client del grid. */
  proveedorNombre: string;
  cantidadNeumaticos: number;
  fechaLlegada: string | null;
  etaTono: EtaTono;
  updatedAt: string;
  nombreBuque: string | null;
  contenedores: { numero: string; estado: ContenedorEstado }[];
  facturasLocales: {
    id: number;
    numero: string | null;
    estado: EmbarqueCostoEstadoUi;
    fechaVencimiento: string | null;
    momento: "ZONA_PRIMARIA" | "DESPACHO";
  }[];
  statusCosto: StatusCostoUi;
  statusPago: StatusPagoUi | null;
  bloqueo: string | null;
};

export type EmbarqueWorklistFiltros = {
  vista?: VistaId;
  moneda?: Moneda;
  proveedorId?: string;
  perPage?: number;
  /** Resuelto por el caller (page/export) con `hasPermission(VER_COSTO_LANDED)`. */
  verCosto: boolean;
};

export type EmbarquesWorklistPage = {
  rows: EmbarqueWorklistRow[];
  total: number;
};

const WORKLIST_MAX = 2000;

type EmbarqueWorklistRecord = Prisma.EmbarqueGetPayload<{
  include: {
    proveedor: { select: { id: true; nombre: true; pais: true } };
    contenedores: { select: { numeroContenedor: true; estado: true } };
    costos: {
      select: {
        id: true;
        facturaNumero: true;
        estado: true;
        fechaVencimiento: true;
        momento: true;
      };
    };
  };
}>;

function mapEmbarqueWorklistRow(
  e: EmbarqueWorklistRecord,
  ctx: { now: Date; verCosto: boolean; cantidad: number },
): EmbarqueWorklistRow {
  const costosLite: CostoLite[] = e.costos.map((c) => ({
    estado: c.estado,
    fechaVencimiento: c.fechaVencimiento,
  }));
  return {
    id: e.id,
    codigo: e.codigo,
    estado: e.estado,
    moneda: e.moneda,
    tipoCambio: e.tipoCambio.toString(),
    fobTotal: e.fobTotal.toString(),
    fobUsd: fobEnUsd(e.fobTotal.toString(), e.moneda, e.tipoCambio.toString()),
    costoTotal: ctx.verCosto ? e.costoTotal.toString() : null,
    incoterm: e.incoterm,
    lugarIncoterm: e.lugarIncoterm,
    proveedor: e.proveedor,
    proveedorNombre: e.proveedor.nombre,
    cantidadNeumaticos: ctx.cantidad,
    fechaLlegada: e.fechaLlegada ? e.fechaLlegada.toISOString() : null,
    etaTono: deriveEtaTono(e.fechaLlegada, e.estado, ctx.now),
    updatedAt: e.updatedAt.toISOString(),
    nombreBuque: e.nombreBuque,
    contenedores: e.contenedores.map((c) => ({ numero: c.numeroContenedor, estado: c.estado })),
    facturasLocales: e.costos.map((c) => ({
      id: c.id,
      numero: c.facturaNumero,
      estado: c.estado,
      fechaVencimiento: c.fechaVencimiento ? c.fechaVencimiento.toISOString() : null,
      momento: c.momento,
    })),
    statusCosto: deriveStatusCosto(costosLite, e.estado),
    statusPago: deriveStatusPago(costosLite, ctx.now),
    bloqueo: deriveBloqueo(costosLite, ctx.now),
  };
}

/**
 * Lectura de la worklist Comex de procesos (PR-020 / CX-02). EXTENSIÓN ADITIVA y
 * de SÓLO LECTURA: includes/selects estrechos de campos EXISTENTES + derivaciones
 * de display. NO toca write/cálculo ni el motor de rateio/despacho/costo (G-09).
 * `costoTotal` se gatea por `verCosto` para que el costo NUNCA llegue al cliente
 * sin permiso.
 *
 * read-only worklist projection — never consumed by rateio/despacho/asiento.
 */
export async function listarEmbarques(
  filtros: EmbarqueWorklistFiltros,
): Promise<EmbarquesWorklistPage> {
  const now = new Date();
  const where: Prisma.EmbarqueWhereInput = {};
  const vistaFiltro = resolverVistaFiltro(filtros.vista ?? "todos", now);
  if (vistaFiltro.estado) where.estado = { in: vistaFiltro.estado };
  if (vistaFiltro.etaHasta) where.fechaLlegada = { not: null, lte: vistaFiltro.etaHasta };
  if (filtros.moneda) where.moneda = filtros.moneda;
  if (filtros.proveedorId) where.proveedorId = filtros.proveedorId;

  const take = Math.max(1, Math.min(WORKLIST_MAX, Math.floor(filtros.perPage ?? WORKLIST_MAX)));

  const [embarques, total, sums] = await Promise.all([
    db.embarque.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        proveedor: { select: { id: true, nombre: true, pais: true } },
        contenedores: { select: { numeroContenedor: true, estado: true } },
        // Narrow select: NUNCA campos monetarios (iva/iibb/otros/lineas) — el gate
        // de costo se rompería si viajaran al cliente. Sólo señales operativas.
        costos: {
          select: {
            id: true,
            facturaNumero: true,
            estado: true,
            fechaVencimiento: true,
            momento: true,
          },
        },
      },
    }),
    db.embarque.count({ where }),
    db.itemEmbarque.groupBy({
      by: ["embarqueId"],
      where: { embarque: where },
      _sum: { cantidad: true },
    }),
  ]);

  const cantidadPorEmbarque = new Map(sums.map((s) => [s.embarqueId, s._sum.cantidad ?? 0]));
  const rows = embarques.map((e) =>
    mapEmbarqueWorklistRow(e, {
      now,
      verCosto: filtros.verCosto,
      cantidad: cantidadPorEmbarque.get(e.id) ?? 0,
    }),
  );
  return { rows, total };
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

export type EmbarqueCostoEstadoUi = "BORRADOR" | "EMITIDA" | "ANULADA" | "LEGACY_BUNDLED";

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
  estado: EmbarqueCostoEstadoUi;
  asientoId: string | null;
  asientoNumero: number | null;
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
  despachosActivosCount: number;
};

export async function obtenerEmbarquePorId(id: string): Promise<EmbarqueDetalle | null> {
  const embarque = await db.embarque.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      costos: {
        orderBy: { id: "asc" },
        include: {
          lineas: { orderBy: { id: "asc" } },
          asiento: { select: { numero: true } },
        },
      },
      asiento: { select: { id: true, numero: true, estado: true } },
      asientoZonaPrimaria: { select: { id: true, numero: true, estado: true } },
      _count: {
        select: {
          despachos: { where: { estado: { not: DespachoEstado.ANULADO } } },
        },
      },
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
      embarque.valorFleteOrigen !== null ? embarque.valorFleteOrigen.toString() : null,
    valorSeguroOrigen:
      embarque.valorSeguroOrigen !== null ? embarque.valorSeguroOrigen.toString() : null,
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
      estado: c.estado,
      asientoId: c.asientoId,
      asientoNumero: c.asiento?.numero ?? null,
    })),
    despachosActivosCount: embarque._count.despachos,
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
    const parsed = Number.parseInt(suffix, 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  return `${prefix}${String(next).padStart(3, "0")}`;
}

// El schema de validación vive en ./embarque-schema (sin "use server") porque
// este archivo sólo puede exportar funciones async. Los tests del guard de
// tipoCambio (gap #7) importan `embarqueInputSchema` desde ese módulo.
export type {
  CostoEmbarqueInput,
  CostoEmbarqueLineaInput,
  GuardarEmbarqueInput,
} from "./embarque-schema";

export type GuardarEmbarqueResult =
  | { ok: true; id: string; codigo: string }
  | { ok: false; error: string };

export async function guardarEmbarqueAction(
  raw: GuardarEmbarqueInput,
): Promise<GuardarEmbarqueResult> {
  const parsed = embarqueInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `${first.path.join(".")}: ${first.message}`,
    };
  }
  const input = parsed.data;

  const fobTotal = sumMoney(
    input.items.map((it) => toDecimal(it.precioUnitarioFob).times(it.cantidad)),
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
      input.valorFleteOrigen !== null ? new Prisma.Decimal(input.valorFleteOrigen) : null,
    valorSeguroOrigen:
      input.valorSeguroOrigen !== null ? new Prisma.Decimal(input.valorSeguroOrigen) : null,
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
          select: { estado: true, asientoId: true, asientoZonaPrimariaId: true },
        });
        if (actual?.estado === EmbarqueEstado.CERRADO) {
          throw new Error(
            "El embarque está CERRADO y no puede editarse. Anule el asiento primero.",
          );
        }
        if (actual?.asientoZonaPrimariaId) {
          throw new Error(
            'El embarque tiene Zona Primaria confirmada y no puede editarse — sus valores y stock ya están contabilizados. Use "Revertir zona primaria" para abrirlo a edición.',
          );
        }
        if (actual?.asientoId) {
          throw new Error(
            "El embarque tiene cierre contabilizado y no puede editarse. Anule el asiento de cierre primero.",
          );
        }
        const embarque = await tx.embarque.update({
          where: { id: input.id },
          data,
        });
        embarqueId = embarque.id;

        // Gap #3 — edición NO destructiva del packing list. En vez de
        // deleteMany+createMany (que regeneraba ids y orfanaba
        // ItemContenedor.itemEmbarqueId vía onDelete:SetNull), reconciliamos
        // por productoId (1 ItemEmbarque por producto por embarque). Así los
        // ids sobreviven y el link del packing list se mantiene.
        const itemsActuales = await tx.itemEmbarque.findMany({
          where: { embarqueId },
          select: { id: true, productoId: true },
        });
        const actualPorProducto = new Map(itemsActuales.map((i) => [i.productoId, i.id]));
        const productosInput = new Set(input.items.map((it) => it.productoId));

        for (const it of input.items) {
          const existenteId = actualPorProducto.get(it.productoId);
          if (existenteId !== undefined) {
            await tx.itemEmbarque.update({
              where: { id: existenteId },
              data: {
                cantidad: it.cantidad,
                precioUnitarioFob: money(it.precioUnitarioFob),
              },
            });
          } else {
            await tx.itemEmbarque.create({
              data: {
                embarqueId,
                productoId: it.productoId,
                cantidad: it.cantidad,
                precioUnitarioFob: money(it.precioUnitarioFob),
              },
            });
          }
        }
        // Borrar sólo los ItemEmbarque cuyo producto desapareció del input.
        const idsABorrar = itemsActuales
          .filter((i) => !productosInput.has(i.productoId))
          .map((i) => i.id);
        if (idsABorrar.length > 0) {
          await tx.itemEmbarque.deleteMany({ where: { id: { in: idsABorrar } } });
        }

        // Gap #3 — NUNCA borrar facturas EMITIDA/LEGACY_BUNDLED/ANULADA: tienen
        // (o consumieron) un asiento. Borrarlas orfanaba el asiento y la
        // re-creación saltaba números. El form de edición sólo gestiona las
        // BORRADOR (las demás van read-only y se filtran del payload), así que
        // reconciliamos borrando+recreando únicamente las BORRADOR.
        await tx.embarqueCosto.deleteMany({
          where: { embarqueId, estado: "BORRADOR" },
        });
      } else {
        const embarque = await tx.embarque.create({ data });
        embarqueId = embarque.id;

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
      }

      // IDs de costos recién creados que tengan fechaFactura — candidatos
      // a auto-emisión (asiento standalone, ADR fato gerador).
      const costosParaAutoEmitir: number[] = [];

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
            // Estado por defecto BORRADOR. Se promueve a EMITIDA al final
            // del transaction si los campos están completos.
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
        // Auto-emit cuando: fechaFactura presente + lineas > 0 + proveedor con cuenta.
        if (factura.fechaFactura && factura.lineas.length > 0) {
          costosParaAutoEmitir.push(created.id);
        }
      }

      // Auto-emit fuera del create loop para que las lineas estén persistidas.
      // Si la emisión falla (período cerrado, proveedor sin cuenta), el costo
      // queda en BORRADOR y se puede emitir manualmente desde la UI.
      for (const costoId of costosParaAutoEmitir) {
        try {
          await crearAsientoEmbarqueCosto(costoId, tx);
        } catch (err) {
          // Loggeado pero no abortamos el guardado del embarque.
          // costoId fica como argumento separado (não interpolado) pra evitar
          // log injection — Opengrep flags string concat com não-literal em log.
          console.warn(
            "No se pudo auto-emitir EmbarqueCosto:",
            costoId,
            err instanceof Error ? err.message : err,
          );
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
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
// EmbarqueCosto factura standalone — emitir / anular
// ============================================================

export type EmitirEmbarqueCostoActionResult =
  | { ok: true; asientoId: string; asientoNumero: number }
  | { ok: false; error: string };

export async function emitirEmbarqueCostoFacturaAction(
  costoId: number,
  fechaIso?: string,
): Promise<EmitirEmbarqueCostoActionResult> {
  let fecha: Date | undefined;
  if (fechaIso) {
    const d = new Date(fechaIso);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Fecha inválida." };
    }
    fecha = d;
  }
  try {
    const asiento = await crearAsientoEmbarqueCosto(costoId, undefined, fecha);
    revalidatePath("/comex/embarques");
    revalidatePath("/tesoreria/cuentas-a-pagar");
    return { ok: true, asientoId: asiento.id, asientoNumero: asiento.numero };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("emitirEmbarqueCostoFacturaAction", err);
    return { ok: false, error: "No se pudo emitir la factura." };
  }
}

export async function anularEmbarqueCostoFacturaAction(
  costoId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Bloquear anulación de factura ZP de embarque con Zona Primaria
    // ya confirmada — el costo de esta factura ya está incorporado al
    // stock ZPA. Revertir requiere primero "Revertir zona primaria".
    const costo = await db.embarqueCosto.findUnique({
      where: { id: costoId },
      select: {
        momento: true,
        embarque: { select: { codigo: true, asientoZonaPrimariaId: true } },
      },
    });
    if (costo && costo.momento === "ZONA_PRIMARIA" && costo.embarque.asientoZonaPrimariaId) {
      return {
        ok: false,
        error: `El embarque ${costo.embarque.codigo} tiene Zona Primaria confirmada — el costo de esta factura ya está incorporado al stock ZPA. Use "Revertir zona primaria" antes de anular la factura.`,
      };
    }

    await anularAsientoEmbarqueCosto(costoId);
    revalidatePath("/comex/embarques");
    revalidatePath("/tesoreria/cuentas-a-pagar");
    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("anularEmbarqueCostoFacturaAction", err);
    return { ok: false, error: "No se pudo anular la factura." };
  }
}

// ============================================================
// Confirmación de Zona Primaria (PASO 3.5)
// ============================================================
//
// Genera asiento parcial: FOB + facturas con momento === ZONA_PRIMARIA.
// La mercadería queda en 1.1.7.05 MERCADERÍAS EN TRÁNSITO sin
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
      if (embarque.items.length === 0) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo}: no tiene ítems para ingresar a Zona Primaria.`,
        );
      }

      const facturasZpActivas = embarque.costos.filter(
        (f) => f.momento === "ZONA_PRIMARIA" && f.estado !== "ANULADA",
      );
      const tieneFacturasZP = facturasZpActivas.length > 0;
      const tieneFob = Number(embarque.fobTotal) > 0;
      if (!tieneFob && !tieneFacturasZP) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo}: no hay FOB ni facturas marcadas como Zona Primaria.`,
        );
      }

      // Modelo Y (Ponte PR C): embarques CON contenedores (flag on) NO usan el
      // flujo legacy. El arribo capitaliza el costo en 1.1.7.04 (sin mover
      // stock); el primer ingreso de stock ocurre en la desconsolidación (DF).
      const tieneContenedores =
        isContenedorDesconsolidacionEnabled() &&
        (await tx.contenedor.count({ where: { embarqueId } })) > 0;
      if (tieneContenedores) {
        const asientoComex = await crearAsientoArriboComex(embarqueId, tx, fecha);
        const contabilizadoComex = await contabilizarAsiento(asientoComex.id, tx);
        await tx.embarque.update({
          where: { id: embarqueId },
          data: { fechaZonaPrimaria: fecha ?? new Date() },
        });
        return {
          asientoId: contabilizadoComex.id,
          asientoNumero: contabilizadoComex.numero,
        };
      }

      // Resolver el depósito ZPA antes que nada para fallar cedo si no hay.
      const depositoZpa = await resolverDepositoZpa(tx, {
        codigo: embarque.codigo,
        depositoZonaPrimariaId: embarque.depositoZonaPrimariaId,
      });

      // Calcular el rateio para el stock ZPA — solo FOB + flete/seguro
      // origen + facturas ZP (sin tributos aduaneros).
      const rateioItems = calcularRateioZonaPrimaria(
        {
          fobTotal: embarque.fobTotal,
          embarqueTipoCambio: embarque.tipoCambio,
          costosZp: facturasZpActivas.flatMap((f) =>
            f.lineas.map((l) => ({ subtotal: l.subtotal, tipoCambio: f.tipoCambio })),
          ),
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

      // 1) Asiento de Zona Primaria (DEBE 1.1.7.05 vs HABER proveedores).
      const asiento = await crearAsientoZonaPrimaria(embarqueId, tx, fecha);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // 2) Ingreso de stock físico en el depósito ZPA.
      const fechaIngreso = fecha ?? new Date();
      await aplicarIngresoEmbarqueZpa(tx, {
        depositoZpaId: depositoZpa.id,
        fecha: fechaIngreso,
        items: rateioItems.map((r) => ({
          itemEmbarqueId: r.id,
          productoId: r.productoId,
          cantidad: r.cantidad,
          costoUnitario: r.costoUnitario,
        })),
      });

      // 3) Persistir fechaZonaPrimaria y, si fue resuelto via predeterminado,
      //    persistir depositoZonaPrimariaId para idempotencia futura.
      await tx.embarque.update({
        where: { id: embarqueId },
        data: {
          fechaZonaPrimaria: fechaIngreso,
          depositoZonaPrimariaId: depositoZpa.id,
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
    console.error("confirmarZonaPrimariaAction failed", err);
    return { ok: false, error: "Error inesperado al confirmar zona primaria." };
  }
}

// Revertir zona primaria — anula el asiento ZP, revierte el ingreso de
// stock en ZPA y deja el embarque disponible para corregir facturas/FOB
// y volver a confirmar. Sólo permitido si el embarque NO tiene cierre
// (asientoId) ni despachos activos.

export type RevertirZonaPrimariaResult = { ok: true } | { ok: false; error: string };

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
      const despachosActivosCount = await tx.despacho.count({
        where: {
          embarqueId,
          estado: { not: DespachoEstado.ANULADO },
        },
      });
      if (despachosActivosCount > 0) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} tiene ${despachosActivosCount} despacho(s) parcial(es) activo(s) — anule los despachos primero.`,
        );
      }
      // Modelo Y: el arribo DEBITA 1.1.7.04 sin mover stock; el traslado a
      // 1.1.7.03 + el stock del DF nacen en la desconsolidación. Si un
      // contenedor ya fue desconsolidado, anular el arribo borraría el DÉBITO
      // 1.1.7.04 dejando el traslado (HABER 1.1.7.04) y el stock huérfanos →
      // 1.1.7.04 en saldo ACREEDOR. Bloquear hasta deshacer la desconsolidación.
      const desconsolidacionesCount = await tx.desconsolidacion.count({
        where: { contenedor: { embarqueId } },
      });
      if (desconsolidacionesCount > 0) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `El embarque ${embarque.codigo} tiene ${desconsolidacionesCount} contenedor(es) desconsolidado(s) — deshaga la desconsolidación antes de revertir el arribo a zona primaria.`,
        );
      }

      // 1) Revertir el ingreso de stock en ZPA (deleta MovimientoStock
      //    ligados a ItemEmbarque + recalcula stockActual y SPD).
      await revertirIngresoEmbarque(tx, embarqueId);

      // 2) Anular el asiento ZP (DEBE 1.1.7.05 vs HABER proveedores).
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
      const despachosActivosCount = await tx.despacho.count({
        where: {
          embarqueId,
          estado: { not: DespachoEstado.ANULADO },
        },
      });
      if (despachosActivosCount > 0) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo} tiene despachos parciales activos. Use el flujo de despachos para nacionalizar, o anule los despachos primero.`,
        );
      }
      if (!embarque.depositoDestinoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El embarque ${embarque.codigo} no tiene depósito de destino asignado.`,
        );
      }
      // Bloquear cierre monolítico con destino ZPA: no tiene sentido
      // cerrar (que ingresa mercadería en 1.1.7.01) hacia un depósito
      // aduanero. Use confirmar zona primaria + despachos parciales.
      const depositoDestino = await tx.deposito.findUnique({
        where: { id: embarque.depositoDestinoId },
        select: { nombre: true, tipo: true },
      });
      if (depositoDestino?.tipo === "ZONA_PRIMARIA") {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El depósito destino "${depositoDestino.nombre}" es tipo Zona Primaria. Use "Confirmar zona primaria" y luego despachos parciales en lugar de cierre monolítico.`,
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
      // Excluimos facturas ANULADA: no contribuyen al costo del inventario.
      const costosRateio = embarque.costos
        .filter((factura) => factura.estado !== "ANULADA")
        .flatMap((factura) =>
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
