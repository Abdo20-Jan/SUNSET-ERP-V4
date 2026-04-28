import "server-only";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  CompraEstado,
  EmbarqueEstado,
} from "@/generated/prisma/client";

export type ProveedorAsociado = {
  id: string;
  nombre: string;
  cuit: string | null;
  pais: string;
  estado: string;
};

export type CxPRow = {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
  proveedores: ProveedorAsociado[];
};

export type CuentasAPagar = {
  proveedoresComerciales: CxPRow[]; // 2.1.1.x
  aduana: CxPRow[]; // 2.1.5.x
  fiscales: CxPRow[]; // 2.1.3.x
  totalGeneral: string;
};

const PREFIXES = {
  PROVEEDORES: "2.1.1.",
  ADUANA: "2.1.5.",
  FISCALES: "2.1.3.",
} as const;

export async function getCuentasAPagar(): Promise<CuentasAPagar> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      activa: true,
      OR: [
        { codigo: { startsWith: PREFIXES.PROVEEDORES } },
        { codigo: { startsWith: PREFIXES.ADUANA } },
        { codigo: { startsWith: PREFIXES.FISCALES } },
      ],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      proveedores: {
        select: {
          id: true,
          nombre: true,
          cuit: true,
          pais: true,
          estado: true,
        },
        orderBy: { nombre: "asc" },
      },
    },
    orderBy: { codigo: "asc" },
  });

  const cuentaIds = cuentas.map((c) => c.id);
  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  const proveedoresComerciales: CxPRow[] = [];
  const aduana: CxPRow[] = [];
  const fiscales: CxPRow[] = [];
  let totalGeneral = toDecimal(0);

  for (const c of cuentas) {
    if (c.tipo !== "ANALITICA") continue;
    const saldoStr = saldoPorCuenta.get(c.id) ?? "0";
    const saldo = toDecimal(saldoStr);
    if (!saldo.gt(0)) continue;

    const row: CxPRow = {
      cuentaId: c.id,
      cuentaCodigo: c.codigo,
      cuentaNombre: c.nombre,
      saldo: saldoStr,
      proveedores: c.proveedores,
    };

    if (c.codigo.startsWith(PREFIXES.PROVEEDORES)) {
      proveedoresComerciales.push(row);
    } else if (c.codigo.startsWith(PREFIXES.ADUANA)) {
      aduana.push(row);
    } else if (c.codigo.startsWith(PREFIXES.FISCALES)) {
      fiscales.push(row);
    }

    totalGeneral = totalGeneral.plus(saldo);
  }

  return {
    proveedoresComerciales,
    aduana,
    fiscales,
    totalGeneral: totalGeneral.toFixed(2),
  };
}

// Saldo por proveedor individual (cuando cada proveedor tiene su propia
// cuenta analítica). Útil para la lista "Pendientes por proveedor".
export type SaldoProveedor = {
  proveedorId: string;
  proveedorNombre: string;
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
};

export async function getSaldosPorProveedor(): Promise<SaldoProveedor[]> {
  const proveedores = await db.proveedor.findMany({
    where: { cuentaContableId: { not: null } },
    select: {
      id: true,
      nombre: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
    },
    orderBy: { nombre: "asc" },
  });

  const cuentaIds = proveedores
    .map((p) => p.cuentaContableId)
    .filter((id): id is number => id !== null);

  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  return proveedores
    .map((p) => ({
      proveedorId: p.id,
      proveedorNombre: p.nombre,
      cuentaId: p.cuentaContableId!,
      cuentaCodigo: p.cuentaContable!.codigo,
      cuentaNombre: p.cuentaContable!.nombre,
      saldo: saldoPorCuenta.get(p.cuentaContableId!) ?? "0.00",
    }))
    .filter((r) => toDecimal(r.saldo).gt(0));
}

// ============================================================
// Saldos con aging (por proveedor, mostrando vencimientos)
// ============================================================

export type FacturaPendiente = {
  origen: "compra" | "embarque";
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null; // negativo = vencida hace N días
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS (Compra: total. EmbarqueCosto: lineas convertidas a ARS)
  moneda: string;
};

export type SaldoProveedorAging = {
  proveedorId: string;
  proveedorNombre: string;
  cuit: string | null;
  pais: string;
  cuentaContableId: number | null;
  saldoTotal: string; // contable, vía cuenta. Es la verdad.
  vencido: string;
  proximo: string; // ≤ 7 días
  alDia: string;
  facturas: FacturaPendiente[];
};

const DAY_MS = 86_400_000;

export async function getSaldosPorProveedorConAging(): Promise<
  SaldoProveedorAging[]
> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const proveedores = await db.proveedor.findMany({
    select: {
      id: true,
      nombre: true,
      cuit: true,
      pais: true,
      cuentaContableId: true,
    },
    orderBy: { nombre: "asc" },
  });

  // Saldos contables por cuenta del proveedor (haber - debe = lo que se debe)
  const cuentaIds = proveedores
    .map((p) => p.cuentaContableId)
    .filter((id): id is number => id !== null);

  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  // Compras EMITIDAS o RECIBIDAS, no canceladas
  const compras = await db.compra.findMany({
    where: { estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] } },
    select: {
      id: true,
      numero: true,
      fecha: true,
      fechaVencimiento: true,
      total: true,
      tipoCambio: true,
      moneda: true,
      proveedorId: true,
    },
  });

  // EmbarqueCostos cuyo embarque está CERRADO (asientos contabilizados)
  const costos = await db.embarqueCosto.findMany({
    where: { embarque: { estado: EmbarqueEstado.CERRADO } },
    select: {
      id: true,
      facturaNumero: true,
      fechaFactura: true,
      fechaVencimiento: true,
      tipoCambio: true,
      moneda: true,
      proveedorId: true,
      iva: true,
      iibb: true,
      otros: true,
      lineas: { select: { subtotal: true } },
    },
  });

  function clasificar(
    fechaVenc: Date | null,
  ): { dias: number | null; bucket: FacturaPendiente["bucket"] } {
    if (!fechaVenc) return { dias: null, bucket: "sin_fecha" };
    const venc = new Date(fechaVenc);
    venc.setHours(0, 0, 0, 0);
    const dias = Math.round((venc.getTime() - today.getTime()) / DAY_MS);
    if (dias < 0) return { dias, bucket: "vencida" };
    if (dias <= 7) return { dias, bucket: "proxima" };
    return { dias, bucket: "al_dia" };
  }

  const facturasPorProveedor = new Map<string, FacturaPendiente[]>();

  for (const c of compras) {
    const totalArs = toDecimal(c.total).times(toDecimal(c.tipoCambio));
    const { dias, bucket } = clasificar(c.fechaVencimiento);
    const arr = facturasPorProveedor.get(c.proveedorId) ?? [];
    arr.push({
      origen: "compra",
      id: c.id,
      numero: c.numero,
      fecha: c.fecha.toISOString(),
      fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
      diasParaVencer: dias,
      bucket,
      monto: totalArs.toFixed(2),
      moneda: c.moneda,
    });
    facturasPorProveedor.set(c.proveedorId, arr);
  }

  for (const c of costos) {
    const subtotalLineas = c.lineas.reduce(
      (acc, l) => acc.plus(toDecimal(l.subtotal)),
      toDecimal(0),
    );
    const totalMoneda = subtotalLineas
      .plus(toDecimal(c.iva))
      .plus(toDecimal(c.iibb))
      .plus(toDecimal(c.otros));
    const totalArs = totalMoneda.times(toDecimal(c.tipoCambio));
    const { dias, bucket } = clasificar(c.fechaVencimiento);
    const arr = facturasPorProveedor.get(c.proveedorId) ?? [];
    arr.push({
      origen: "embarque",
      id: String(c.id),
      numero: c.facturaNumero ?? `Factura #${c.id}`,
      fecha: (c.fechaFactura ?? new Date()).toISOString(),
      fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
      diasParaVencer: dias,
      bucket,
      monto: totalArs.toFixed(2),
      moneda: c.moneda,
    });
    facturasPorProveedor.set(c.proveedorId, arr);
  }

  const result: SaldoProveedorAging[] = [];
  for (const p of proveedores) {
    const facturas = facturasPorProveedor.get(p.id) ?? [];
    const saldoContable =
      p.cuentaContableId != null
        ? saldoPorCuenta.get(p.cuentaContableId) ?? "0.00"
        : "0.00";

    if (toDecimal(saldoContable).lte(0) && facturas.length === 0) continue;

    let vencido = toDecimal(0);
    let proximo = toDecimal(0);
    let alDia = toDecimal(0);
    for (const f of facturas) {
      const m = toDecimal(f.monto);
      if (f.bucket === "vencida") vencido = vencido.plus(m);
      else if (f.bucket === "proxima") proximo = proximo.plus(m);
      else alDia = alDia.plus(m);
    }

    facturas.sort((a, b) => {
      const da = a.diasParaVencer ?? Number.POSITIVE_INFINITY;
      const db_ = b.diasParaVencer ?? Number.POSITIVE_INFINITY;
      return da - db_;
    });

    result.push({
      proveedorId: p.id,
      proveedorNombre: p.nombre,
      cuit: p.cuit,
      pais: p.pais,
      cuentaContableId: p.cuentaContableId,
      saldoTotal: saldoContable,
      vencido: vencido.toFixed(2),
      proximo: proximo.toFixed(2),
      alDia: alDia.toFixed(2),
      facturas,
    });
  }

  result.sort((a, b) => toDecimal(b.vencido).minus(toDecimal(a.vencido)).toNumber());
  return result;
}

// ============================================================
// Cuentas a pagar agrupadas por EMBARQUE — para "pagar todos los
// costos de un embarque a un proveedor en un único movimiento".
// ============================================================

export type CuentaAPagarPorEmbarque = {
  embarqueId: string;
  embarqueCodigo: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorCuentaContableId: number | null;
  proveedorCuentaCodigo: string | null;
  facturas: Array<{
    id: number;
    numero: string;
    fecha: string;
    fechaVencimiento: string | null;
    totalArs: string;
  }>;
  totalArs: string;
  // Saldo vivo de la cuenta del proveedor (haber − debe a través de
  // todos los asientos contabilizados). Si la cuenta está en cero, el
  // grupo se omite — todo está pagado. Si > 0, ese monto es la deuda
  // real (puede cubrir N embarques pendientes del mismo proveedor).
  saldoVivoProveedorArs: string;
  // Monto sugerido para pagar este grupo: min(totalArs, saldoVivo).
  // Si totalArs > saldoVivo, indica que ya hubo pagos parciales
  // (probablemente de otros embarques del mismo proveedor) reduciendo
  // la deuda viva.
  pendienteArs: string;
};

export async function getCuentasAPagarPorEmbarque(): Promise<
  CuentaAPagarPorEmbarque[]
> {
  // EmbarqueCostos cuyo embarque está CERRADO (asientos contabilizados)
  const costos = await db.embarqueCosto.findMany({
    where: { embarque: { estado: EmbarqueEstado.CERRADO } },
    select: {
      id: true,
      facturaNumero: true,
      fechaFactura: true,
      fechaVencimiento: true,
      tipoCambio: true,
      moneda: true,
      iva: true,
      iibb: true,
      otros: true,
      lineas: { select: { subtotal: true } },
      embarque: { select: { id: true, codigo: true } },
      proveedor: {
        select: {
          id: true,
          nombre: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true } },
        },
      },
    },
    orderBy: { fechaFactura: "desc" },
  });

  // Agrupar por (embarqueId + proveedorId)
  type GroupKey = string;
  const groups = new Map<GroupKey, CuentaAPagarPorEmbarque>();

  for (const c of costos) {
    const subtotalLineas = c.lineas.reduce(
      (acc, l) => acc.plus(toDecimal(l.subtotal)),
      toDecimal(0),
    );
    const totalMoneda = subtotalLineas
      .plus(toDecimal(c.iva))
      .plus(toDecimal(c.iibb))
      .plus(toDecimal(c.otros));
    const totalArs = totalMoneda.times(toDecimal(c.tipoCambio));

    const key: GroupKey = `${c.embarque.id}::${c.proveedor.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        embarqueId: c.embarque.id,
        embarqueCodigo: c.embarque.codigo,
        proveedorId: c.proveedor.id,
        proveedorNombre: c.proveedor.nombre,
        proveedorCuentaContableId: c.proveedor.cuentaContableId,
        proveedorCuentaCodigo: c.proveedor.cuentaContable?.codigo ?? null,
        facturas: [],
        totalArs: "0",
        saldoVivoProveedorArs: "0",
        pendienteArs: "0",
      };
      groups.set(key, group);
    }
    group.facturas.push({
      id: c.id,
      numero: c.facturaNumero ?? `Factura #${c.id}`,
      fecha: (c.fechaFactura ?? new Date()).toISOString(),
      fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
      totalArs: totalArs.toFixed(2),
    });
  }

  // Calcular total + filtrar grupos donde el saldo del proveedor en su
  // cuenta es 0 (todo ya pagado vía algún movimiento previo).
  const result: CuentaAPagarPorEmbarque[] = [];

  // Saldos vivos por cuenta (haber - debe). Si <=0, el proveedor no
  // debe nada — ese grupo ya está pagado.
  const cuentaIds = Array.from(groups.values())
    .map((g) => g.proveedorCuentaContableId)
    .filter((id): id is number => id !== null);
  const sums =
    cuentaIds.length > 0
      ? await db.lineaAsiento.groupBy({
          by: ["cuentaId"],
          where: {
            cuentaId: { in: cuentaIds },
            asiento: { estado: AsientoEstado.CONTABILIZADO },
          },
          _sum: { debe: true, haber: true },
        })
      : [];
  const saldoVivoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  for (const g of groups.values()) {
    const totalGrupo = g.facturas.reduce(
      (acc, f) => acc.plus(toDecimal(f.totalArs)),
      toDecimal(0),
    );
    g.totalArs = totalGrupo.toFixed(2);

    const saldoVivo = g.proveedorCuentaContableId
      ? toDecimal(saldoVivoPorCuenta.get(g.proveedorCuentaContableId) ?? "0")
      : toDecimal(0);
    g.saldoVivoProveedorArs = saldoVivo.toFixed(2);

    // Pendiente = min(totalGrupo, saldoVivo). Si saldoVivo <= 0, el
    // proveedor ya no debe nada (todos los embarques con él pagados):
    // omitir grupo.
    if (saldoVivo.lte(0)) continue;
    const pendiente = saldoVivo.gt(totalGrupo) ? totalGrupo : saldoVivo;
    g.pendienteArs = pendiente.toFixed(2);

    g.facturas.sort((a, b) => a.fecha.localeCompare(b.fecha));
    result.push(g);
  }

  // Orden: embarque DESC, proveedor ASC
  result.sort((a, b) => {
    if (a.embarqueCodigo !== b.embarqueCodigo) {
      return b.embarqueCodigo.localeCompare(a.embarqueCodigo);
    }
    return a.proveedorNombre.localeCompare(b.proveedorNombre);
  });

  return result;
}

// ============================================================
// VEP / Despacho aduanero por embarque — todos los tributos
// (DIE, Tasa, IVA imp, Arancel SIM, IIBB, Ganancias) que se
// pagan en un único Volante Electrónico de Pago.
// ============================================================

const PREFIXES_TRIBUTOS_DESPACHO = ["2.1.5.", "2.1.3."] as const;

export type CuentaVepLinea = {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  monto: string; // ARS — monto del asiento del embarque (HABER en esa cuenta)
};

export type VepEmbarque = {
  embarqueId: string;
  embarqueCodigo: string;
  asientoId: string | null;
  asientoNumero: number | null;
  fecha: string; // ISO
  cuentas: CuentaVepLinea[];
  totalArs: string;
  pagado: boolean; // true si la suma de DEBEs posteriores cubre el HABER
};

export async function getVepEmbarques(): Promise<VepEmbarque[]> {
  // Embarques CERRADOS con asiento contabilizado
  const embarques = await db.embarque.findMany({
    where: {
      estado: EmbarqueEstado.CERRADO,
      asientoId: { not: null },
    },
    select: {
      id: true,
      codigo: true,
      asientoId: true,
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          lineas: {
            where: {
              cuenta: {
                OR: PREFIXES_TRIBUTOS_DESPACHO.map((p) => ({
                  codigo: { startsWith: p },
                })),
              },
            },
            select: {
              haber: true,
              debe: true,
              cuenta: {
                select: { id: true, codigo: true, nombre: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const result: VepEmbarque[] = [];

  for (const e of embarques) {
    if (!e.asiento) continue;

    // Sumar HABER por cuenta (eso es el VEP del embarque)
    const porCuenta = new Map<number, CuentaVepLinea>();
    for (const l of e.asiento.lineas) {
      const haber = toDecimal(l.haber);
      if (haber.lte(0)) continue;
      const existing = porCuenta.get(l.cuenta.id);
      if (existing) {
        existing.monto = toDecimal(existing.monto).plus(haber).toFixed(2);
      } else {
        porCuenta.set(l.cuenta.id, {
          cuentaId: l.cuenta.id,
          cuentaCodigo: l.cuenta.codigo,
          cuentaNombre: l.cuenta.nombre,
          monto: haber.toFixed(2),
        });
      }
    }

    if (porCuenta.size === 0) continue;

    const cuentas = Array.from(porCuenta.values()).sort((a, b) =>
      a.cuentaCodigo.localeCompare(b.cuentaCodigo),
    );
    const totalArs = cuentas
      .reduce((acc, c) => acc.plus(toDecimal(c.monto)), toDecimal(0))
      .toFixed(2);

    // Detectar si ya fue pagado: buscar asientos posteriores con DEBE en
    // las mismas cuentas con descripción que mencione el código del embarque.
    const cuentaIds = cuentas.map((c) => c.cuentaId);
    const debesPosteriores = await db.lineaAsiento.findMany({
      where: {
        cuentaId: { in: cuentaIds },
        debe: { gt: 0 },
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          createdAt: { gt: e.asiento.fecha },
          descripcion: { contains: e.codigo },
        },
      },
      select: { debe: true },
    });
    const totalDebePosterior = debesPosteriores.reduce(
      (acc, l) => acc.plus(toDecimal(l.debe)),
      toDecimal(0),
    );
    const pagado = totalDebePosterior.gte(toDecimal(totalArs));

    result.push({
      embarqueId: e.id,
      embarqueCodigo: e.codigo,
      asientoId: e.asiento.id,
      asientoNumero: e.asiento.numero,
      fecha: e.asiento.fecha.toISOString(),
      cuentas,
      totalArs,
      pagado,
    });
  }

  return result;
}
