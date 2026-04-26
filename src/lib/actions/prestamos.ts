"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { crearCuentaParaEntidad } from "@/lib/services/cuenta-auto";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoPrestamo,
} from "@/lib/services/asiento-automatico";
import {
  calcularSaldoPrestamo,
  calcularSaldosPrestamos,
  contarAmortizacionesContabilizadasPrestamo,
  listarAmortizacionesPrestamo,
} from "@/lib/services/prestamo";
import {
  AsientoEstado,
  CuentaCategoria,
  CuentaTipo,
  Moneda,
  PrestamoClasificacion,
  Prisma,
} from "@/generated/prisma/client";

// ============================================================
// Listados auxiliares para formularios
// ============================================================

export type ProveedorPrestamistaOption = {
  id: string;
  nombre: string;
  pais: string;
};

/**
 * Proveedores del exterior (pais != AR) — son los candidatos a prestamistas
 * para préstamos externos.
 */
export async function listarProveedoresParaPrestamo(): Promise<
  ProveedorPrestamistaOption[]
> {
  const rows = await db.proveedor.findMany({
    where: { pais: { not: "AR" }, estado: "activo" },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, pais: true },
  });
  return rows;
}

export type CuentaPrestamoOption = {
  id: number;
  codigo: string;
  nombre: string;
};

const CLASIFICACION_PREFIX: Record<PrestamoClasificacion, string> = {
  [PrestamoClasificacion.CORTO_PLAZO]: "2.1.7.",
  [PrestamoClasificacion.LARGO_PLAZO]: "2.2.1.",
};

export async function listarCuentasContablesParaPrestamo(
  clasificacion: PrestamoClasificacion,
): Promise<CuentaPrestamoOption[]> {
  const prefix = CLASIFICACION_PREFIX[clasificacion];

  const [cuentas, bancarias, prestamosActivos] = await Promise.all([
    db.cuentaContable.findMany({
      where: {
        tipo: CuentaTipo.ANALITICA,
        activa: true,
        categoria: CuentaCategoria.PASIVO,
        codigo: { startsWith: prefix },
      },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
    db.cuentaBancaria.findMany({ select: { cuentaContableId: true } }),
    db.prestamoExterno.findMany({
      where: {
        OR: [
          { asiento: { estado: { not: AsientoEstado.ANULADO } } },
          { asientoId: null },
        ],
      },
      select: { cuentaContableId: true },
    }),
  ]);

  const ocupadas = new Set<number>([
    ...bancarias.map((b) => b.cuentaContableId),
    ...prestamosActivos.map((p) => p.cuentaContableId),
  ]);
  return cuentas
    .filter((c) => !ocupadas.has(c.id))
    .map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));
}

// ============================================================
// Listagem principal
// ============================================================

export type PrestamoRow = {
  id: string;
  prestamista: string;
  clasificacion: PrestamoClasificacion;
  moneda: Moneda;
  principal: string;
  tipoCambio: string;
  cuentaBancaria: {
    id: string;
    banco: string;
    numero: string;
    moneda: Moneda;
  };
  cuentaContable: {
    id: number;
    codigo: string;
    nombre: string;
  };
  asiento: {
    id: string;
    numero: number;
    estado: AsientoEstado;
    fecha: string;
  } | null;
  saldoPendiente: string;
  createdAt: string;
};

export type PrestamoEstadoFiltro = "CONTABILIZADO" | "ANULADO" | "SIN_ASIENTO";

export type PrestamoListFilters = {
  clasificacion?: PrestamoClasificacion;
  moneda?: Moneda;
  estado?: PrestamoEstadoFiltro;
};

export async function listarPrestamosConSaldo(
  filtros?: PrestamoListFilters,
): Promise<PrestamoRow[]> {
  const where: Prisma.PrestamoExternoWhereInput = {};
  if (filtros?.clasificacion) where.clasificacion = filtros.clasificacion;
  if (filtros?.moneda) where.moneda = filtros.moneda;
  if (filtros?.estado === "SIN_ASIENTO") {
    where.asientoId = null;
  } else if (filtros?.estado) {
    where.asiento = { estado: filtros.estado };
  }

  const prestamos = await db.prestamoExterno.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      cuentaBancaria: {
        select: { id: true, banco: true, numero: true, moneda: true },
      },
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
      asiento: { select: { id: true, numero: true, estado: true, fecha: true } },
    },
  });

  const cuentaIds = Array.from(
    new Set(prestamos.map((p) => p.cuentaContableId)),
  );
  const saldos = await calcularSaldosPrestamos(cuentaIds);

  return prestamos.map((p) => ({
    id: p.id,
    prestamista: p.prestamista,
    clasificacion: p.clasificacion,
    moneda: p.moneda,
    principal: p.principal.toString(),
    tipoCambio: p.tipoCambio.toString(),
    cuentaBancaria: p.cuentaBancaria,
    cuentaContable: p.cuentaContable,
    asiento: p.asiento
      ? {
          id: p.asiento.id,
          numero: p.asiento.numero,
          estado: p.asiento.estado,
          fecha: p.asiento.fecha.toISOString(),
        }
      : null,
    saldoPendiente: (saldos.get(p.cuentaContableId) ?? "0").toString(),
    createdAt: p.createdAt.toISOString(),
  }));
}

// ============================================================
// Detalhe do empréstimo (para o Sheet)
// ============================================================

export type PrestamoLineaAsiento = {
  cuentaCodigo: string;
  cuentaNombre: string;
  debe: string;
  haber: string;
  descripcion: string | null;
};

export type PrestamoAmortizacion = {
  movimientoId: string;
  fecha: string;
  monto: string;
  moneda: Moneda;
  tipoCambio: string;
  cuentaBancaria: string;
  asientoNumero: number | null;
  asientoEstado: AsientoEstado | null;
  descripcion: string | null;
};

export type PrestamoDetalle = {
  id: string;
  prestamista: string;
  clasificacion: PrestamoClasificacion;
  moneda: Moneda;
  principal: string;
  tipoCambio: string;
  valorArs: string;
  cuentaBancaria: { banco: string; numero: string; moneda: Moneda };
  cuentaContable: { id: number; codigo: string; nombre: string };
  asiento: {
    id: string;
    numero: number;
    fecha: string;
    estado: AsientoEstado;
    lineas: PrestamoLineaAsiento[];
  } | null;
  amortizaciones: PrestamoAmortizacion[];
  saldoPendiente: string;
  createdAt: string;
};

export async function obtenerPrestamoDetalle(
  id: string,
): Promise<PrestamoDetalle | null> {
  const prestamo = await db.prestamoExterno.findUnique({
    where: { id },
    include: {
      cuentaBancaria: { select: { banco: true, numero: true, moneda: true } },
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
      asiento: {
        include: {
          lineas: {
            include: {
              cuenta: { select: { codigo: true, nombre: true } },
            },
            orderBy: { id: "asc" },
          },
        },
      },
    },
  });

  if (!prestamo) return null;

  const amortizaciones = await listarAmortizacionesPrestamo(
    prestamo.cuentaContableId,
  );

  const saldos = await calcularSaldosPrestamos([prestamo.cuentaContableId]);
  const saldo = saldos.get(prestamo.cuentaContableId) ?? "0";

  const valorArs = prestamo.principal.mul(prestamo.tipoCambio).toFixed(2);

  return {
    id: prestamo.id,
    prestamista: prestamo.prestamista,
    clasificacion: prestamo.clasificacion,
    moneda: prestamo.moneda,
    principal: prestamo.principal.toString(),
    tipoCambio: prestamo.tipoCambio.toString(),
    valorArs,
    cuentaBancaria: prestamo.cuentaBancaria,
    cuentaContable: prestamo.cuentaContable,
    asiento: prestamo.asiento
      ? {
          id: prestamo.asiento.id,
          numero: prestamo.asiento.numero,
          fecha: prestamo.asiento.fecha.toISOString(),
          estado: prestamo.asiento.estado,
          lineas: prestamo.asiento.lineas.map((l) => ({
            cuentaCodigo: l.cuenta.codigo,
            cuentaNombre: l.cuenta.nombre,
            debe: l.debe.toString(),
            haber: l.haber.toString(),
            descripcion: l.descripcion,
          })),
        }
      : null,
    amortizaciones: amortizaciones.map((m) => ({
      movimientoId: m.movimientoId,
      fecha: m.fecha.toISOString(),
      monto: m.monto.toString(),
      moneda: m.moneda,
      tipoCambio: m.tipoCambio.toString(),
      cuentaBancaria: `${m.cuentaBancaria.banco} · ${m.cuentaBancaria.numero}`,
      asientoNumero: m.asiento?.numero ?? null,
      asientoEstado: m.asiento?.estado ?? null,
      descripcion: m.descripcion,
    })),
    saldoPendiente: saldo.toString(),
    createdAt: prestamo.createdAt.toISOString(),
  };
}

// ============================================================
// Contexto para pago/amortización
// ============================================================

export type ContextoAmortizacion = {
  prestamo: {
    id: string;
    prestamista: string;
    moneda: Moneda;
    principal: string;
    valorArs: string;
    asientoEstado: AsientoEstado | null;
  };
  cuentaPrestamo: { id: number; codigo: string; nombre: string };
  cuentaIntereses: { id: number; codigo: string; nombre: string } | null;
  saldoPendiente: string;
};

const CODIGO_INTERESES_PAGADOS = "5.8.2.02";

export async function obtenerContextoAmortizacion(
  prestamoId: string,
): Promise<ContextoAmortizacion | null> {
  const prestamo = await db.prestamoExterno.findUnique({
    where: { id: prestamoId },
    select: {
      id: true,
      prestamista: true,
      moneda: true,
      principal: true,
      tipoCambio: true,
      cuentaContableId: true,
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
      asiento: { select: { estado: true } },
    },
  });

  if (!prestamo) return null;

  const [cuentaIntereses, saldo] = await Promise.all([
    db.cuentaContable.findFirst({
      where: {
        codigo: CODIGO_INTERESES_PAGADOS,
        activa: true,
        tipo: CuentaTipo.ANALITICA,
      },
      select: { id: true, codigo: true, nombre: true },
    }),
    calcularSaldoPrestamo(prestamo.cuentaContableId),
  ]);

  const valorArs = prestamo.principal.mul(prestamo.tipoCambio).toFixed(2);

  return {
    prestamo: {
      id: prestamo.id,
      prestamista: prestamo.prestamista,
      moneda: prestamo.moneda,
      principal: prestamo.principal.toFixed(2),
      valorArs,
      asientoEstado: prestamo.asiento?.estado ?? null,
    },
    cuentaPrestamo: prestamo.cuentaContable,
    cuentaIntereses,
    saldoPendiente: saldo.toFixed(2),
  };
}

// ============================================================
// Criação
// ============================================================

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const crearPrestamoSchema = z
  .object({
    prestamista: z.string().trim().min(1, "Prestamista requerido").max(150),
    cuentaBancariaId: z.string().uuid(),
    fecha: z.coerce.date(),
    principal: z.string().regex(MONEY_RE, "Principal inválido (máx. 2 decimales)"),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z
      .string()
      .regex(FX_RE, "Tipo de cambio inválido (máx. 6 decimales)"),
    clasificacion: z.nativeEnum(PrestamoClasificacion),
    /** Si null/omitido, el sistema crea automáticamente la cuenta de pasivo */
    cuentaContableId: z.number().int().positive().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (Number(data.principal) <= 0) {
      ctx.addIssue({
        path: ["principal"],
        code: "custom",
        message: "El principal debe ser mayor a 0",
      });
    }
    if (data.moneda === Moneda.ARS && Number(data.tipoCambio) !== 1) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: "custom",
        message: "Para ARS el tipo de cambio debe ser 1",
      });
    }
    if (data.moneda === Moneda.USD && Number(data.tipoCambio) <= 0) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: "custom",
        message: "El tipo de cambio debe ser mayor a 0",
      });
    }
  });

export type CrearPrestamoInput = z.input<typeof crearPrestamoSchema>;

export type CrearPrestamoResult =
  | {
      ok: true;
      prestamoId: string;
      asientoId: string;
      asientoNumero: number;
    }
  | { ok: false; error: string };

export async function crearPrestamoAction(
  raw: CrearPrestamoInput,
): Promise<CrearPrestamoResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = crearPrestamoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const {
    prestamista,
    cuentaBancariaId,
    fecha,
    principal,
    moneda,
    tipoCambio,
    clasificacion,
    cuentaContableId: cuentaContableIdProvisto,
  } = parsed.data;

  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: cuentaBancariaId },
    select: { id: true, moneda: true, cuentaContableId: true },
  });

  if (!cuentaBancaria) {
    return { ok: false, error: "La cuenta bancaria seleccionada no existe." };
  }

  // Si se pasó una cuenta existente, validarla. Si no, se auto-creará.
  if (cuentaContableIdProvisto != null) {
    if (cuentaBancaria.cuentaContableId === cuentaContableIdProvisto) {
      return {
        ok: false,
        error: "La cuenta del préstamo no puede ser la misma cuenta del banco.",
      };
    }

    const cuentaContable = await db.cuentaContable.findUnique({
      where: { id: cuentaContableIdProvisto },
      select: {
        id: true,
        codigo: true,
        tipo: true,
        categoria: true,
        activa: true,
      },
    });

    if (!cuentaContable) {
      return { ok: false, error: "La cuenta contable no existe." };
    }
    if (!cuentaContable.activa) {
      return {
        ok: false,
        error: `La cuenta ${cuentaContable.codigo} está inactiva.`,
      };
    }
    if (cuentaContable.tipo !== CuentaTipo.ANALITICA) {
      return {
        ok: false,
        error: "La cuenta del préstamo debe ser ANALITICA.",
      };
    }
    if (cuentaContable.categoria !== CuentaCategoria.PASIVO) {
      return {
        ok: false,
        error: "La cuenta del préstamo debe ser de categoría PASIVO.",
      };
    }
    const expectedPrefix = CLASIFICACION_PREFIX[clasificacion];
    if (!cuentaContable.codigo.startsWith(expectedPrefix)) {
      return {
        ok: false,
        error: `Para clasificación ${clasificacion} la cuenta debe comenzar con ${expectedPrefix}`,
      };
    }

    const enUso = await db.prestamoExterno.findFirst({
      where: {
        cuentaContableId: cuentaContableIdProvisto,
        OR: [
          { asiento: { estado: { not: AsientoEstado.ANULADO } } },
          { asientoId: null },
        ],
      },
      select: { id: true },
    });
    if (enUso) {
      return {
        ok: false,
        error:
          "Esta cuenta contable ya está asignada a otro préstamo activo. Seleccione otra o anule el préstamo existente.",
      };
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let cuentaContableId = cuentaContableIdProvisto ?? null;
      if (cuentaContableId === null) {
        const rango =
          clasificacion === PrestamoClasificacion.CORTO_PLAZO
            ? "PRESTAMO_CP"
            : "PRESTAMO_LP";
        const nombre = `PRÉSTAMO ${prestamista.toUpperCase()} ${moneda}`;
        const cuenta = await crearCuentaParaEntidad(tx, rango, nombre);
        cuentaContableId = cuenta.id;
      }

      const prestamo = await tx.prestamoExterno.create({
        data: {
          prestamista,
          cuentaBancariaId,
          moneda,
          principal,
          tipoCambio,
          clasificacion,
          cuentaContableId,
        },
        select: { id: true },
      });

      const asiento = await crearAsientoPrestamo(prestamo.id, fecha, tx);
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      return {
        prestamoId: prestamo.id,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
      };
    });

    revalidatePath("/tesoreria/prestamos");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("crearPrestamoAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al registrar el préstamo.",
    };
  }
}

// ============================================================
// Anulación
// ============================================================

export type AnularPrestamoResult =
  | { ok: true }
  | { ok: false; error: string };

export async function anularPrestamoAction(
  prestamoId: string,
): Promise<AnularPrestamoResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  try {
    await db.$transaction(async (tx) => {
      const prestamo = await tx.prestamoExterno.findUnique({
        where: { id: prestamoId },
        select: { id: true, asientoId: true, cuentaContableId: true },
      });

      if (!prestamo) {
        throw new AsientoError("DOMINIO_INVALIDO", "El préstamo no existe.");
      }
      if (!prestamo.asientoId) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          "El préstamo no tiene asiento asociado; nada para anular.",
        );
      }

      const amortCount = await contarAmortizacionesContabilizadasPrestamo(
        prestamo.cuentaContableId,
        tx,
      );
      if (amortCount > 0) {
        throw new AsientoError(
          "ESTADO_INVALIDO",
          `No se puede anular: existen ${amortCount} amortización(es) contabilizada(s). Anúlelas primero.`,
        );
      }

      await anularAsiento(prestamo.asientoId, tx);
    });

    revalidatePath("/tesoreria/prestamos");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/contabilidad/asientos");

    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("anularPrestamoAction failed", err);
    return { ok: false, error: "Error inesperado al anular el préstamo." };
  }
}

// ============================================================
// Error mapping
// ============================================================

function mapAsientoErrorMessage(err: AsientoError): string {
  switch (err.code) {
    case "DESBALANCEADO":
      return "El asiento está desbalanceado: la suma del Debe no coincide con el Haber.";
    case "LINEA_INVALIDA":
      return err.message;
    case "CUENTA_INVALIDA":
      return "Una de las cuentas seleccionadas no existe.";
    case "CUENTA_INACTIVA":
      return "Una de las cuentas seleccionadas está inactiva.";
    case "CUENTA_SINTETICA":
      return "No se pueden usar cuentas sintéticas. Seleccione una cuenta analítica.";
    case "PERIODO_INEXISTENTE":
      return "No hay período contable que contenga esa fecha.";
    case "PERIODO_CERRADO":
      return "El período contable está cerrado.";
    case "ASIENTO_INEXISTENTE":
      return "El asiento no existe.";
    case "ESTADO_INVALIDO":
      return err.message;
    case "NUMERACION_FALHOU":
      return "No se pudo asignar número secuencial. Reintente.";
    default:
      return err.message;
  }
}
