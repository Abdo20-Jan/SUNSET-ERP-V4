import "server-only";

import { db } from "@/lib/db";
import { type AuditAccion, type AuditOrigen, Prisma } from "@/generated/prisma/client";

// Cliente mínimo para escribir auditoría: sirve tanto `db` como un `tx` de
// $transaction (ambos exponen `auditLog`). Espeja el patrón WriterClient de
// retencion-ganancias-pago.ts.
type AuditWriter = Pick<Prisma.TransactionClient, "auditLog">;

type RegistrarAuditoriaInput = {
  tabla: string;
  registroId: string;
  accion: AuditAccion;
  usuarioId: string;
  // Snapshots JSON-safe (scalars/objetos planos). El helper convierte
  // null/undefined a Prisma.JsonNull, así los callers pasan objetos sin castear.
  datosAnteriores?: unknown;
  datosNuevos?: unknown;
  // PR-008 (aditivo · G-07/CRIT-11): metadata opcional. Los callers previos
  // (proveedores/ventas) no pasan ninguno → motivo/ip/documentoId quedan null
  // y origen toma el default MANUAL del schema. Comportamiento idéntico.
  motivo?: string | null;
  origen?: AuditOrigen;
  ip?: string | null;
  documentoId?: string | null;
};

function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

// Graba una entrada de AuditLog. Debe llamarse DENTRO del $transaction de la
// mutación (atómico: o muta + audita, o nada). El `usuarioId` debe venir de
// requireSessionUser() — valida que el User existe antes de escribir la FK
// AuditLog.usuarioId (evita P2003 tras un reseed).
export async function registrarAuditoria(
  tx: AuditWriter,
  input: RegistrarAuditoriaInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tabla: input.tabla,
      registroId: input.registroId,
      accion: input.accion,
      usuarioId: input.usuarioId,
      datosAnteriores: toJsonInput(input.datosAnteriores),
      datosNuevos: toJsonInput(input.datosNuevos),
      motivo: input.motivo ?? null,
      ip: input.ip ?? null,
      documentoId: input.documentoId ?? null,
      // `origen` sólo cuando viene; si se omite, el default MANUAL del schema
      // aplica (así no cambia el comportamiento de los callers existentes).
      ...(input.origen ? { origen: input.origen } : {}),
    },
  });
}

export type AuditEntry = {
  id: number;
  accion: AuditAccion;
  fecha: Date;
  usuario: string;
  datosAnteriores: unknown;
  datosNuevos: unknown;
  // PR-008 (aditivo): metadata G-07/CRIT-11. En filas previas: origen=MANUAL,
  // motivo/ip = null (la UI no los dibuja cuando no aportan info).
  motivo: string | null;
  origen: AuditOrigen;
  ip: string | null;
};

// Historial de cambios de un record (más reciente primero). Usa el índice
// @@index([tabla, registroId]). El nombre del usuario sale de la relación
// (User.nombre es obligatorio en el schema).
export async function getAuditLog(tabla: string, registroId: string): Promise<AuditEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { tabla, registroId },
    orderBy: { fecha: "desc" },
    include: { usuario: { select: { nombre: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    accion: row.accion,
    fecha: row.fecha,
    usuario: row.usuario.nombre,
    datosAnteriores: row.datosAnteriores,
    datosNuevos: row.datosNuevos,
    motivo: row.motivo,
    origen: row.origen,
    ip: row.ip,
  }));
}
