import "server-only";

import { gtZero, type MoneyInput } from "@/lib/decimal";
import { db } from "@/lib/db";
import { crearAsientoDivergencia } from "@/lib/services/asiento-automatico";
import {
  type Asiento,
  ContenedorEstado,
  DivergenciaCausa,
  DivergenciaEstado,
  type DivergenciaInvestigacion,
  DivergenciaResp,
  Prisma,
} from "@/generated/prisma/client";

// ============================================================
// PR 3.3 — Investigación de divergencia formal (D9)
// ============================================================
//
// Una divergencia (físico ≠ declarado al desconsolidar) NO es un ajuste
// mecánico: es una investigación con tratamiento contable dependiente de la
// causa-raíz. Este servicio gobierna su ciclo de vida 1:1 con una
// Desconsolidacion:
//
//   abrir → (conferencia física) → diagnosticar causa → concluir | archivar
//
// `concluir` genera el asiento de ajuste reutilizando el helper de PR 3.1
// (`crearAsientoDivergencia`). La valuación de la diferencia se hace al
// costo FC unitario del ItemContenedor (USD) convertido a ARS con el
// `tipoCambio` del embarque — la conciliación contra el costo landed fino
// queda para cuando aterricen los servicios de costeo (3.2 / 4.5).
//
// Todas las funciones aceptan `tx?`: con transacción se ejecutan inline;
// sin ella abren su propia `db.$transaction`. NINGÚN caller real todavía
// (flag CONTENEDOR_DESCONSOLIDACION_ENABLED apagada).

type TxClient = Prisma.TransactionClient;

export type DivergenciaErrorCode =
  | "DESCONSOLIDACION_INEXISTENTE"
  | "INVESTIGACION_INEXISTENTE"
  | "INVESTIGACION_DUPLICADA"
  | "SIN_DIVERGENCIA"
  | "COSTO_NO_DISPONIBLE"
  | "ESTADO_INVALIDO"
  | "CAUSA_INCOHERENTE"
  | "CAUSA_NO_DIAGNOSTICADA"
  | "CUENTA_REQUERIDA"
  | "TIPO_CAMBIO_INVALIDO";

export class DivergenciaError extends Error {
  readonly code: DivergenciaErrorCode;

  constructor(code: DivergenciaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DivergenciaError";
    this.code = code;
  }
}

/**
 * Responsable esperado por causa-raíz. `DEPOSITARIO` no tiene un slot
 * dedicado en el enum DivergenciaResp (es un tercero), así que sólo se exige
 * que el responsable NO sea NENHUM (alguien responde por la falta).
 */
const RESP_ESPERADA: Partial<Record<DivergenciaCausa, DivergenciaResp>> = {
  [DivergenciaCausa.FABRICA_ORIGEM]: DivergenciaResp.FORNECEDOR,
  [DivergenciaCausa.TRANSPORTE]: DivergenciaResp.TRANSPORTADOR,
  [DivergenciaCausa.SINISTRO_SEGURADO]: DivergenciaResp.SEGURADORA,
  [DivergenciaCausa.NAO_IDENTIFICADA]: DivergenciaResp.NENHUM,
};

// ---- abrir -----------------------------------------------------------

export interface AbrirInvestigacionInput {
  desconsolidacionId: string;
}

/**
 * Abre la investigación de una desconsolidación cuyo físico difiere del
 * declarado. Deriva los `DivergenciaItem` de los counters de ItemContenedor
 * (`cantidadFisica` vs `cantidadDeclarada`) valuando cada diferencia al
 * costo FC unitario. Deja el contenedor en `AGUARDANDO_INVESTIGACAO`.
 */
export async function abrirInvestigacion(
  input: AbrirInvestigacionInput,
  tx?: TxClient,
): Promise<DivergenciaInvestigacion> {
  const run = async (t: TxClient) => {
    const desc = await t.desconsolidacion.findUnique({
      where: { id: input.desconsolidacionId },
      include: { divergencia: true, contenedor: { include: { items: true } } },
    });
    if (!desc) {
      throw new DivergenciaError(
        "DESCONSOLIDACION_INEXISTENTE",
        `No existe la desconsolidación ${input.desconsolidacionId}.`,
      );
    }
    if (desc.divergencia) {
      throw new DivergenciaError(
        "INVESTIGACION_DUPLICADA",
        `La desconsolidación ${desc.id} ya tiene una investigación abierta.`,
      );
    }

    const itemsDivergentes = desc.contenedor.items
      .filter((it) => it.cantidadFisica != null && it.cantidadFisica !== it.cantidadDeclarada)
      .map((it) => {
        if (it.costoFCUnitario == null) {
          throw new DivergenciaError(
            "COSTO_NO_DISPONIBLE",
            `El ItemContenedor ${it.id} no tiene costo FC unitario para valuar la divergencia.`,
          );
        }
        const fisica = it.cantidadFisica as number;
        const diff = fisica - it.cantidadDeclarada;
        const valor = new Prisma.Decimal(diff).times(it.costoFCUnitario);
        return {
          itemContenedorId: it.id,
          cantidadDeclarada: it.cantidadDeclarada,
          cantidadFisica: fisica,
          diferenciaUnidades: diff,
          valorImpactadoUSD: new Prisma.Decimal(valor.toFixed(4)),
        };
      });

    if (itemsDivergentes.length === 0) {
      throw new DivergenciaError(
        "SIN_DIVERGENCIA",
        `La desconsolidación ${desc.id} no presenta diferencias entre físico y declarado.`,
      );
    }

    const investigacion = await t.divergenciaInvestigacion.create({
      data: {
        desconsolidacionId: desc.id,
        estado: DivergenciaEstado.EM_ANALISE,
        items: { create: itemsDivergentes },
      },
    });

    await t.contenedor.update({
      where: { id: desc.contenedorId },
      data: { estado: ContenedorEstado.AGUARDANDO_INVESTIGACAO },
    });

    return investigacion;
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

// ---- conferencia física ----------------------------------------------

export interface ConferenciaFisicaInput {
  pesoContenedorKg?: MoneyInput;
  pesoEsperadoKg?: MoneyInput;
  lacreOrigemOk?: boolean;
  lacreOrigemObs?: string;
  lacrePemaOk?: boolean;
  lacreCustomsOk?: boolean;
  gravacaoDescargaUrl?: string;
  fotosUrls?: string[];
  documentosUrls?: string[];
}

/** Registra la conferencia física (peso, lacres, evidencias). Sólo EM_ANALISE. */
export async function registrarConferenciaFisica(
  investigacionId: string,
  datos: ConferenciaFisicaInput,
  tx?: TxClient,
): Promise<DivergenciaInvestigacion> {
  const run = async (t: TxClient) => {
    await assertEnAnalisis(t, investigacionId);
    return t.divergenciaInvestigacion.update({
      where: { id: investigacionId },
      data: {
        pesoContenedorKg:
          datos.pesoContenedorKg != null
            ? new Prisma.Decimal(datos.pesoContenedorKg.toString())
            : undefined,
        pesoEsperadoKg:
          datos.pesoEsperadoKg != null
            ? new Prisma.Decimal(datos.pesoEsperadoKg.toString())
            : undefined,
        lacreOrigemOk: datos.lacreOrigemOk,
        lacreOrigemObs: datos.lacreOrigemObs,
        lacrePemaOk: datos.lacrePemaOk,
        lacreCustomsOk: datos.lacreCustomsOk,
        gravacaoDescargaUrl: datos.gravacaoDescargaUrl,
        fotosUrls: datos.fotosUrls,
        documentosUrls: datos.documentosUrls,
      },
    });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

// ---- diagnóstico de causa --------------------------------------------

export interface DiagnosticoCausaInput {
  causa: DivergenciaCausa;
  responsavelTipo: DivergenciaResp;
  responsavelId?: string;
  polizaSeguro?: string;
}

/** Asigna causa-raíz + responsable, validando su coherencia. Sólo EM_ANALISE. */
export async function diagnosticarCausa(
  investigacionId: string,
  datos: DiagnosticoCausaInput,
  tx?: TxClient,
): Promise<DivergenciaInvestigacion> {
  const run = async (t: TxClient) => {
    await assertEnAnalisis(t, investigacionId);

    const esperada = RESP_ESPERADA[datos.causa];
    if (esperada != null && datos.responsavelTipo !== esperada) {
      throw new DivergenciaError(
        "CAUSA_INCOHERENTE",
        `La causa ${datos.causa} exige responsable ${esperada}, no ${datos.responsavelTipo}.`,
      );
    }
    if (
      datos.causa === DivergenciaCausa.DEPOSITARIO &&
      datos.responsavelTipo === DivergenciaResp.NENHUM
    ) {
      throw new DivergenciaError(
        "CAUSA_INCOHERENTE",
        "La causa DEPOSITARIO requiere un responsable (no NENHUM).",
      );
    }
    if (datos.causa === DivergenciaCausa.SINISTRO_SEGURADO && !datos.polizaSeguro?.trim()) {
      throw new DivergenciaError(
        "CAUSA_INCOHERENTE",
        "La causa SINISTRO_SEGURADO requiere número de póliza.",
      );
    }

    return t.divergenciaInvestigacion.update({
      where: { id: investigacionId },
      data: {
        causaIdentificada: datos.causa,
        responsavelTipo: datos.responsavelTipo,
        responsavelId: datos.responsavelId,
        polizaSeguro: datos.polizaSeguro?.trim() || undefined,
      },
    });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

// ---- conclusión -------------------------------------------------------

export interface ConcluirInvestigacionInput {
  fecha: Date;
  /** Obligatoria en FALTA con responsable (causa ≠ NAO_IDENTIFICADA). */
  cuentaPorCobrarId?: number;
  usuarioId?: number;
  descripcion?: string;
}

/**
 * Cierra la investigación generando el asiento de ajuste D9 según la causa
 * diagnosticada. Agrega los `DivergenciaItem` por dirección neta (Σ
 * valorImpactadoUSD): neto < 0 → FALTA, neto > 0 → SOBRA, neto 0 → sin
 * asiento. Convierte USD→ARS con el `tipoCambio` del embarque. Deja el
 * contenedor en `DESCONSOLIDADO`.
 */
export async function concluirInvestigacion(
  investigacionId: string,
  input: ConcluirInvestigacionInput,
  tx?: TxClient,
): Promise<{ investigacion: DivergenciaInvestigacion; asiento: Asiento | null }> {
  const run = async (t: TxClient) => {
    const inv = await t.divergenciaInvestigacion.findUnique({
      where: { id: investigacionId },
      include: {
        items: true,
        desconsolidacion: { include: { contenedor: { include: { embarque: true } } } },
      },
    });
    if (!inv) {
      throw new DivergenciaError(
        "INVESTIGACION_INEXISTENTE",
        `No existe la investigación ${investigacionId}.`,
      );
    }
    if (inv.estado !== DivergenciaEstado.EM_ANALISE) {
      throw new DivergenciaError(
        "ESTADO_INVALIDO",
        `La investigación ${investigacionId} no está EM_ANALISE (está ${inv.estado}).`,
      );
    }
    if (inv.causaIdentificada == null) {
      throw new DivergenciaError(
        "CAUSA_NO_DIAGNOSTICADA",
        "No se puede concluir sin diagnosticar la causa-raíz.",
      );
    }

    const causa = inv.causaIdentificada;
    const { contenedor } = inv.desconsolidacion;
    const tipoCambio = contenedor.embarque.tipoCambio;
    if (!gtZero(tipoCambio)) {
      throw new DivergenciaError(
        "TIPO_CAMBIO_INVALIDO",
        "El embarque no tiene un tipo de cambio válido para valuar la divergencia.",
      );
    }

    const netoUSD = inv.items.reduce(
      (acc, it) => acc.plus(it.valorImpactadoUSD),
      new Prisma.Decimal(0),
    );

    let asiento: Asiento | null = null;
    if (!netoUSD.isZero()) {
      const tipo = netoUSD.isNegative() ? "FALTA" : "SOBRA";
      const montoARS = netoUSD.abs().times(tipoCambio);
      const ubicacion =
        (inv.desconsolidacion.depositoFiscalId ?? contenedor.depositoFiscalId) != null
          ? "DEPOSITO_FISCAL"
          : "ZONA_PRIMARIA";

      if (
        tipo === "FALTA" &&
        causa !== DivergenciaCausa.NAO_IDENTIFICADA &&
        input.cuentaPorCobrarId == null
      ) {
        throw new DivergenciaError(
          "CUENTA_REQUERIDA",
          `La falta con responsable (${causa}) requiere una cuenta a cobrar.`,
        );
      }

      asiento = await crearAsientoDivergencia(
        {
          tipo,
          causa,
          monto: montoARS.toFixed(2),
          ubicacion,
          cuentaPorCobrarId: input.cuentaPorCobrarId,
          fecha: input.fecha,
          descripcion: input.descripcion,
        },
        t,
      );
    }

    const investigacion = await t.divergenciaInvestigacion.update({
      where: { id: investigacionId },
      data: {
        estado: DivergenciaEstado.CONCLUIDA,
        asientoAjusteId: asiento?.id ?? null,
        closedAt: new Date(),
        closedBy: input.usuarioId,
      },
    });

    await t.contenedor.update({
      where: { id: contenedor.id },
      data: { estado: ContenedorEstado.DESCONSOLIDADO },
    });

    return { investigacion, asiento };
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

// ---- archivar ---------------------------------------------------------

export interface ArquivarInvestigacionInput {
  motivo?: string;
}

/** Archiva la investigación sin asiento (diferencia regularizada por fuera). */
export async function arquivarInvestigacion(
  investigacionId: string,
  input: ArquivarInvestigacionInput,
  tx?: TxClient,
): Promise<DivergenciaInvestigacion> {
  const run = async (t: TxClient) => {
    const inv = await assertEnAnalisis(t, investigacionId);

    const investigacion = await t.divergenciaInvestigacion.update({
      where: { id: investigacionId },
      data: {
        estado: DivergenciaEstado.ARQUIVADA,
        closedAt: new Date(),
        observaciones: input.motivo,
      },
    });

    await t.contenedor.update({
      where: { id: inv.desconsolidacion.contenedorId },
      data: { estado: ContenedorEstado.DESCONSOLIDADO },
    });

    return investigacion;
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

// ---- helpers ----------------------------------------------------------

/**
 * Carga la investigación con su desconsolidación y exige estado EM_ANALISE.
 * Lanza INVESTIGACION_INEXISTENTE / ESTADO_INVALIDO.
 */
async function assertEnAnalisis(t: TxClient, investigacionId: string) {
  const inv = await t.divergenciaInvestigacion.findUnique({
    where: { id: investigacionId },
    include: { desconsolidacion: true },
  });
  if (!inv) {
    throw new DivergenciaError(
      "INVESTIGACION_INEXISTENTE",
      `No existe la investigación ${investigacionId}.`,
    );
  }
  if (inv.estado !== DivergenciaEstado.EM_ANALISE) {
    throw new DivergenciaError(
      "ESTADO_INVALIDO",
      `La investigación ${investigacionId} no está EM_ANALISE (está ${inv.estado}).`,
    );
  }
  return inv;
}
