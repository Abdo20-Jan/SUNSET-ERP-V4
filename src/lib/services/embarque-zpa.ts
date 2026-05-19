import { db } from "@/lib/db";
import { Prisma, TipoDeposito } from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

export class DepositoZpaError extends Error {
  constructor(
    public readonly code: "NO_HAY_ZPA" | "MULTIPLES_ZPA" | "NO_HAY_NACIONAL",
    message: string,
  ) {
    super(message);
    this.name = "DepositoZpaError";
  }
}

/**
 * Devuelve el depósito predeterminado de tipo ZONA_PRIMARIA. Si hay
 * más de uno activo, devuelve el primero (orden alfabético) y registra
 * un warning. Si no hay ninguno, lanza error con código NO_HAY_ZPA.
 *
 * El caller (ej: confirmarZonaPrimariaAction) puede pasarle un
 * `depositoZonaPrimariaId` específico via Embarque.depositoZonaPrimariaId
 * para evitar el lookup automático.
 */
export async function getDepositoZonaPrimariaPredeterminado(
  client: TxClient | typeof db,
): Promise<{ id: string; nombre: string }> {
  const candidatos = await client.deposito.findMany({
    where: { tipo: TipoDeposito.ZONA_PRIMARIA, activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });

  if (candidatos.length === 0) {
    throw new DepositoZpaError(
      "NO_HAY_ZPA",
      "No hay depósito tipo ZONA_PRIMARIA configurado. Cree uno en /maestros/depositos.",
    );
  }
  if (candidatos.length > 1) {
    console.warn(
      `[embarque-zpa] Múltiples depósitos ZONA_PRIMARIA activos (${candidatos.length}). Usando "${candidatos[0]!.nombre}". Considere usar Embarque.depositoZonaPrimariaId para selección explícita.`,
    );
  }
  return candidatos[0]!;
}

/**
 * Devuelve el depósito predeterminado de tipo NACIONAL. Útil para
 * fallback en casos donde un caller no especifica destino.
 */
export async function getDepositoNacionalPredeterminado(
  client: TxClient | typeof db,
): Promise<{ id: string; nombre: string }> {
  const candidatos = await client.deposito.findMany({
    where: { tipo: TipoDeposito.NACIONAL, activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });

  if (candidatos.length === 0) {
    throw new DepositoZpaError(
      "NO_HAY_NACIONAL",
      "No hay depósito tipo NACIONAL configurado. Cree uno en /maestros/depositos.",
    );
  }
  return candidatos[0]!;
}

/**
 * Resuelve el depositoZpaId a usar para un embarque. Si el embarque
 * tiene `depositoZonaPrimariaId` explícito, valida que sea tipo
 * ZONA_PRIMARIA y devuelve. Caso contrario, usa el predeterminado.
 */
export async function resolverDepositoZpa(
  client: TxClient | typeof db,
  embarque: { codigo: string; depositoZonaPrimariaId: string | null },
): Promise<{ id: string; nombre: string }> {
  if (embarque.depositoZonaPrimariaId) {
    const explicito = await client.deposito.findUnique({
      where: { id: embarque.depositoZonaPrimariaId },
      select: { id: true, nombre: true, tipo: true, activo: true },
    });
    if (!explicito) {
      throw new DepositoZpaError(
        "NO_HAY_ZPA",
        `Embarque ${embarque.codigo} apunta a depósito ZPA inexistente (${embarque.depositoZonaPrimariaId}).`,
      );
    }
    if (explicito.tipo !== TipoDeposito.ZONA_PRIMARIA) {
      throw new DepositoZpaError(
        "NO_HAY_ZPA",
        `Embarque ${embarque.codigo}: el depósito "${explicito.nombre}" no es de tipo ZONA_PRIMARIA.`,
      );
    }
    if (!explicito.activo) {
      throw new DepositoZpaError(
        "NO_HAY_ZPA",
        `Embarque ${embarque.codigo}: el depósito "${explicito.nombre}" está inactivo.`,
      );
    }
    return { id: explicito.id, nombre: explicito.nombre };
  }
  return getDepositoZonaPrimariaPredeterminado(client);
}
