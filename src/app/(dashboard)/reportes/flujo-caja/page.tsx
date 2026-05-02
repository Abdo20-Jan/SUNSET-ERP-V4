import { getFlujoCaja, type FlujoNode } from "@/lib/services/reportes";
import type { Moneda } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { FlujoFilters } from "./flujo-filters";
import {
  FlujoMatriz,
  type SerializedNode,
  type SerializedTotales,
} from "./flujo-matriz";

type SearchParams = Promise<{
  desde?: string;
  hasta?: string;
  moneda?: string;
}>;

function parseMesKey(value: string | undefined): { y: number; m: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number.parseInt(match[1]!, 10);
  const m = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { y, m };
}

function firstDayUtc(y: number, m: number): Date {
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
}

function lastDayUtc(y: number, m: number): Date {
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

function parseMoneda(value: string | undefined): Moneda {
  return value === "ARS" ? "ARS" : "USD";
}

function mesKeyOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Serializa Decimal → string para o cliente (preserva precisão).
function serializeNode(node: FlujoNode): SerializedNode {
  return {
    cuentaId: node.cuentaId,
    codigo: node.codigo,
    nombre: node.nombre,
    tipo: node.tipo,
    categoria: node.categoria,
    nivel: node.nivel,
    valoresPorMes: Object.fromEntries(
      Object.entries(node.valoresPorMes).map(([k, v]) => [
        k,
        { monto: v.monto.toFixed(2), origen: v.origen },
      ]),
    ),
    totalPeriodo: node.totalPeriodo.toFixed(2),
    children: node.children.map(serializeNode),
  };
}

function mapValues(
  rec: Record<string, { toFixed: (n: number) => string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v.toFixed(2);
  }
  return out;
}

export default async function FlujoCajaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;

  const desdeParsed = parseMesKey(params.desde) ?? { y: curY, m: curM };
  const defaultHasta = new Date(Date.UTC(curY, curM - 1 + 5, 1));
  const hastaParsed =
    parseMesKey(params.hasta) ?? {
      y: defaultHasta.getUTCFullYear(),
      m: defaultHasta.getUTCMonth() + 1,
    };
  const moneda = parseMoneda(params.moneda);

  const desde = firstDayUtc(desdeParsed.y, desdeParsed.m);
  const hasta = lastDayUtc(hastaParsed.y, hastaParsed.m);
  const [desdeFinal, hastaFinal] =
    desde.getTime() <= hasta.getTime() ? [desde, hasta] : [hasta, desde];

  const flujo = await getFlujoCaja(desdeFinal, hastaFinal, moneda);

  const contrapartidasSer = flujo.contrapartidas.map(serializeNode);
  const transferenciasSer = flujo.transferencias.map(serializeNode);

  const totales: SerializedTotales = {
    totalIngresosPorMes: mapValues(flujo.totales.totalIngresosPorMes),
    totalEgresosPorMes: mapValues(flujo.totales.totalEgresosPorMes),
    saldoMensalPorMes: mapValues(flujo.totales.saldoMensalPorMes),
    saldoInicial: flujo.totales.saldoInicial.toFixed(2),
    saldoAcumuladoPorMes: mapValues(flujo.totales.saldoAcumuladoPorMes),
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Flujo de Caja
        </h1>
        <p className="text-sm text-muted-foreground">
          Movimientos reales de bancos y cajas, agrupados por la cuenta
          contrapartida (proveedores, clientes, préstamos, impuestos, gastos,
          créditos fiscales, etc). El saldo acumulado iguala al saldo
          contable de bancos.
        </p>
      </div>

      <FlujoFilters
        desde={mesKeyOf(desdeFinal)}
        hasta={mesKeyOf(hastaFinal)}
        moneda={moneda}
      />

      <Card className="py-0">
        <FlujoMatriz
          meses={flujo.meses}
          contrapartidas={contrapartidasSer}
          transferencias={transferenciasSer}
          totales={totales}
        />
      </Card>
    </div>
  );
}
