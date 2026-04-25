import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";

import { getFlujoCaja } from "@/lib/services/reportes";
import type { Moneda } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { FlujoFilters } from "./flujo-filters";
import {
  FlujoMatriz,
  type SerializedSeccion,
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
  return value === "USD" ? "USD" : "ARS";
}

function mesKeyOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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
  // Default hasta = current + 5 months
  const defaultHasta = new Date(Date.UTC(curY, curM - 1 + 5, 1));
  const hastaParsed =
    parseMesKey(params.hasta) ?? {
      y: defaultHasta.getUTCFullYear(),
      m: defaultHasta.getUTCMonth() + 1,
    };
  const moneda = parseMoneda(params.moneda);

  const desde = firstDayUtc(desdeParsed.y, desdeParsed.m);
  const hasta = lastDayUtc(hastaParsed.y, hastaParsed.m);

  // Guard: if desde > hasta, swap
  const [desdeFinal, hastaFinal] =
    desde.getTime() <= hasta.getTime() ? [desde, hasta] : [hasta, desde];

  const flujo = await getFlujoCaja(desdeFinal, hastaFinal, moneda);

  const serializedSecciones: SerializedSeccion[] = flujo.secciones.map(
    (sec) => ({
      id: sec.id,
      label: sec.label,
      direccion: sec.direccion,
      subsecciones: sec.subsecciones.map((sub) => ({
        label: sub.label,
        items: sub.items.map((item) => ({
          label: item.label,
          cuentaCodigos: item.cuentaCodigos,
          valores: Object.fromEntries(
            Object.entries(item.valores).map(([k, v]) => [
              k,
              { monto: v.monto.toFixed(2), origen: v.origen },
            ]),
          ),
        })),
      })),
    }),
  );

  const serializedTotales: SerializedTotales = {
    totalSalidasPorMes: mapValues(flujo.totales.totalSalidasPorMes),
    totalIngresosPorMes: mapValues(flujo.totales.totalIngresosPorMes),
    saldoMensalPorMes: mapValues(flujo.totales.saldoMensalPorMes),
    saldoInicial: flujo.totales.saldoInicial.toFixed(2),
    saldoAcumuladoPorMes: mapValues(flujo.totales.saldoAcumuladoPorMes),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Flujo de Caja Proyectado
        </h1>
        <p className="text-sm text-muted-foreground">
          Matriz mensual · Realizado (contabilizado) + Proyectado (embarques en
          tránsito).
        </p>
      </div>

      <FlujoFilters
        desde={mesKeyOf(desdeFinal)}
        hasta={mesKeyOf(hastaFinal)}
        moneda={moneda}
      />

      {flujo.advertencias.length > 0 ? (
        <Card
          size="sm"
          className="border-amber-400/40 bg-amber-50 px-4 py-3 ring-amber-400/40 dark:bg-amber-950/40"
        >
          <div className="flex items-start gap-3">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
            />
            <ul className="flex flex-col gap-1 text-xs text-amber-900 dark:text-amber-200">
              {flujo.advertencias.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      <Card className="py-0">
        <FlujoMatriz
          meses={flujo.meses}
          secciones={serializedSecciones}
          totales={serializedTotales}
        />
      </Card>
    </div>
  );
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
