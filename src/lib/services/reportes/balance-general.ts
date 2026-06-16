import "server-only";

import { db } from "@/lib/db";
import { Decimal, eqMoney, sumMoney } from "@/lib/decimal";

import { PREFIJO_CLIENTES, PREFIJOS_PROVEEDORES } from "@/lib/services/prefijos-plan";
import { getEstadoResultados, getEstadoResultadosByFecha } from "./estado-resultados";
import { buildCuentaTree, type CuentaTreeNode } from "./shared";

export type BalanceGeneralContexto =
  | {
      tipo: "periodo";
      periodoId: number;
      codigo: string;
      nombre: string;
      fechaInicio: Date;
      fechaFin: Date;
    }
  | {
      tipo: "fecha";
      fechaDesde: Date | null;
      fechaHasta: Date | null;
    };

export type BalanceGeneralResult = {
  // periodo se mantiene para compat con páginas existentes; cuando el
  // filtro es por fecha, se llena con valores sintéticos.
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  contexto: BalanceGeneralContexto;
  activo: CuentaTreeNode[];
  pasivo: CuentaTreeNode[];
  patrimonio: CuentaTreeNode[];
  totalActivo: Decimal;
  totalPasivo: Decimal;
  totalPatrimonio: Decimal;
  totalSaldoInicialActivo: Decimal;
  totalSaldoInicialPasivo: Decimal;
  totalSaldoInicialPatrimonio: Decimal;
  resultadoEjercicio: Decimal;
  totalPatrimonioAjustado: Decimal;
  cuadra: boolean;
  diferencia: Decimal;
};

// Código da conta analítica "RESULTADO DEL EJERCICIO" no plano oficial.
const CODIGO_RESULTADO_EJERCICIO = "3.2.1.02";

// Rubros del subledger comercial cuyos saldos de signo invertido SÍ son
// saldos a favor / anticipos y se reclasifican al lado opuesto del Balance.
// Se limita a estos prefijos a propósito: NO se reclasifican por signo
// cuentas de inventario/banco/impuestos con saldo invertido (otra naturaleza).
const RUBRO_PROVEEDORES = [...PREFIJOS_PROVEEDORES]; // deudas comerciales locales + exterior
const RUBRO_CLIENTES = [PREFIJO_CLIENTES]; // deudores por ventas

// Ids sintéticos (negativos para no colisionar con cuentas reales) de los
// grupos de reclasificación que se insertan en el lado opuesto.
const GRUPO_PROV_A_FAVOR_ID = -901;
const GRUPO_CLI_A_FAVOR_ID = -902;

/**
 * Reclasificación por signo (sólo presentación) del subledger comercial:
 *  - Proveedores (2.1.1.x / 2.1.8.x) con saldo DEUDOR → se exponen en el Activo
 *    (anticipos / saldos a favor a proveedores).
 *  - Clientes (1.1.3.x) con saldo ACREEDOR → se exponen en el Pasivo
 *    (anticipos de clientes).
 * El subledger sigue intacto (las cuentas no se mueven en el plan; el saldo a
 * favor sigue netando contra la próxima factura). Sólo cambia la EXHIBICIÓN del
 * Balance. La igualdad Activo = Pasivo + PN se preserva: ambos lados se
 * "agruban" (gross-up) por el mismo importe reclasificado.
 * Pura y exportada para tests.
 */
export function reclasificarSaldosAFavor(
  activo: CuentaTreeNode[],
  pasivo: CuentaTreeNode[],
): { activo: CuentaTreeNode[]; pasivo: CuentaTreeNode[] } {
  const provAFavor: CuentaTreeNode[] = [];
  const pasivoLimpio = extraerHojasInvertidas(pasivo, RUBRO_PROVEEDORES, provAFavor);

  const cliAFavor: CuentaTreeNode[] = [];
  const activoLimpio = extraerHojasInvertidas(activo, RUBRO_CLIENTES, cliAFavor);

  const activoFinal = [...activoLimpio];
  if (provAFavor.length > 0) {
    activoFinal.push(
      grupoReclasificacion(
        GRUPO_PROV_A_FAVOR_ID,
        "1.1.·",
        "ANTICIPOS Y SALDOS A FAVOR A PROVEEDORES",
        "ACTIVO",
        provAFavor,
      ),
    );
  }

  const pasivoFinal = [...pasivoLimpio];
  if (cliAFavor.length > 0) {
    pasivoFinal.push(
      grupoReclasificacion(
        GRUPO_CLI_A_FAVOR_ID,
        "2.1.·",
        "ANTICIPOS DE CLIENTES (SALDOS A FAVOR)",
        "PASIVO",
        cliAFavor,
      ),
    );
  }

  return { activo: activoFinal, pasivo: pasivoFinal };
}

// Recorre el árbol y EXTRAE las hojas ANALITICAS cuyo código matchea alguno de
// `prefijos` y cuyo saldo es de signo invertido (< 0 en su naturaleza). Las
// extraídas se empujan a `sink` con el saldo ya invertido a positivo (para
// exhibirse en el lado opuesto). Devuelve el árbol sin esas hojas, recomputando
// el roll-up de los sintéticos y descartando los que quedan vacíos. No muta los
// nodos originales (crea copias de los sintéticos tocados).
function extraerHojasInvertidas(
  nodes: CuentaTreeNode[],
  prefijos: string[],
  sink: CuentaTreeNode[],
): CuentaTreeNode[] {
  const out: CuentaTreeNode[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) {
      const matchRubro = prefijos.some((p) => node.codigo.startsWith(p));
      if (matchRubro && node.saldo.lt(0)) {
        // Presentado en el lado opuesto: signo invertido a positivo.
        sink.push({
          ...node,
          saldo: node.saldo.negated(),
          saldoInicial: node.saldoInicial.negated(),
        });
        continue;
      }
      out.push(node);
    } else {
      const children = extraerHojasInvertidas(node.children, prefijos, sink);
      if (children.length === 0) continue; // sintético vacío → drop
      out.push({
        ...node,
        children,
        saldoInicial: sumMoney(children.map((c) => c.saldoInicial)),
        debe: sumMoney(children.map((c) => c.debe)),
        haber: sumMoney(children.map((c) => c.haber)),
        saldo: sumMoney(children.map((c) => c.saldo)),
      });
    }
  }
  return out;
}

function grupoReclasificacion(
  id: number,
  codigo: string,
  nombre: string,
  categoria: CuentaTreeNode["categoria"],
  hojas: CuentaTreeNode[],
): CuentaTreeNode {
  return {
    id,
    codigo,
    nombre,
    tipo: "SINTETICA",
    categoria,
    nivel: 2,
    saldoInicial: sumMoney(hojas.map((h) => h.saldoInicial)),
    debe: sumMoney(hojas.map((h) => h.debe)),
    haber: sumMoney(hojas.map((h) => h.haber)),
    saldo: sumMoney(hojas.map((h) => h.saldo)),
    children: hojas.map((h) => ({ ...h, categoria })),
  };
}

export async function getBalanceGeneral(periodoId: number): Promise<BalanceGeneralResult | null> {
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

  const [tree, estado] = await Promise.all([
    buildCuentaTree(["ACTIVO", "PASIVO", "PATRIMONIO"], { periodoId }),
    getEstadoResultados(periodoId),
  ]);

  return ensamblar({
    periodo,
    contexto: {
      tipo: "periodo",
      periodoId: periodo.id,
      codigo: periodo.codigo,
      nombre: periodo.nombre,
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
    },
    tree,
    resultadoEjercicio: estado?.resultado ?? new Decimal(0),
  });
}

export async function getBalanceGeneralByFecha(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
}): Promise<BalanceGeneralResult> {
  const [tree, estado] = await Promise.all([
    buildCuentaTree(["ACTIVO", "PASIVO", "PATRIMONIO"], filter),
    getEstadoResultadosByFecha(filter),
  ]);

  return ensamblar({
    periodo: {
      id: 0,
      codigo: "—",
      nombre: rangoLabel(filter.fechaDesde, filter.fechaHasta),
      fechaInicio: filter.fechaDesde ?? new Date(0),
      fechaFin: filter.fechaHasta ?? new Date(),
    },
    contexto: {
      tipo: "fecha",
      fechaDesde: filter.fechaDesde ?? null,
      fechaHasta: filter.fechaHasta ?? null,
    },
    tree,
    resultadoEjercicio: estado.resultado,
  });
}

function ensamblar({
  periodo,
  contexto,
  tree,
  resultadoEjercicio,
}: {
  periodo: BalanceGeneralResult["periodo"];
  contexto: BalanceGeneralContexto;
  tree: Awaited<ReturnType<typeof buildCuentaTree>>;
  resultadoEjercicio: Decimal;
}): BalanceGeneralResult {
  // Reclasificación por signo del subledger comercial (sólo presentación):
  // saldos a favor de proveedores → Activo; anticipos de clientes → Pasivo.
  const { activo, pasivo } = reclasificarSaldosAFavor(
    tree.porCategoria.get("ACTIVO") ?? [],
    tree.porCategoria.get("PASIVO") ?? [],
  );
  const patrimonio = tree.porCategoria.get("PATRIMONIO") ?? [];

  // Totales recomputados desde las listas ya reclasificadas (ambos lados se
  // agrupan por igual, así que la igualdad A = P + PN se preserva).
  const totalActivo = sumMoney(activo.map((n) => n.saldo));
  const totalPasivo = sumMoney(pasivo.map((n) => n.saldo));
  const totalPatrimonio = tree.totalPorCategoria.get("PATRIMONIO") ?? new Decimal(0);

  const totalSaldoInicialActivo = sumMoney(activo.map((n) => n.saldoInicial));
  const totalSaldoInicialPasivo = sumMoney(pasivo.map((n) => n.saldoInicial));
  const totalSaldoInicialPatrimonio = sumMoney(patrimonio.map((n) => n.saldoInicial));

  const cuentaResultadoYaMovida = patrimonio.some((root) =>
    containsCuentaComSaldo(root, CODIGO_RESULTADO_EJERCICIO),
  );
  const totalPatrimonioAjustado = cuentaResultadoYaMovida
    ? totalPatrimonio
    : totalPatrimonio.plus(resultadoEjercicio);

  const somaPasivoPatrimonio = totalPasivo.plus(totalPatrimonioAjustado);
  const diferencia = totalActivo.minus(somaPasivoPatrimonio).toDecimalPlaces(2);

  return {
    periodo,
    contexto,
    activo,
    pasivo,
    patrimonio,
    totalActivo: totalActivo.toDecimalPlaces(2),
    totalPasivo: totalPasivo.toDecimalPlaces(2),
    totalPatrimonio: totalPatrimonio.toDecimalPlaces(2),
    totalSaldoInicialActivo: totalSaldoInicialActivo.toDecimalPlaces(2),
    totalSaldoInicialPasivo: totalSaldoInicialPasivo.toDecimalPlaces(2),
    totalSaldoInicialPatrimonio: totalSaldoInicialPatrimonio.toDecimalPlaces(2),
    resultadoEjercicio,
    totalPatrimonioAjustado: totalPatrimonioAjustado.toDecimalPlaces(2),
    cuadra: eqMoney(totalActivo, somaPasivoPatrimonio),
    diferencia,
  };
}

function rangoLabel(desde: Date | undefined, hasta: Date | undefined): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (desde && hasta) return `Del ${fmt(desde)} al ${fmt(hasta)}`;
  if (hasta) return `Saldo al ${fmt(hasta)}`;
  if (desde) return `Desde ${fmt(desde)}`;
  return "Histórico completo";
}

function containsCuentaComSaldo(node: CuentaTreeNode, codigo: string): boolean {
  if (node.codigo === codigo && !node.saldo.isZero()) return true;
  for (const ch of node.children) {
    if (containsCuentaComSaldo(ch, codigo)) return true;
  }
  return false;
}
