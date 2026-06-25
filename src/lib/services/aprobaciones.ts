import "server-only";

// Motor genérico de aprobaciones (PR-012 · AUTO-01 / CRIT-03). Máquina de
// estados PURA: request → decisión → SLA → escalonamiento. NO ejecuta efectos
// de negocio — sólo rastrea el estado de aprobación; el EFECTO lo aplica luego
// la acción gateada (PR-014+). Cada transición se gatea con `hasPermission`
// (matriz ANEXO A.3) y se audita con `registrarAuditoria` (consume PR-008).
//
// Garantías: (1) INERTE — cada función pública lanza si APPROVALS_ENABLED=off;
// (2) determinismo — el tiempo entra como `ahora: Date` (sin leer el reloj); (3)
// atomicidad — mutación + auditoría en la MISMA transacción.
//
// La régua de escalonamiento vive en `./aprobaciones-escalonamiento` y se
// re-exporta acá para ofrecer un único punto de entrada del motor.

import { type Prisma } from "@/generated/prisma/client";
import type { Moneda, Solicitud } from "@/generated/prisma/client";
import {
  AuditAccion,
  AuditOrigen,
  EstadoSolicitud,
  type TipoAprobacion,
  TipoDecisionAprobacion,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permisos";
import { type PermisoKey, PERMISOS } from "@/lib/permisos-catalog";
import { addHoras, aplicarDupla, auditDeAprobacion } from "./aprobaciones-helpers";
import { getConfigAprobacion } from "./aprobaciones-matriz";
import {
  type AprobacionesTx,
  assertHabilitado,
  cargarSolicitud,
  ejecutar,
  err,
  ERR_ESTADO,
  ERR_MOTIVO,
  ERR_NO_ENCONTRADA,
  ERR_PERMISO,
  ERR_YA_APROBO,
  ESTADOS_ABIERTOS,
  esTransitable,
  type ResultadoAprobacion,
  tieneMotivo,
  toJson,
} from "./aprobaciones-shared";
import { registrarAuditoria } from "./auditoria";

export type { ResultadoAprobacion } from "./aprobaciones-shared";
export {
  procesarEscalonamientos,
  type ResultadoEscalonamiento,
} from "./aprobaciones-escalonamiento";

// ── crearSolicitud (acción del solicitante — sólo gateada por la flag) ───────

export async function crearSolicitud(
  input: {
    tipo: TipoAprobacion;
    tabla: string;
    registroId: string;
    solicitanteId: string;
    motivo: string;
    valor?: number | string | null;
    moneda?: Moneda | null;
    anexos?: Prisma.InputJsonValue | null;
    datos?: Prisma.InputJsonValue | null;
    ahora: Date;
  },
  tx?: AprobacionesTx,
): Promise<{ ok: true; solicitud: Solicitud }> {
  assertHabilitado();
  const config = getConfigAprobacion(input.tipo);
  const venceEn = addHoras(input.ahora, config.slaHoras);
  return ejecutar(tx, async (t) => {
    const solicitud = await t.solicitud.create({
      data: {
        tipo: input.tipo,
        estado: EstadoSolicitud.PENDIENTE,
        tabla: input.tabla,
        registroId: input.registroId,
        solicitanteId: input.solicitanteId,
        motivo: input.motivo,
        valor: input.valor ?? null,
        moneda: input.moneda ?? null,
        slaHoras: config.slaHoras,
        venceEn,
        requiereDupla: config.requiereDupla,
        anexos: toJson(input.anexos),
        datos: toJson(input.datos),
      },
    });
    await registrarAuditoria(t, {
      tabla: "Solicitud",
      registroId: solicitud.id,
      accion: AuditAccion.CAMBIO_ESTADO,
      usuarioId: input.solicitanteId,
      datosNuevos: {
        estado: EstadoSolicitud.PENDIENTE,
        tipo: input.tipo,
        venceEn: venceEn.toISOString(),
      },
      origen: AuditOrigen.MANUAL,
      motivo: input.motivo,
    });
    return { ok: true, solicitud };
  });
}

// ── aprobar (incluye dupla aprobación y Master override manual) ──────────────

export async function aprobar(
  input: {
    solicitudId: string;
    aprobadorId: string;
    comentario?: string | null;
    esMasterOverride?: boolean;
    ip?: string | null;
    ahora: Date;
  },
  tx?: AprobacionesTx,
): Promise<ResultadoAprobacion> {
  assertHabilitado();
  const previa = await cargarSolicitud(db, input.solicitudId);
  if (!previa) return err(ERR_NO_ENCONTRADA);
  if (!esTransitable(previa.estado)) return err(ERR_ESTADO);
  const esMaster = input.esMasterOverride === true;
  if (!(await puedeAprobar(previa, esMaster))) return err(ERR_PERMISO);
  return ejecutar(tx, (t) => aplicarAprobacion(t, input, esMaster));
}

async function puedeAprobar(s: Solicitud, esMaster: boolean): Promise<boolean> {
  const permiso = esMaster
    ? PERMISOS.APROBAR_MASTER_OVERRIDE
    : getConfigAprobacion(s.tipo).permisoAprobacion;
  return hasPermission(permiso);
}

function contarAprobadoresDistintos(t: AprobacionesTx, solicitudId: string): Promise<number> {
  return t.aprobacion
    .findMany({
      where: { solicitudId, decision: TipoDecisionAprobacion.APROBADA },
      select: { aprobadorId: true },
      distinct: ["aprobadorId"],
    })
    .then((filas) => filas.length);
}

async function resolverEstadoTrasAprobar(
  t: AprobacionesTx,
  s: Solicitud,
  esMaster: boolean,
): Promise<{ estado: EstadoSolicitud; resuelta: boolean }> {
  if (esMaster) return { estado: EstadoSolicitud.APROBADA, resuelta: true };
  const distintas = await contarAprobadoresDistintos(t, s.id);
  return aplicarDupla(s.requiereDupla, distintas);
}

async function aplicarAprobacion(
  t: AprobacionesTx,
  input: {
    solicitudId: string;
    aprobadorId: string;
    comentario?: string | null;
    ip?: string | null;
    ahora: Date;
  },
  esMaster: boolean,
): Promise<ResultadoAprobacion> {
  const s = await cargarSolicitud(t, input.solicitudId);
  if (!s || !esTransitable(s.estado)) return err(ERR_ESTADO);
  const yaAprobo = await t.aprobacion.count({
    where: {
      solicitudId: s.id,
      aprobadorId: input.aprobadorId,
      decision: TipoDecisionAprobacion.APROBADA,
    },
  });
  if (yaAprobo > 0) return err(ERR_YA_APROBO);
  await t.aprobacion.create({
    data: {
      solicitudId: s.id,
      aprobadorId: input.aprobadorId,
      decision: TipoDecisionAprobacion.APROBADA,
      comentario: input.comentario ?? null,
      esMasterOverride: esMaster,
      nivelEscalonamiento: s.nivelEscalonamiento,
    },
  });
  const { estado, resuelta } = await resolverEstadoTrasAprobar(t, s, esMaster);
  const actualizada = await t.solicitud.update({
    where: { id: s.id },
    data: {
      estado,
      resueltaEn: resuelta ? input.ahora : undefined,
      comentarioResolucion: resuelta ? (input.comentario ?? null) : undefined,
    },
  });
  const { accion, origen } = auditDeAprobacion(esMaster);
  await registrarAuditoria(t, {
    tabla: "Solicitud",
    registroId: s.id,
    accion,
    usuarioId: input.aprobadorId,
    datosAnteriores: { estado: s.estado },
    datosNuevos: { estado, esMasterOverride: esMaster },
    origen,
    motivo: input.comentario ?? null,
    ip: input.ip ?? null,
  });
  return { ok: true, solicitud: actualizada };
}

// ── Transiciones simples (rechazar / solicitar info / responder / cancelar) ──

interface TransicionSpec {
  solicitudId: string;
  usuarioId: string;
  estadosPermitidos: readonly EstadoSolicitud[];
  estadoNuevo: EstadoSolicitud;
  accion: AuditAccion;
  origen: AuditOrigen;
  ahora: Date;
  /** Gate por clave de permiso (derivada de la solicitud). */
  permiso?: (s: Solicitud) => PermisoKey;
  /** Gate alternativo (ej.: el propio solicitante o un admin). */
  autorizado?: (s: Solicitud) => boolean;
  motivo?: string | null;
  motivoObligatorio?: boolean;
  comentario?: string | null;
  ip?: string | null;
  decision?: TipoDecisionAprobacion;
  esResolucion?: boolean;
}

async function autorizadoParaTransicion(spec: TransicionSpec, s: Solicitud): Promise<boolean> {
  if (spec.permiso) return hasPermission(spec.permiso(s));
  return spec.autorizado ? spec.autorizado(s) : true;
}

async function gateTransicion(spec: TransicionSpec): Promise<ResultadoAprobacion | null> {
  if (spec.motivoObligatorio && !tieneMotivo(spec.motivo)) return err(ERR_MOTIVO);
  const previa = await cargarSolicitud(db, spec.solicitudId);
  if (!previa) return err(ERR_NO_ENCONTRADA);
  if (!spec.estadosPermitidos.includes(previa.estado)) return err(ERR_ESTADO);
  if (!(await autorizadoParaTransicion(spec, previa))) return err(ERR_PERMISO);
  return null;
}

async function mutarTransicion(
  t: AprobacionesTx,
  spec: TransicionSpec,
): Promise<ResultadoAprobacion> {
  const s = await cargarSolicitud(t, spec.solicitudId);
  if (!s || !spec.estadosPermitidos.includes(s.estado)) return err(ERR_ESTADO);
  if (spec.decision) {
    await t.aprobacion.create({
      data: {
        solicitudId: s.id,
        aprobadorId: spec.usuarioId,
        decision: spec.decision,
        comentario: spec.comentario ?? spec.motivo ?? null,
        nivelEscalonamiento: s.nivelEscalonamiento,
      },
    });
  }
  const actualizada = await t.solicitud.update({
    where: { id: s.id },
    data: {
      estado: spec.estadoNuevo,
      resueltaEn: spec.esResolucion ? spec.ahora : undefined,
      comentarioResolucion: spec.esResolucion
        ? (spec.comentario ?? spec.motivo ?? null)
        : undefined,
    },
  });
  await registrarAuditoria(t, {
    tabla: "Solicitud",
    registroId: s.id,
    accion: spec.accion,
    usuarioId: spec.usuarioId,
    datosAnteriores: { estado: s.estado },
    datosNuevos: { estado: spec.estadoNuevo },
    origen: spec.origen,
    motivo: spec.motivo ?? spec.comentario ?? null,
    ip: spec.ip ?? null,
  });
  return { ok: true, solicitud: actualizada };
}

async function ejecutarTransicion(
  spec: TransicionSpec,
  tx?: AprobacionesTx,
): Promise<ResultadoAprobacion> {
  assertHabilitado();
  const gate = await gateTransicion(spec);
  if (gate) return gate;
  return ejecutar(tx, (t) => mutarTransicion(t, spec));
}

export function rechazar(
  input: {
    solicitudId: string;
    aprobadorId: string;
    motivo: string;
    ip?: string | null;
    ahora: Date;
  },
  tx?: AprobacionesTx,
): Promise<ResultadoAprobacion> {
  return ejecutarTransicion(
    {
      solicitudId: input.solicitudId,
      usuarioId: input.aprobadorId,
      estadosPermitidos: ESTADOS_ABIERTOS,
      estadoNuevo: EstadoSolicitud.RECHAZADA,
      accion: AuditAccion.CAMBIO_ESTADO,
      origen: AuditOrigen.MANUAL,
      permiso: (s) => getConfigAprobacion(s.tipo).permisoAprobacion,
      motivo: input.motivo,
      motivoObligatorio: true,
      ip: input.ip ?? null,
      decision: TipoDecisionAprobacion.RECHAZADA,
      esResolucion: true,
      ahora: input.ahora,
    },
    tx,
  );
}

export function solicitarInformacion(
  input: {
    solicitudId: string;
    aprobadorId: string;
    comentario: string;
    ip?: string | null;
    ahora: Date;
  },
  tx?: AprobacionesTx,
): Promise<ResultadoAprobacion> {
  return ejecutarTransicion(
    {
      solicitudId: input.solicitudId,
      usuarioId: input.aprobadorId,
      estadosPermitidos: ESTADOS_ABIERTOS,
      estadoNuevo: EstadoSolicitud.SOLICITANDO_INFO,
      accion: AuditAccion.CAMBIO_ESTADO,
      origen: AuditOrigen.MANUAL,
      permiso: (s) => getConfigAprobacion(s.tipo).permisoAprobacion,
      comentario: input.comentario,
      ip: input.ip ?? null,
      decision: TipoDecisionAprobacion.INFO_SOLICITADA,
      ahora: input.ahora,
    },
    tx,
  );
}

export function responderInformacion(
  input: {
    solicitudId: string;
    usuarioId: string;
    comentario?: string | null;
    esAdmin?: boolean;
    ip?: string | null;
    ahora: Date;
  },
  tx?: AprobacionesTx,
): Promise<ResultadoAprobacion> {
  return ejecutarTransicion(
    {
      solicitudId: input.solicitudId,
      usuarioId: input.usuarioId,
      estadosPermitidos: [EstadoSolicitud.SOLICITANDO_INFO],
      estadoNuevo: EstadoSolicitud.PENDIENTE,
      accion: AuditAccion.CAMBIO_ESTADO,
      origen: AuditOrigen.MANUAL,
      autorizado: (s) => s.solicitanteId === input.usuarioId || input.esAdmin === true,
      comentario: input.comentario ?? null,
      ip: input.ip ?? null,
      ahora: input.ahora,
    },
    tx,
  );
}

export function cancelar(
  input: {
    solicitudId: string;
    usuarioId: string;
    motivo: string;
    esAdmin?: boolean;
    ip?: string | null;
    ahora: Date;
  },
  tx?: AprobacionesTx,
): Promise<ResultadoAprobacion> {
  return ejecutarTransicion(
    {
      solicitudId: input.solicitudId,
      usuarioId: input.usuarioId,
      estadosPermitidos: ESTADOS_ABIERTOS,
      estadoNuevo: EstadoSolicitud.CANCELADA,
      accion: AuditAccion.CANCELACION,
      origen: AuditOrigen.MANUAL,
      autorizado: (s) => s.solicitanteId === input.usuarioId || input.esAdmin === true,
      motivo: input.motivo,
      motivoObligatorio: true,
      ip: input.ip ?? null,
      esResolucion: true,
      ahora: input.ahora,
    },
    tx,
  );
}
