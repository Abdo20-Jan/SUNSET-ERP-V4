import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
} from "@/generated/prisma/client";

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
  children?: BalanceNode[];
  lineas?: BalanceLinea[];
};

export type BalanceResult = {
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  root: BalanceNode[];
};

// Sinal natural: valor positivo representa o saldo na natureza da conta.
function naturalSaldo(
  categoria: CuentaCategoria,
  debe: Decimal,
  haber: Decimal,
): Decimal {
  if (categoria === "ACTIVO" || categoria === "EGRESO") {
    return debe.minus(haber);
  }
  return haber.minus(debe);
}

export async function getBalanceSumasYSaldos(
  periodoId: number,
): Promise<BalanceResult | null> {
  const periodo = await db.periodoContable.findUnique({
    where: { id: periodoId },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });
  if (!periodo) return null;

  const [cuentas, saldosPrev, lineasPeriodo] = await Promise.all([
    db.cuentaContable.findMany({ orderBy: { codigo: "asc" } }),
    db.lineaAsiento.groupBy({
      by: ["cuentaId"],
      _sum: { debe: true, haber: true },
      where: {
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          fecha: { lt: periodo.fechaInicio },
        },
      },
    }),
    db.lineaAsiento.findMany({
      where: {
        asiento: {
          periodoId: periodo.id,
          estado: AsientoEstado.CONTABILIZADO,
        },
      },
      orderBy: [
        { asiento: { fecha: "asc" } },
        { asiento: { numero: "asc" } },
        { id: "asc" },
      ],
      select: {
        id: true,
        cuentaId: true,
        debe: true,
        haber: true,
        descripcion: true,
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

  const prevByCuenta = new Map<number, { debe: Decimal; haber: Decimal }>();
  for (const s of saldosPrev) {
    prevByCuenta.set(s.cuentaId, {
      debe: toDecimal(s._sum.debe ?? 0),
      haber: toDecimal(s._sum.haber ?? 0),
    });
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

    const debeP = new Decimal(0);
    const haberP = new Decimal(0);
    let debePeriodo = debeP;
    let haberPeriodo = haberP;
    let lineasOut: BalanceLinea[] | undefined;

    if (c.tipo === "ANALITICA") {
      const lineas = lineasByCuenta.get(c.id) ?? [];
      if (lineas.length > 0) {
        let acumulado = saldoInicial;
        lineasOut = [];
        for (const l of lineas) {
          const dec = toDecimal(l.debe);
          const hec = toDecimal(l.haber);
          debePeriodo = debePeriodo.plus(dec);
          haberPeriodo = haberPeriodo.plus(hec);
          const signed =
            c.categoria === "ACTIVO" || c.categoria === "EGRESO"
              ? dec.minus(hec)
              : hec.minus(dec);
          acumulado = acumulado.plus(signed);
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
          });
        }
      }
    }

    const saldoFinal = naturalSaldo(
      c.categoria,
      prevDebe.plus(debePeriodo),
      prevHaber.plus(haberPeriodo),
    );

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

  // Post-order: rola saldoInicial / debe / haber / saldoFinal das filhas nas SINTÉTICAS.
  const rollUp = (node: BalanceNode) => {
    if (node.tipo !== "SINTETICA" || !node.children || node.children.length === 0) {
      if (node.children && node.children.length === 0) delete node.children;
      return;
    }
    for (const child of node.children) rollUp(child);

    node.saldoInicial = sumMoney(
      node.children.map((ch) => ch.saldoInicial),
    ).toFixed(2);
    node.debe = sumMoney(node.children.map((ch) => ch.debe)).toFixed(2);
    node.haber = sumMoney(node.children.map((ch) => ch.haber)).toFixed(2);
    node.saldoFinal = sumMoney(
      node.children.map((ch) => ch.saldoFinal),
    ).toFixed(2);
  };
  for (const r of roots) rollUp(r);

  return { periodo, root: roots };
}
