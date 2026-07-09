import "server-only";

/**
 * Próximas acciones pendientes de las oportunidades (CRM-01 · PR-030).
 *
 * Proyección READ-ONLY sobre `Actividad`: una fila por actividad pendiente
 * (completada=false) vinculada a una oportunidad, ordenada por
 * `fechaProgramada` asc con nulls AL FINAL — así el primer hit por
 * oportunidad ya es la "próxima acción" (first-wins en el helper puro
 * `derivarProximaAccionPorOportunidad` de la presentación). Select mínimo:
 * nada monetario ni sensible entra al payload.
 */

import { db } from "@/lib/db";
import type { ActividadTipo } from "@/generated/prisma/client";

export type ActividadPendienteRow = {
  oportunidadId: string;
  tipo: ActividadTipo;
  contenido: string;
  fechaProgramada: Date | null;
};

export async function listarProximasAccionesPendientes(): Promise<ActividadPendienteRow[]> {
  const rows = await db.actividad.findMany({
    where: { oportunidadId: { not: null }, completada: false },
    orderBy: { fechaProgramada: { sort: "asc", nulls: "last" } },
    select: {
      oportunidadId: true,
      tipo: true,
      contenido: true,
      fechaProgramada: true,
    },
  });
  // `oportunidadId` no-nulo garantizado por el where ({ not: null }).
  return rows.map((a) => ({
    oportunidadId: a.oportunidadId as string,
    tipo: a.tipo,
    contenido: a.contenido,
    fechaProgramada: a.fechaProgramada,
  }));
}
