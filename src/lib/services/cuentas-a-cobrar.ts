import "server-only";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, VentaEstado } from "@/generated/prisma/client";

// ============================================================
// Cuentas a cobrar — espelha cuentas-a-pagar pero del lado activo.
// Saldo deudor (DEBE - HABER > 0) en cuentas de clientes (1.1.3.x).
// Las ventas debitan la cuenta del cliente (o fallback 1.1.3.01).
// Los cobros (movimiento COBRO) acreditan la misma cuenta — el saldo
// pendiente queda como neto entre DEBE de ventas y HABER de cobros.
// ============================================================

export type ClienteAsociado = {
  id: string;
  nombre: string;
  cuit: string | null;
  estado: string;
};

export type CxCRow = {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
  clientes: ClienteAsociado[];
};

export type CuentasACobrar = {
  clientes: CxCRow[]; // 1.1.3.x — saldos por cliente
  valoresACobrar: CxCRow[]; // 1.1.4.20 — cheques de terceros en cartera
  totalGeneral: string;
};

const PREFIXES = {
  CLIENTES: "1.1.3.",
  VALORES: "1.1.4.20",
} as const;

export async function getCuentasACobrar(): Promise<CuentasACobrar> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      activa: true,
      OR: [{ codigo: { startsWith: PREFIXES.CLIENTES } }, { codigo: PREFIXES.VALORES }],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      clientes: {
        select: {
          id: true,
          nombre: true,
          cuit: true,
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

  // Saldo deudor = DEBE - HABER (positivo = nos deben)
  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const debe = toDecimal(s._sum.debe ?? 0);
      const haber = toDecimal(s._sum.haber ?? 0);
      return [s.cuentaId, debe.minus(haber).toFixed(2)];
    }),
  );

  const clientes: CxCRow[] = [];
  const valoresACobrar: CxCRow[] = [];
  let totalGeneral = toDecimal(0);

  for (const c of cuentas) {
    if (c.tipo !== "ANALITICA") continue;
    const saldoStr = saldoPorCuenta.get(c.id) ?? "0";
    const saldo = toDecimal(saldoStr);
    if (!saldo.gt(0)) continue;

    const row: CxCRow = {
      cuentaId: c.id,
      cuentaCodigo: c.codigo,
      cuentaNombre: c.nombre,
      saldo: saldoStr,
      clientes: c.clientes,
    };

    if (c.codigo === PREFIXES.VALORES) {
      valoresACobrar.push(row);
    } else if (c.codigo.startsWith(PREFIXES.CLIENTES)) {
      clientes.push(row);
    }

    totalGeneral = totalGeneral.plus(saldo);
  }

  return {
    clientes,
    valoresACobrar,
    totalGeneral: totalGeneral.toFixed(2),
  };
}

// ============================================================
// Saldos por cliente con aging (vencidas / próximas / al día)
// ============================================================

export type VentaPendiente = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null; // negativo = vencida hace N días
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS
  moneda: string;
};

export type SaldoClienteAging = {
  clienteId: string;
  clienteNombre: string;
  cuit: string | null;
  cuentaContableId: number | null;
  cuentaCodigo: string | null;
  saldoTotal: string; // contable, via cuenta — la verdad
  vencido: string;
  proximo: string; // ≤ 7 días
  alDia: string;
  ventas: VentaPendiente[];
};

const DAY_MS = 86_400_000;

export async function getSaldosPorClienteConAging(): Promise<SaldoClienteAging[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const clientes = await db.cliente.findMany({
    select: {
      id: true,
      nombre: true,
      cuit: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true } },
    },
    orderBy: { nombre: "asc" },
  });

  const cuentaIds = clientes
    .map((c) => c.cuentaContableId)
    .filter((id): id is number => id !== null);

  // Saldo contable por cuenta = DEBE - HABER (positivo = saldo deudor)
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
      const debe = toDecimal(s._sum.debe ?? 0);
      const haber = toDecimal(s._sum.haber ?? 0);
      return [s.cuentaId, debe.minus(haber).toFixed(2)];
    }),
  );

  // Cobros efectivos por (cuenta cliente, asiento): neto HABER - DEBE > 0.
  // Mismo enfoque que cuentas-a-pagar pero invertido. Si un asiento HABER
  // bruto en la cuenta del cliente y luego DEBE parcial (por ajuste), el
  // cobro real es el neto HABER del asiento. Tokens vienen sólo de las
  // líneas HABER (las DEBE suelen ser genéricas tipo "Saldo ajuste").
  const lineasTodas =
    cuentaIds.length > 0
      ? await db.lineaAsiento.findMany({
          where: {
            cuentaId: { in: cuentaIds },
            asiento: { estado: AsientoEstado.CONTABILIZADO },
          },
          select: {
            cuentaId: true,
            asientoId: true,
            debe: true,
            haber: true,
            descripcion: true,
          },
        })
      : [];

  function tokensDescripcion(desc: string | null): Set<string> {
    if (!desc) return new Set();
    return new Set(desc.split(/[\s—,;]+/).filter((t) => t.length > 0));
  }

  type AsientoCuentaInfo = {
    netoCobro: ReturnType<typeof toDecimal>;
    tokens: Set<string>;
  };
  const porAsientoCuenta = new Map<string, AsientoCuentaInfo>();
  for (const l of lineasTodas) {
    const key = `${l.cuentaId}::${l.asientoId}`;
    let info = porAsientoCuenta.get(key);
    if (!info) {
      info = { netoCobro: toDecimal(0), tokens: new Set() };
      porAsientoCuenta.set(key, info);
    }
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    // Neto cobro = HABER - DEBE en la cuenta del cliente
    info.netoCobro = info.netoCobro.plus(haber).minus(debe);
    if (haber.gt(0)) {
      for (const t of tokensDescripcion(l.descripcion)) info.tokens.add(t);
    }
  }

  const cobrosPorCuentaTokens = new Map<
    number,
    Array<{ tokens: Set<string>; haber: ReturnType<typeof toDecimal> }>
  >();
  for (const [key, info] of porAsientoCuenta) {
    if (info.netoCobro.lte(0.005)) continue;
    const cuentaId = Number(key.split("::")[0]);
    const arr = cobrosPorCuentaTokens.get(cuentaId) ?? [];
    arr.push({ tokens: info.tokens, haber: info.netoCobro });
    cobrosPorCuentaTokens.set(cuentaId, arr);
  }

  const TOKENS_GENERICOS = new Set(["Venta", "venta", "Cobro", "cobro", "Factura", "factura"]);

  function montoCobradoVenta(numero: string, cuentaId: number | null) {
    if (cuentaId === null) return toDecimal(0);
    const lineas = cobrosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    const numeroTokens = numero.split(/[\s—,;]+/).filter((t) => t.length > 0);
    if (numeroTokens.length === 0) return toDecimal(0);
    const tokensEspecificos = numeroTokens.filter((t) => !TOKENS_GENERICOS.has(t));
    if (tokensEspecificos.length === 0) return toDecimal(0);

    let cobrado = toDecimal(0);
    for (const l of lineas) {
      const todosPresentes = numeroTokens.every((t) => l.tokens.has(t));
      if (todosPresentes) cobrado = cobrado.plus(l.haber);
    }
    return cobrado;
  }

  // Ventas EMITIDAS (no canceladas ni borrador)
  const ventas = await db.venta.findMany({
    where: { estado: VentaEstado.EMITIDA },
    select: {
      id: true,
      numero: true,
      fecha: true,
      fechaVencimiento: true,
      total: true,
      tipoCambio: true,
      moneda: true,
      clienteId: true,
    },
  });

  function clasificar(fechaVenc: Date | null): {
    dias: number | null;
    bucket: VentaPendiente["bucket"];
  } {
    if (!fechaVenc) return { dias: null, bucket: "sin_fecha" };
    const venc = new Date(fechaVenc);
    venc.setHours(0, 0, 0, 0);
    const dias = Math.round((venc.getTime() - today.getTime()) / DAY_MS);
    if (dias < 0) return { dias, bucket: "vencida" };
    if (dias <= 7) return { dias, bucket: "proxima" };
    return { dias, bucket: "al_dia" };
  }

  const cuentaPorCliente = new Map<string, number | null>(
    clientes.map((c) => [c.id, c.cuentaContableId]),
  );

  type VentaInterna = VentaPendiente & {
    totalArs: ReturnType<typeof toDecimal>;
    cobradoNumero: ReturnType<typeof toDecimal>;
    cobradoFifo: ReturnType<typeof toDecimal>;
  };

  const ventasPorCliente = new Map<string, VentaInterna[]>();

  for (const v of ventas) {
    const totalArs = toDecimal(v.total).times(toDecimal(v.tipoCambio));
    const { dias, bucket } = clasificar(v.fechaVencimiento);
    const cuentaId = cuentaPorCliente.get(v.clienteId) ?? null;
    const cobradoNumero = montoCobradoVenta(v.numero, cuentaId);

    const arr = ventasPorCliente.get(v.clienteId) ?? [];
    arr.push({
      id: v.id,
      numero: v.numero,
      fecha: v.fecha.toISOString(),
      fechaVencimiento: v.fechaVencimiento?.toISOString() ?? null,
      diasParaVencer: dias,
      bucket,
      monto: totalArs.toFixed(2),
      moneda: v.moneda,
      totalArs,
      cobradoNumero,
      cobradoFifo: toDecimal(0),
    });
    ventasPorCliente.set(v.clienteId, arr);
  }

  // Reconciliación FIFO para cobros sin match por numero. Por cuenta del
  // cliente: total cobros (de cobrosPorCuentaTokens) menos los ya
  // imputados por match numero → resto se aplica FIFO por fecha de venta.
  const cobrosTotalesPorCuenta = new Map<number, ReturnType<typeof toDecimal>>();
  for (const [cuentaId, lineas] of cobrosPorCuentaTokens) {
    const total = lineas.reduce((acc, l) => acc.plus(l.haber), toDecimal(0));
    cobrosTotalesPorCuenta.set(cuentaId, total);
  }

  for (const [clienteId, lista] of ventasPorCliente) {
    const cuentaId = cuentaPorCliente.get(clienteId);
    if (cuentaId == null) continue;
    const totalCobrosCuenta = cobrosTotalesPorCuenta.get(cuentaId) ?? toDecimal(0);
    const sumaImputadaNumero = lista.reduce((acc, v) => acc.plus(v.cobradoNumero), toDecimal(0));
    let resto = totalCobrosCuenta.minus(sumaImputadaNumero);
    if (resto.lte(0.005)) continue;

    // FIFO por fecha de emisión
    const ordenadas = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const v of ordenadas) {
      if (resto.lte(0.005)) break;
      const pendiente = v.totalArs.minus(v.cobradoNumero).minus(v.cobradoFifo);
      if (pendiente.lte(0.005)) continue;
      const aplicar = resto.gt(pendiente) ? pendiente : resto;
      v.cobradoFifo = v.cobradoFifo.plus(aplicar);
      resto = resto.minus(aplicar);
    }
  }

  const resultado: SaldoClienteAging[] = [];
  for (const c of clientes) {
    const lista = ventasPorCliente.get(c.id) ?? [];
    const pendientes: VentaPendiente[] = [];
    let vencido = toDecimal(0);
    let proximo = toDecimal(0);
    let alDia = toDecimal(0);

    for (const v of lista) {
      const cobradoTotal = v.cobradoNumero.plus(v.cobradoFifo);
      const pendienteArs = v.totalArs.minus(cobradoTotal);
      if (pendienteArs.lte(0.005)) continue;
      const pendienteStr = pendienteArs.toFixed(2);
      pendientes.push({
        id: v.id,
        numero: v.numero,
        fecha: v.fecha,
        fechaVencimiento: v.fechaVencimiento,
        diasParaVencer: v.diasParaVencer,
        bucket: v.bucket,
        monto: pendienteStr,
        moneda: v.moneda,
      });
      if (v.bucket === "vencida") vencido = vencido.plus(pendienteArs);
      else if (v.bucket === "proxima") proximo = proximo.plus(pendienteArs);
      else alDia = alDia.plus(pendienteArs);
    }

    const saldoContable = c.cuentaContableId
      ? toDecimal(saldoPorCuenta.get(c.cuentaContableId) ?? "0")
      : toDecimal(0);

    if (saldoContable.lte(0.005) && pendientes.length === 0) continue;

    pendientes.sort((a, b) => {
      const aDias = a.diasParaVencer ?? Number.POSITIVE_INFINITY;
      const bDias = b.diasParaVencer ?? Number.POSITIVE_INFINITY;
      return aDias - bDias;
    });

    resultado.push({
      clienteId: c.id,
      clienteNombre: c.nombre,
      cuit: c.cuit,
      cuentaContableId: c.cuentaContableId,
      cuentaCodigo: c.cuentaContable?.codigo ?? null,
      saldoTotal: saldoContable.toFixed(2),
      vencido: vencido.toFixed(2),
      proximo: proximo.toFixed(2),
      alDia: alDia.toFixed(2),
      ventas: pendientes,
    });
  }

  return resultado.sort((a, b) =>
    toDecimal(b.saldoTotal).minus(toDecimal(a.saldoTotal)).toNumber(),
  );
}
