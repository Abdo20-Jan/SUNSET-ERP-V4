import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import { AsientoEstado, type CuentaCategoria, type CuentaTipo } from "@/generated/prisma/client";

export type BalanceLinea = {
  kind: "linea";
  lineaId: number;
  asientoId: string;
  asientoNumero: number;
  fecha: Date;
  descripcion: string;
  debe: string;
  haber: string;
  saldoAcumulado: string;
  // Valores en USD calculados por línea. Si la línea es USD-nata
  // (monedaOrigen=USD con montoOrigen), usa el montoOrigen como fact
  // invariante. Si la línea es ARS-nata y tcParaUsd está presente, usa
  // ARS÷TC como display. Si tcParaUsd es null, todos los campos USD son null.
  debeUsd: string | null;
  haberUsd: string | null;
  saldoAcumuladoUsd: string | null;
};

export type BalanceNode = {
  kind: "cuenta";
  id: number;
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  categoria: CuentaCategoria;
  nivel: number;
  saldoInicial: string;
  debe: string;
  haber: string;
  saldoFinal: string;
  // Valores en USD: para cada cuenta, los componentes USD-natos vienen de
  // montoOrigen (invariantes a TC); el resto (líneas ARS-natas) se convierte
  // por TC del día. Roll-up en SINTÉTICAS suma de los hijos. Si tcParaUsd es
  // null, todos los campos USD son null. Préstamos en USD y proveedores del
  // exterior aparecen así con su saldo USD verdadero, no dependiente del TC.
  saldoInicialUsd: string | null;
  debeUsd: string | null;
  haberUsd: string | null;
  saldoFinalUsd: string | null;
  children?: BalanceNode[];
  lineas?: BalanceLinea[];
};

export type BalanceResult = {
  rango: {
    fechaDesde: Date | null;
    fechaHasta: Date | null;
  };
  root: BalanceNode[];
};

/**
 * Remove contas totalmente zeradas (saldoInicial, debe, haber e saldoFinal
 * todos 0), preservando os pais que tenham descendentes movimentados. Uma
 * conta que movimentou no período mas fecha em 0 (debe=haber) permanece.
 * Puramente de exibição: não afeta a verificação Debe = Haber.
 */
export function pruneBalanceSinSaldo(nodes: BalanceNode[]): BalanceNode[] {
  const isZero = (n: BalanceNode): boolean =>
    Number.parseFloat(n.saldoInicial) === 0 &&
    Number.parseFloat(n.debe) === 0 &&
    Number.parseFloat(n.haber) === 0 &&
    Number.parseFloat(n.saldoFinal) === 0;

  const prune = (node: BalanceNode): BalanceNode | null => {
    if (node.children) {
      const children = node.children.map(prune).filter((n): n is BalanceNode => n !== null);
      if (children.length === 0 && isZero(node)) return null;
      return { ...node, children };
    }
    return isZero(node) ? null : node;
  };
  return nodes.map(prune).filter((n): n is BalanceNode => n !== null);
}

// Sinal natural: valor positivo representa o saldo na natureza da conta.
function naturalSaldo(categoria: CuentaCategoria, debe: Decimal, haber: Decimal): Decimal {
  if (categoria === "ACTIVO" || categoria === "EGRESO") {
    return debe.minus(haber);
  }
  return haber.minus(debe);
}

export async function getBalanceSumasYSaldos(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
  /**
   * TC del día para convertir las líneas ARS-natas a USD como display.
   * Si está presente, los campos *Usd se calculan. Las líneas USD-natas
   * (monedaOrigen=USD con montoOrigen) usan su montoOrigen como fact
   * invariante; el resto usa ARS÷tcParaUsd.
   */
  tcParaUsd?: string | null;
}): Promise<BalanceResult> {
  const fechaWhere =
    filter.fechaDesde || filter.fechaHasta
      ? {
          ...(filter.fechaDesde && { gte: filter.fechaDesde }),
          ...(filter.fechaHasta && { lte: filter.fechaHasta }),
        }
      : undefined;

  const tc = (() => {
    if (!filter.tcParaUsd) return null;
    const n = new Decimal(filter.tcParaUsd);
    return n.isFinite() && n.gt(0) ? n : null;
  })();

  const [cuentas, lineasPrev, lineasPeriodo] = await Promise.all([
    db.cuentaContable.findMany({ orderBy: { codigo: "asc" } }),
    filter.fechaDesde
      ? db.lineaAsiento.findMany({
          where: {
            asiento: {
              estado: AsientoEstado.CONTABILIZADO,
              fecha: { lt: filter.fechaDesde },
            },
          },
          select: {
            cuentaId: true,
            debe: true,
            haber: true,
            monedaOrigen: true,
            montoOrigen: true,
          },
        })
      : Promise.resolve(
          [] as Array<{
            cuentaId: number;
            debe: import("@/generated/prisma/client").Prisma.Decimal;
            haber: import("@/generated/prisma/client").Prisma.Decimal;
            monedaOrigen: "ARS" | "USD" | null;
            montoOrigen: import("@/generated/prisma/client").Prisma.Decimal | null;
          }>,
        ),
    db.lineaAsiento.findMany({
      where: {
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          ...(fechaWhere ? { fecha: fechaWhere } : {}),
        },
      },
      orderBy: [{ asiento: { fecha: "asc" } }, { asiento: { numero: "asc" } }, { id: "asc" }],
      select: {
        id: true,
        cuentaId: true,
        debe: true,
        haber: true,
        descripcion: true,
        monedaOrigen: true,
        montoOrigen: true,
        asiento: {
          select: {
            id: true,
            numero: true,
            fecha: true,
            descripcion: true,
          },
        },
      },
    }),
  ]);

  // Calcula el "componente USD" de una línea: si es USD-nata usa montoOrigen;
  // si no, y hay TC, divide ARS÷TC. Si no hay TC y la línea no es USD-nata,
  // devuelve null (la cuenta no podrá emitir USD para esa línea).
  const usdPart = (
    ars: Decimal,
    monedaOrigen: "ARS" | "USD" | null,
    montoOrigen: import("@/generated/prisma/client").Prisma.Decimal | null,
  ): Decimal | null => {
    if (monedaOrigen === "USD" && montoOrigen) return toDecimal(montoOrigen);
    if (tc) return ars.div(tc);
    return null;
  };

  // Agregados previos por cuenta (saldo inicial).
  type PrevAgg = {
    debe: Decimal;
    haber: Decimal;
    debeUsd: Decimal;
    haberUsd: Decimal;
    usdConocido: boolean;
  };
  const prevByCuenta = new Map<number, PrevAgg>();
  for (const l of lineasPrev) {
    const agg = prevByCuenta.get(l.cuentaId) ?? {
      debe: new Decimal(0),
      haber: new Decimal(0),
      debeUsd: new Decimal(0),
      haberUsd: new Decimal(0),
      usdConocido: tc !== null, // con TC, todas las líneas se pueden expresar en USD
    };
    const dec = toDecimal(l.debe);
    const hec = toDecimal(l.haber);
    agg.debe = agg.debe.plus(dec);
    agg.haber = agg.haber.plus(hec);
    const dUsd = usdPart(dec, l.monedaOrigen, l.montoOrigen);
    const hUsd = usdPart(hec, l.monedaOrigen, l.montoOrigen);
    if (dUsd === null || hUsd === null) {
      // Sin TC, alguna línea ARS-nata no puede expresarse en USD → cuenta sin USD.
      agg.usdConocido = false;
    } else {
      agg.debeUsd = agg.debeUsd.plus(dUsd);
      agg.haberUsd = agg.haberUsd.plus(hUsd);
    }
    prevByCuenta.set(l.cuentaId, agg);
  }

  const lineasByCuenta = new Map<number, typeof lineasPeriodo>();
  for (const l of lineasPeriodo) {
    const arr = lineasByCuenta.get(l.cuentaId);
    if (arr) arr.push(l);
    else lineasByCuenta.set(l.cuentaId, [l]);
  }

  const nodeByCodigo = new Map<string, BalanceNode>();
  for (const c of cuentas) {
    const prev = prevByCuenta.get(c.id);
    const prevDebe = prev?.debe ?? new Decimal(0);
    const prevHaber = prev?.haber ?? new Decimal(0);
    const saldoInicial = naturalSaldo(c.categoria, prevDebe, prevHaber);

    // Si no hay líneas previas para esta cuenta, el saldo inicial USD es 0
    // (sólo conocido si la convención USD aplica — con TC, sí).
    const prevUsdKnown = prev ? prev.usdConocido : tc !== null;
    const prevDebeUsd = prev?.debeUsd ?? new Decimal(0);
    const prevHaberUsd = prev?.haberUsd ?? new Decimal(0);
    const saldoInicialUsd = prevUsdKnown
      ? naturalSaldo(c.categoria, prevDebeUsd, prevHaberUsd)
      : null;

    let debePeriodo = new Decimal(0);
    let haberPeriodo = new Decimal(0);
    let debeUsdPeriodo = new Decimal(0);
    let haberUsdPeriodo = new Decimal(0);
    // En analíticas, si alguna línea ARS-nata aparece sin TC, marcamos como
    // "USD desconocido" para esta cuenta (no podemos sumar USD honesto).
    let usdConocidoEstaCuenta = tc !== null;
    let lineasOut: BalanceLinea[] | undefined;

    if (c.tipo === "ANALITICA") {
      const lineas = lineasByCuenta.get(c.id) ?? [];
      if (lineas.length > 0) {
        let acumulado = saldoInicial;
        let acumuladoUsd = saldoInicialUsd ?? new Decimal(0);
        lineasOut = [];
        for (const l of lineas) {
          const dec = toDecimal(l.debe);
          const hec = toDecimal(l.haber);
          debePeriodo = debePeriodo.plus(dec);
          haberPeriodo = haberPeriodo.plus(hec);
          const signed =
            c.categoria === "ACTIVO" || c.categoria === "EGRESO" ? dec.minus(hec) : hec.minus(dec);
          acumulado = acumulado.plus(signed);

          const dUsd = usdPart(dec, l.monedaOrigen, l.montoOrigen);
          const hUsd = usdPart(hec, l.monedaOrigen, l.montoOrigen);
          let debeUsdStr: string | null = null;
          let haberUsdStr: string | null = null;
          let saldoAcumUsdStr: string | null = null;
          if (dUsd === null || hUsd === null) {
            usdConocidoEstaCuenta = false;
          } else {
            debeUsdPeriodo = debeUsdPeriodo.plus(dUsd);
            haberUsdPeriodo = haberUsdPeriodo.plus(hUsd);
            const signedUsd =
              c.categoria === "ACTIVO" || c.categoria === "EGRESO"
                ? dUsd.minus(hUsd)
                : hUsd.minus(dUsd);
            acumuladoUsd = acumuladoUsd.plus(signedUsd);
            debeUsdStr = dUsd.toFixed(2);
            haberUsdStr = hUsd.toFixed(2);
            saldoAcumUsdStr = usdConocidoEstaCuenta ? acumuladoUsd.toFixed(2) : null;
          }

          lineasOut.push({
            kind: "linea",
            lineaId: l.id,
            asientoId: l.asiento.id,
            asientoNumero: l.asiento.numero,
            fecha: l.asiento.fecha,
            descripcion: l.descripcion ?? l.asiento.descripcion,
            debe: dec.toFixed(2),
            haber: hec.toFixed(2),
            saldoAcumulado: acumulado.toFixed(2),
            debeUsd: debeUsdStr,
            haberUsd: haberUsdStr,
            saldoAcumuladoUsd: saldoAcumUsdStr,
          });
        }
      }
    }

    const saldoFinal = naturalSaldo(
      c.categoria,
      prevDebe.plus(debePeriodo),
      prevHaber.plus(haberPeriodo),
    );

    const usdFinalKnown = prevUsdKnown && usdConocidoEstaCuenta;
    const saldoFinalUsd = usdFinalKnown
      ? naturalSaldo(
          c.categoria,
          prevDebeUsd.plus(debeUsdPeriodo),
          prevHaberUsd.plus(haberUsdPeriodo),
        )
      : null;

    nodeByCodigo.set(c.codigo, {
      kind: "cuenta",
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      categoria: c.categoria,
      nivel: c.nivel,
      saldoInicial: saldoInicial.toFixed(2),
      debe: debePeriodo.toFixed(2),
      haber: haberPeriodo.toFixed(2),
      saldoFinal: saldoFinal.toFixed(2),
      saldoInicialUsd: saldoInicialUsd?.toFixed(2) ?? null,
      debeUsd: usdConocidoEstaCuenta ? debeUsdPeriodo.toFixed(2) : null,
      haberUsd: usdConocidoEstaCuenta ? haberUsdPeriodo.toFixed(2) : null,
      saldoFinalUsd: saldoFinalUsd?.toFixed(2) ?? null,
      children: c.tipo === "SINTETICA" ? [] : undefined,
      lineas: lineasOut,
    });
  }

  const roots: BalanceNode[] = [];
  for (const c of cuentas) {
    const node = nodeByCodigo.get(c.codigo)!;
    if (c.padreCodigo) {
      const parent = nodeByCodigo.get(c.padreCodigo);
      if (parent?.children) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  // Post-order: rola saldoInicial / debe / haber / saldoFinal das filhas nas
  // SINTÉTICAS, tanto en ARS como en USD. USD del padre es null si cualquier
  // hijo tiene USD null (no podemos honestamente sumar lo desconocido).
  const rollUp = (node: BalanceNode) => {
    if (node.tipo !== "SINTETICA" || !node.children || node.children.length === 0) {
      if (node.children && node.children.length === 0) node.children = undefined;
      return;
    }
    for (const child of node.children) rollUp(child);

    node.saldoInicial = sumMoney(node.children.map((ch) => ch.saldoInicial)).toFixed(2);
    node.debe = sumMoney(node.children.map((ch) => ch.debe)).toFixed(2);
    node.haber = sumMoney(node.children.map((ch) => ch.haber)).toFixed(2);
    node.saldoFinal = sumMoney(node.children.map((ch) => ch.saldoFinal)).toFixed(2);

    const allUsdKnown = (
      key: "saldoInicialUsd" | "debeUsd" | "haberUsd" | "saldoFinalUsd",
    ): string[] | null => {
      const vals: string[] = [];
      for (const ch of node.children ?? []) {
        const v = ch[key];
        if (v === null) return null;
        vals.push(v);
      }
      return vals;
    };
    const siVals = allUsdKnown("saldoInicialUsd");
    const dUVals = allUsdKnown("debeUsd");
    const hUVals = allUsdKnown("haberUsd");
    const sfVals = allUsdKnown("saldoFinalUsd");
    node.saldoInicialUsd = siVals ? sumMoney(siVals).toFixed(2) : null;
    node.debeUsd = dUVals ? sumMoney(dUVals).toFixed(2) : null;
    node.haberUsd = hUVals ? sumMoney(hUVals).toFixed(2) : null;
    node.saldoFinalUsd = sfVals ? sumMoney(sfVals).toFixed(2) : null;
  };
  for (const r of roots) rollUp(r);

  return {
    rango: {
      fechaDesde: filter.fechaDesde ?? null,
      fechaHasta: filter.fechaHasta ?? null,
    },
    root: roots,
  };
}
