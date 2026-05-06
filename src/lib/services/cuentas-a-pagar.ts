import "server-only";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { VEP_ADUANA_CODIGOS } from "@/lib/services/cuenta-registry";
import {
  AsientoEstado,
  CompraEstado,
  EmbarqueEstado,
  GastoEstado,
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
  origen: "compra" | "embarque" | "gasto";
  id: string;
  numero: string;
  // Documento mãe: código del embarque (origen=embarque), número interno
  // del gasto (origen=gasto), número del pedido de compra (origen=compra,
  // null si la compra no fue originada por una OC). Sirve para
  // trazabilidad — saber de qué viene la factura sin tener que abrirla.
  referencia: string | null;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null; // negativo = vencida hace N días
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS (Compra/Gasto: total convertido. EmbarqueCosto: lineas convertidas a ARS)
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

export async function getSaldosPorProveedorConAging(): Promise<SaldoProveedorAging[]> {
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

  // Pagos efectivos por (cuenta del proveedor, asiento): se calcula el NETO
  // (sum DEBE − sum HABER) por asiento en la cuenta del proveedor. Esto
  // descuenta correctamente flows tipo "Pago múltiple intermediário" donde
  // un asiento debita el total bruto y luego acredita parte como "Saldo
  // pendiente con intermediário" en la misma cuenta — el pago real es el
  // neto que sale del banco, no el DEBE bruto.
  //
  // Tokens de match = unión de tokens de las líneas DEBE del asiento en la
  // cuenta (las líneas HABER suelen ser descripciones genéricas tipo
  // "Saldo pendiente" sin identificadores).
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

  // Map (cuentaId::asientoId) → { neto, tokens }
  type AsientoCuentaInfo = {
    neto: ReturnType<typeof toDecimal>;
    tokens: Set<string>;
  };
  const porAsientoCuenta = new Map<string, AsientoCuentaInfo>();
  for (const l of lineasTodas) {
    const key = `${l.cuentaId}::${l.asientoId}`;
    let info = porAsientoCuenta.get(key);
    if (!info) {
      info = { neto: toDecimal(0), tokens: new Set() };
      porAsientoCuenta.set(key, info);
    }
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    info.neto = info.neto.plus(debe).minus(haber);
    // Solo líneas DEBE contribuyen tokens — HABER suele ser genérico
    if (debe.gt(0)) {
      for (const t of tokensDescripcion(l.descripcion)) info.tokens.add(t);
    }
  }

  // Por cuentaId, lista de pagos efectivos (neto > 0). Para Layer 1 y 2 se
  // usa este "debe" que ya es el neto del asiento.
  const pagosPorCuentaTokens = new Map<
    number,
    Array<{ tokens: Set<string>; debe: ReturnType<typeof toDecimal> }>
  >();
  for (const [key, info] of porAsientoCuenta) {
    if (info.neto.lte(0.005)) continue; // asiento sin pago efectivo neto
    const cuentaId = Number(key.split("::")[0]);
    const arr = pagosPorCuentaTokens.get(cuentaId) ?? [];
    arr.push({ tokens: info.tokens, debe: info.neto });
    pagosPorCuentaTokens.set(cuentaId, arr);
  }

  // Token genéricos que NÃO devem disparar match — protegem contra
  // colisão em fallbacks como "Factura #3" (genérico p/ EmbarqueCosto sem
  // facturaNumero), "Pago", "factura" etc.
  const TOKENS_GENERICOS = new Set(["Factura", "factura", "Pago", "pago"]);

  function montoPagadoFactura(numero: string, cuentaId: number | null) {
    if (cuentaId === null) return toDecimal(0);
    const lineas = pagosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    // Tokenizar el numero objetivo igual que la descripción para matchear
    // multi-token (ex: "Factura #3" → ["Factura", "#3"]).
    const numeroTokens = numero.split(/[\s—,;]+/).filter((t) => t.length > 0);
    if (numeroTokens.length === 0) return toDecimal(0);
    // Token específico = un token que NÃO seja genérico. Exigimos que
    // pelo menos UM token específico esteja presente para considerar match.
    // Caso contrário, "Factura #3" pode colidir com qualquer pago a outra
    // factura genérica do mesmo proveedor.
    const tokensEspecificos = numeroTokens.filter((t) => !TOKENS_GENERICOS.has(t));
    if (tokensEspecificos.length === 0) return toDecimal(0);

    let pagado = toDecimal(0);
    for (const l of lineas) {
      const todosPresentes = numeroTokens.every((t) => l.tokens.has(t));
      if (todosPresentes) pagado = pagado.plus(l.debe);
    }
    return pagado;
  }

  // Pagos registrados por código de embarque — sirven para detectar facturas
  // ya canceladas via flow "Pago por embarque" o "Pago múltiple", donde la
  // descripción de la línea DEBE contiene el código del embarque (formato
  // "AR-YYMMDD-NNNCN") en lugar del numero específico de la factura.
  function montoPagadoEmbarque(embarqueCodigo: string, cuentaId: number | null) {
    if (cuentaId === null) return toDecimal(0);
    const lineas = pagosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    let pagado = toDecimal(0);
    for (const l of lineas) {
      if (l.tokens.has(embarqueCodigo)) pagado = pagado.plus(l.debe);
    }
    return pagado;
  }

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
      pedidoCompra: { select: { numero: true } },
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
      embarque: { select: { codigo: true } },
    },
  });

  // Gastos contabilizados (estado = CONTABILIZADO genera saldo a pagar)
  const gastos = await db.gasto.findMany({
    where: { estado: GastoEstado.CONTABILIZADO },
    select: {
      id: true,
      numero: true,
      facturaNumero: true,
      fecha: true,
      fechaVencimiento: true,
      total: true,
      tipoCambio: true,
      moneda: true,
      proveedorId: true,
    },
  });

  function clasificar(fechaVenc: Date | null): {
    dias: number | null;
    bucket: FacturaPendiente["bucket"];
  } {
    if (!fechaVenc) return { dias: null, bucket: "sin_fecha" };
    const venc = new Date(fechaVenc);
    venc.setHours(0, 0, 0, 0);
    const dias = Math.round((venc.getTime() - today.getTime()) / DAY_MS);
    if (dias < 0) return { dias, bucket: "vencida" };
    if (dias <= 7) return { dias, bucket: "proxima" };
    return { dias, bucket: "al_dia" };
  }

  // Map proveedorId → cuentaContableId para resolver pagos
  const cuentaPorProveedor = new Map<string, number | null>(
    proveedores.map((p) => [p.id, p.cuentaContableId]),
  );

  // Estructura interna usada en las 3 pasadas de detección de pagos. Mantiene
  // el total bruto ARS y los créditos aplicados por cada layer para poder
  // cruzar pagos por embarque sin doble contabilizar lo ya descontado por
  // match de número de factura.
  type FacturaInterna = FacturaPendiente & {
    totalArs: ReturnType<typeof toDecimal>;
    pagadoNumero: ReturnType<typeof toDecimal>;
    pagadoEmbarque: ReturnType<typeof toDecimal>;
    pagadoFifo: ReturnType<typeof toDecimal>;
  };

  function registrarFactura(
    factura: FacturaPendiente,
    totalArs: ReturnType<typeof toDecimal>,
    proveedorId: string,
  ) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    const pagadoNumero = montoPagadoFactura(factura.numero, cuentaId);
    const arr = facturasPorProveedor.get(proveedorId) ?? [];
    arr.push({
      ...factura,
      totalArs,
      pagadoNumero,
      pagadoEmbarque: toDecimal(0),
      pagadoFifo: toDecimal(0),
    });
    facturasPorProveedor.set(proveedorId, arr);
  }

  const facturasPorProveedor = new Map<string, FacturaInterna[]>();

  for (const c of compras) {
    const totalArs = toDecimal(c.total).times(toDecimal(c.tipoCambio));
    const { dias, bucket } = clasificar(c.fechaVencimiento);
    registrarFactura(
      {
        origen: "compra",
        id: c.id,
        numero: c.numero,
        referencia: c.pedidoCompra?.numero ?? null,
        fecha: c.fecha.toISOString(),
        fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
        diasParaVencer: dias,
        bucket,
        monto: totalArs.toFixed(2), // sobrescrito por emitirSiPendiente
        moneda: c.moneda,
      },
      totalArs,
      c.proveedorId,
    );
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
    registrarFactura(
      {
        origen: "embarque",
        id: String(c.id),
        numero: c.facturaNumero ?? `Factura #${c.id}`,
        referencia: c.embarque.codigo,
        fecha: (c.fechaFactura ?? new Date()).toISOString(),
        fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
        diasParaVencer: dias,
        bucket,
        monto: totalArs.toFixed(2),
        moneda: c.moneda,
      },
      totalArs,
      c.proveedorId,
    );
  }

  for (const g of gastos) {
    const totalArs = toDecimal(g.total).times(toDecimal(g.tipoCambio));
    const { dias, bucket } = clasificar(g.fechaVencimiento);
    // Si facturaNumero existe, "numero" muestra el comprobante del proveedor
    // y "referencia" muestra el numero interno del gasto. Si no, ambos son
    // el mismo y la columna referencia queda vacía para no duplicar.
    const tieneFacturaNumero = g.facturaNumero != null && g.facturaNumero !== g.numero;
    registrarFactura(
      {
        origen: "gasto",
        id: g.id,
        numero: g.facturaNumero ?? g.numero,
        referencia: tieneFacturaNumero ? g.numero : null,
        fecha: g.fecha.toISOString(),
        fechaVencimiento: g.fechaVencimiento?.toISOString() ?? null,
        diasParaVencer: dias,
        bucket,
        monto: totalArs.toFixed(2),
        moneda: g.moneda,
      },
      totalArs,
      g.proveedorId,
    );
  }

  // ============================================================
  // Layer 2 — Pago por embarque (origen=embarque):
  // El flow "Pago por embarque" / "Pago múltiple" registra DEBE en la
  // cuenta del proveedor con descripción tipo "AR-YYMMDD-NNNCN — proveedor"
  // — sin numero específico de factura.
  //
  // Threshold de cobertura: solo se zera el grupo si el pago efectivo
  // (neto, computado en pagosPorCuentaTokens vía DEBE − HABER por asiento)
  // cubre ≥80% del total pendiente del grupo. Esto evita falsos positivos
  // en flows "Pago múltiple intermediário" donde el asiento debita el
  // total bruto pero acredita la mayor parte como "Saldo pendiente con
  // intermediário" en la misma cuenta — el pago real (lo que sale del
  // banco) puede ser solo 5-10% del bruto, lo que NO debe zerar las
  // facturas (Layer 3 ajusta el agregado contra saldoContable).
  //
  // Cuando supera 98%, se zera todo el grupo aunque sobre un poco de
  // residuo en saldoContable — ese residuo suele ser comisión o saldo
  // remanente con despachante que el usuario considera la factura paga.
  // (Threshold subido de 80% a 98% en 2026-05-06: 80% escondía facturas
  // con ~20% de saldo intermediário aún pendiente — el user necesita
  // verlas en pendentes para liquidar.)
  // ============================================================
  const COBERTURA_MINIMA = 0.98;

  for (const [proveedorId, fcts] of facturasPorProveedor) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    if (cuentaId === null) continue;

    // Agrupar facturas origen=embarque por código de embarque
    const porEmbarque = new Map<string, FacturaInterna[]>();
    for (const f of fcts) {
      if (f.origen !== "embarque" || !f.referencia) continue;
      const arr = porEmbarque.get(f.referencia) ?? [];
      arr.push(f);
      porEmbarque.set(f.referencia, arr);
    }

    for (const [embarqueCodigo, grupo] of porEmbarque) {
      const pagoEmbarqueTotal = montoPagadoEmbarque(embarqueCodigo, cuentaId);
      // Lo ya atribuido vía match por número (puede ser 0 si los pagos no
      // mencionan ningún número específico — caso pago por embarque puro)
      const pagoYaAtribuido = grupo.reduce((acc, f) => acc.plus(f.pagadoNumero), toDecimal(0));
      const pagoExtra = pagoEmbarqueTotal.minus(pagoYaAtribuido);
      if (pagoExtra.lte(0.005)) continue;

      const totalPendienteGrupo = grupo.reduce(
        (acc, f) => acc.plus(f.totalArs.minus(f.pagadoNumero)),
        toDecimal(0),
      );
      if (totalPendienteGrupo.lte(0.005)) continue;

      // Threshold: cobertura efectiva debe ser ≥ COBERTURA_MINIMA del total
      const cobertura = pagoExtra.div(totalPendienteGrupo).toNumber();
      if (cobertura < COBERTURA_MINIMA) continue;

      // Pago efetivo ≥ 80% del total — zerar todo el grupo
      for (const f of grupo) {
        f.pagadoEmbarque = f.totalArs.minus(f.pagadoNumero);
      }
    }
  }

  const result: SaldoProveedorAging[] = [];
  for (const p of proveedores) {
    const facturasInternas = facturasPorProveedor.get(p.id) ?? [];
    const saldoContable =
      p.cuentaContableId != null ? (saldoPorCuenta.get(p.cuentaContableId) ?? "0.00") : "0.00";
    const saldoContableDec = toDecimal(saldoContable);

    // El ledger contable es la verdad: si saldo ≤ 0 (no se debe nada),
    // descartar todas las facturas — pagas via flow legacy / pago genérico
    // sin identificador en descripción.
    if (saldoContableDec.lte(0.005)) {
      if (saldoContableDec.lte(0)) continue;
      // saldo entre 0 y 0.005: tratar como cero
      continue;
    }

    // Pendientes brutos por factura (después de Layer 1 + Layer 2)
    type Pendiente = { f: FacturaInterna; pendiente: ReturnType<typeof toDecimal> };
    const pendientes: Pendiente[] = facturasInternas
      .map((f) => ({
        f,
        pendiente: f.totalArs.minus(f.pagadoNumero).minus(f.pagadoEmbarque),
      }))
      .filter((x) => x.pendiente.gt(0.005));

    // ============================================================
    // Layer 3 — Fallback FIFO contra saldoContable:
    // Si la suma de pendientes excede el saldo contable de la cuenta del
    // proveedor (verdad última del ledger), hubo pagos sin identificador
    // (descripción genérica como "PAGO ARS NNN.NN"). Descontamos del más
    // antiguo al más nuevo hasta que el residual coincida con saldoContable.
    // ============================================================
    const sumaPendientes = pendientes.reduce((acc, x) => acc.plus(x.pendiente), toDecimal(0));
    if (sumaPendientes.gt(saldoContableDec.plus(0.005))) {
      let exceso = sumaPendientes.minus(saldoContableDec);
      pendientes.sort((a, b) => a.f.fecha.localeCompare(b.f.fecha));
      for (const x of pendientes) {
        if (exceso.lte(0.005)) break;
        const tomar = x.pendiente.gt(exceso) ? exceso : x.pendiente;
        x.f.pagadoFifo = x.f.pagadoFifo.plus(tomar);
        x.pendiente = x.pendiente.minus(tomar);
        exceso = exceso.minus(tomar);
      }
    }

    // Facturas finales — umbral 0.50 ARS para descartar residuos de centavo
    // que vienen del cruce FIFO entre Layer 2 y Layer 3 (drift entre cifras
    // brutas en haber con dos decimales y pagos efectivos en netos).
    const facturas: FacturaPendiente[] = pendientes
      .filter((x) => x.pendiente.gt(0.5))
      .map(({ f, pendiente }) => ({
        origen: f.origen,
        id: f.id,
        numero: f.numero,
        referencia: f.referencia,
        fecha: f.fecha,
        fechaVencimiento: f.fechaVencimiento,
        diasParaVencer: f.diasParaVencer,
        bucket: f.bucket,
        monto: pendiente.toFixed(2),
        moneda: f.moneda,
      }));

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

export async function getCuentasAPagarPorEmbarque(): Promise<CuentaAPagarPorEmbarque[]> {
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

  // Calcular total + filtrar grupos donde ya se aplicaron pagos por
  // ese embarque puntual a la cuenta del proveedor.
  const result: CuentaAPagarPorEmbarque[] = [];

  // Saldo vivo global del proveedor (haber - debe) — informativo.
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

  // Pagos aplicados por (cuentaProveedorId + embarqueCodigo): suma del
  // NETO (DEBE − HABER) de cada asiento que menciona el código del
  // embarque en la cuenta del proveedor. Usar NETO en vez de DEBE bruto
  // descuenta correctamente flows tipo "Pago múltiple intermediário"
  // donde el asiento debita el total bruto y luego acredita la mayor
  // parte como "Saldo pendiente con intermediário" en la misma cuenta —
  // el pago real es lo que sale del banco (neto), no el bruto.
  const pagosPorClave = new Map<string, string>();
  await Promise.all(
    Array.from(groups.values()).map(async (g) => {
      if (!g.proveedorCuentaContableId) return;
      // Asientos que tienen al menos una línea DEBE en la cuenta del
      // proveedor con el código del embarque en la descripción
      const lineasConCodigo = await db.lineaAsiento.findMany({
        where: {
          cuentaId: g.proveedorCuentaContableId,
          debe: { gt: 0 },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          OR: [
            { descripcion: { contains: g.embarqueCodigo } },
            { asiento: { descripcion: { contains: g.embarqueCodigo } } },
          ],
        },
        select: { asientoId: true },
      });
      const asientoIds = Array.from(new Set(lineasConCodigo.map((l) => l.asientoId)));
      if (asientoIds.length === 0) {
        pagosPorClave.set(`${g.proveedorCuentaContableId}::${g.embarqueCodigo}`, "0");
        return;
      }
      // Para cada asiento, calcular NETO en la cuenta del proveedor
      const todasLineas = await db.lineaAsiento.findMany({
        where: {
          cuentaId: g.proveedorCuentaContableId,
          asientoId: { in: asientoIds },
        },
        select: { asientoId: true, debe: true, haber: true },
      });
      const netoPorAsiento = new Map<string, ReturnType<typeof toDecimal>>();
      for (const l of todasLineas) {
        const cur = netoPorAsiento.get(l.asientoId) ?? toDecimal(0);
        netoPorAsiento.set(l.asientoId, cur.plus(toDecimal(l.debe)).minus(toDecimal(l.haber)));
      }
      let netoTotal = toDecimal(0);
      for (const neto of netoPorAsiento.values()) {
        if (neto.gt(0)) netoTotal = netoTotal.plus(neto);
      }
      pagosPorClave.set(
        `${g.proveedorCuentaContableId}::${g.embarqueCodigo}`,
        netoTotal.toFixed(2),
      );
    }),
  );

  for (const g of groups.values()) {
    const totalGrupo = g.facturas.reduce((acc, f) => acc.plus(toDecimal(f.totalArs)), toDecimal(0));
    g.totalArs = totalGrupo.toFixed(2);

    const saldoVivo = g.proveedorCuentaContableId
      ? toDecimal(saldoVivoPorCuenta.get(g.proveedorCuentaContableId) ?? "0")
      : toDecimal(0);
    g.saldoVivoProveedorArs = saldoVivo.toFixed(2);

    // Pagos ya aplicados a este embarque (NETO por asiento — DEBE − HABER
    // de cada asiento de la cuenta del proveedor que mencione el código
    // del embarque). El neto descuenta correctamente los flows
    // "Pago múltiple intermediário" donde parte del DEBE se reclasifica
    // como "Saldo pendiente con intermediário" en la misma cuenta.
    const pagadoEmbarque = g.proveedorCuentaContableId
      ? toDecimal(pagosPorClave.get(`${g.proveedorCuentaContableId}::${g.embarqueCodigo}`) ?? "0")
      : toDecimal(0);

    // Threshold de cobertura: si el pago neto cubre ≥98% del total del
    // grupo, considerar pagado y omitir — consistente con el threshold de
    // Layer 2 en getSaldosPorProveedorConAging. Evita mostrar grupos con
    // residuo de saldo intermediário que el usuario considera ya pago.
    // (Subido de 80% a 98% en 2026-05-06 para que facturas con saldo
    // intermediário ~20% reaparezcan como pendientes.)
    if (totalGrupo.gt(0) && pagadoEmbarque.div(totalGrupo).toNumber() >= 0.98) continue;

    const pendienteEmbarque = totalGrupo.minus(pagadoEmbarque);
    if (pendienteEmbarque.lte(0.005)) continue;

    // También respetar el saldo vivo global: si <=0, todo está pagado.
    if (saldoVivo.lte(0)) continue;

    // pendienteArs = min(pendienteEmbarque, saldoVivo). Cubre el caso
    // edge donde el embarque tiene pagos sin código pero hubo
    // amortización al proveedor.
    const pendiente = pendienteEmbarque.gt(saldoVivo) ? saldoVivo : pendienteEmbarque;
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

/** Refuerzos / VEPs complementarios pendientes — saldo HABER de
 *  la cuenta 2.1.5.99 SALDO PENDIENTE ADUANA agrupado por embarque
 *  (extraído de la descripción de la línea o del asiento). */
export type RefuerzoVepPendiente = {
  embarqueCodigo: string;
  saldoPendiente: string;
  fechaOrigen: string; // ISO — fecha del primer asiento que generó el refuerzo
};

const RE_EMBARQUE_CODIGO = /AR-\d{6}-[A-Z0-9]+/;

export async function getRefuerzosVepPendientes(): Promise<RefuerzoVepPendiente[]> {
  const cuenta = await db.cuentaContable.findFirst({
    where: { codigo: "2.1.5.99" },
    select: { id: true },
  });
  if (!cuenta) return [];

  const lineas = await db.lineaAsiento.findMany({
    where: {
      cuentaId: cuenta.id,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    select: {
      debe: true,
      haber: true,
      descripcion: true,
      asiento: { select: { fecha: true, descripcion: true } },
    },
  });

  // Agrupar por código de embarque extraído de la descripción.
  // Sólo consideramos líneas cuyo texto contenga un código AR-… ; las
  // que no — caso atípico — quedan agrupadas como "_genérico" y no se
  // muestran (no podemos asociarlas a un embarque para pagarlas).
  type Bucket = { saldo: ReturnType<typeof toDecimal>; fecha: Date };
  const porEmbarque = new Map<string, Bucket>();

  for (const l of lineas) {
    const text = `${l.descripcion ?? ""} ${l.asiento.descripcion ?? ""}`;
    const m = text.match(RE_EMBARQUE_CODIGO);
    if (!m) continue;
    const codigo = m[0];
    const haber = toDecimal(l.haber);
    const debe = toDecimal(l.debe);
    const delta = haber.minus(debe); // pasivo: HABER suma saldo, DEBE lo cancela
    const existing = porEmbarque.get(codigo);
    if (existing) {
      existing.saldo = existing.saldo.plus(delta);
      if (l.asiento.fecha < existing.fecha) existing.fecha = l.asiento.fecha;
    } else {
      porEmbarque.set(codigo, { saldo: delta, fecha: l.asiento.fecha });
    }
  }

  return Array.from(porEmbarque.entries())
    .filter(([, v]) => v.saldo.gt(0.005))
    .map(([codigo, v]) => ({
      embarqueCodigo: codigo,
      saldoPendiente: v.saldo.toFixed(2),
      fechaOrigen: v.fecha.toISOString(),
    }))
    .sort((a, b) => a.embarqueCodigo.localeCompare(b.embarqueCodigo));
}

/** Saldo deudor de la cuenta CRÉDITO A FAVOR ADUANA (1.1.4.13).
 *  Retorna el monto disponible para aplicar contra próximos VEPs.
 *  Devuelve "0.00" si la cuenta no existe o el saldo es <= 0. */
export async function getSaldoCreditoAduana(): Promise<{
  cuentaId: number | null;
  cuentaCodigo: string;
  saldo: string;
}> {
  const cuenta = await db.cuentaContable.findFirst({
    where: { codigo: VEP_ADUANA_CODIGOS.CREDITO_ADUANA.codigo },
    select: { id: true, codigo: true },
  });
  if (!cuenta) {
    return {
      cuentaId: null,
      cuentaCodigo: VEP_ADUANA_CODIGOS.CREDITO_ADUANA.codigo,
      saldo: "0.00",
    };
  }
  const agg = await db.lineaAsiento.aggregate({
    where: {
      cuentaId: cuenta.id,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    _sum: { debe: true, haber: true },
  });
  const debe = toDecimal(agg._sum.debe ?? 0);
  const haber = toDecimal(agg._sum.haber ?? 0);
  const saldo = debe.minus(haber); // ACTIVO: deudor = debe - haber
  return {
    cuentaId: cuenta.id,
    cuentaCodigo: cuenta.codigo,
    saldo: saldo.lte(0) ? "0.00" : saldo.toFixed(2),
  };
}
