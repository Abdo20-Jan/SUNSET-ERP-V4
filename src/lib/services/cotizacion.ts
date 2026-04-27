import { Decimal } from "decimal.js";

import { db } from "@/lib/db";

export type CotizacionRow = {
  id: number;
  fecha: Date;
  valor: Decimal;
  fuente: string | null;
};

function toDateOnly(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export async function listarCotizaciones(limit = 60): Promise<CotizacionRow[]> {
  const rows = await db.cotizacion.findMany({
    orderBy: { fecha: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    fecha: r.fecha,
    valor: new Decimal(r.valor.toString()),
    fuente: r.fuente,
  }));
}

/**
 * TC vigente para una fecha dada: la cotización más reciente con `fecha <= fecha`.
 * Si no hay ninguna anterior, devuelve la más antigua disponible.
 * Si no hay cotizaciones, devuelve null.
 */
export async function getCotizacionParaFecha(
  fecha: Date,
): Promise<CotizacionRow | null> {
  const target = toDateOnly(fecha);

  const previa = await db.cotizacion.findFirst({
    where: { fecha: { lte: target } },
    orderBy: { fecha: "desc" },
  });
  if (previa) {
    return {
      id: previa.id,
      fecha: previa.fecha,
      valor: new Decimal(previa.valor.toString()),
      fuente: previa.fuente,
    };
  }

  const fallback = await db.cotizacion.findFirst({
    orderBy: { fecha: "asc" },
  });
  if (!fallback) return null;
  return {
    id: fallback.id,
    fecha: fallback.fecha,
    valor: new Decimal(fallback.valor.toString()),
    fuente: fallback.fuente,
  };
}

export async function getUltimaCotizacion(): Promise<CotizacionRow | null> {
  const r = await db.cotizacion.findFirst({ orderBy: { fecha: "desc" } });
  if (!r) return null;
  return {
    id: r.id,
    fecha: r.fecha,
    valor: new Decimal(r.valor.toString()),
    fuente: r.fuente,
  };
}
