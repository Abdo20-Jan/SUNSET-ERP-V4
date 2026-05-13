"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  anularAsiento,
  cambiarFechaAsientoEnTx,
  contabilizarAsiento,
  crearAsientoManual,
  moverAsientoDePeriodoEnTx,
  withNumeracionRetry,
} from "@/lib/services/asiento-automatico";
import { AsientoOrigen, Moneda, Prisma } from "@/generated/prisma/client";

const inputSchema = z.object({
  fecha: z.coerce.date(),
  descripcion: z.string().min(1),
  moneda: z.nativeEnum(Moneda),
  tipoCambio: z.string().min(1),
  lineas: z
    .array(
      z.object({
        cuentaId: z.number().int().positive(),
        debe: z.string(),
        haber: z.string(),
        referencia: z.string().optional(),
      }),
    )
    .min(2),
});

export type CrearAsientoManualInput = z.input<typeof inputSchema>;

export type CrearAsientoActionResult =
  | { ok: true; asientoId: string; numero: number }
  | { ok: false; error: string };

export type AsientoStateActionResult = { ok: true; numero: number } | { ok: false; error: string };

export async function crearAsientoManualAction(
  raw: CrearAsientoManualInput,
): Promise<CrearAsientoActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    const asiento = await crearAsientoManual({
      fecha: parsed.data.fecha,
      descripcion: parsed.data.descripcion,
      origen: AsientoOrigen.MANUAL,
      moneda: parsed.data.moneda,
      tipoCambio: parsed.data.tipoCambio,
      lineas: parsed.data.lineas.map((l) => ({
        cuentaId: l.cuentaId,
        debe: l.debe,
        haber: l.haber,
        descripcion: l.referencia,
      })),
    });

    revalidatePath("/contabilidad/asientos");

    return {
      ok: true,
      asientoId: asiento.id,
      numero: asiento.numero,
    };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("crearAsientoManualAction failed", err);
    return { ok: false, error: "Error inesperado al crear el asiento." };
  }
}

export async function contabilizarAsientoAction(
  asientoId: string,
): Promise<AsientoStateActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  try {
    const asiento = await contabilizarAsiento(asientoId);
    revalidatePath("/contabilidad/asientos");
    revalidatePath("/tesoreria/movimientos");
    return { ok: true, numero: asiento.numero };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("contabilizarAsientoAction failed", err);
    return { ok: false, error: "Error inesperado al contabilizar el asiento." };
  }
}

export async function anularAsientoAction(asientoId: string): Promise<AsientoStateActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  try {
    const asiento = await anularAsiento(asientoId);
    revalidatePath("/contabilidad/asientos");
    revalidatePath("/tesoreria/movimientos");
    return { ok: true, numero: asiento.numero };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("anularAsientoAction failed", err);
    return { ok: false, error: "Error inesperado al anular el asiento." };
  }
}

export type AsientoLineaDetalle = {
  id: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  debe: string;
  haber: string;
  descripcion: string | null;
};

export type AsientoDetalle = {
  id: string;
  numero: number;
  fecha: Date;
  descripcion: string;
  estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO";
  origen: "MANUAL" | "TESORERIA" | "COMEX" | "AJUSTE" | "GASTO";
  moneda: "ARS" | "USD";
  tipoCambio: string;
  totalDebe: string;
  totalHaber: string;
  periodoCodigo: string;
  lineas: AsientoLineaDetalle[];
};

export type GetAsientoDetalleResult =
  | { ok: true; detalle: AsientoDetalle }
  | { ok: false; error: string };

export async function getAsientoDetalle(asientoId: string): Promise<GetAsientoDetalleResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const asiento = await db.asiento.findUnique({
    where: { id: asientoId },
    select: {
      id: true,
      numero: true,
      fecha: true,
      descripcion: true,
      estado: true,
      origen: true,
      moneda: true,
      tipoCambio: true,
      totalDebe: true,
      totalHaber: true,
      periodo: { select: { codigo: true } },
      lineas: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          debe: true,
          haber: true,
          descripcion: true,
          cuenta: { select: { codigo: true, nombre: true } },
        },
      },
    },
  });

  if (!asiento) {
    return { ok: false, error: "Asiento inexistente." };
  }

  return {
    ok: true,
    detalle: {
      id: asiento.id,
      numero: asiento.numero,
      fecha: asiento.fecha,
      descripcion: asiento.descripcion,
      estado: asiento.estado,
      origen: asiento.origen,
      moneda: asiento.moneda,
      tipoCambio: asiento.tipoCambio.toString(),
      totalDebe: asiento.totalDebe.toFixed(2),
      totalHaber: asiento.totalHaber.toFixed(2),
      periodoCodigo: asiento.periodo.codigo,
      lineas: asiento.lineas.map((l) => ({
        id: l.id,
        cuentaCodigo: l.cuenta.codigo,
        cuentaNombre: l.cuenta.nombre,
        debe: l.debe.toFixed(2),
        haber: l.haber.toFixed(2),
        descripcion: l.descripcion,
      })),
    },
  };
}

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
    case "ASIENTO_ANULADO":
      return "Un asiento anulado no se puede mover.";
    case "PERIODO_ORIGEN_CERRADO":
      return "El período origen está cerrado. Reabrilo antes de mover.";
    case "PERIODO_DESTINO_CERRADO":
      return "El período destino está cerrado. Reabrilo antes de mover.";
    case "PERIODO_DESTINO_INEXISTENTE":
      return "El período destino no existe.";
    case "MISMO_PERIODO":
      return "El asiento ya está en ese período.";
    default:
      return err.message;
  }
}

const moverInputSchema = z.object({
  asientoIds: z.array(z.string().uuid()).min(1).max(500),
  periodoDestinoId: z.number().int().positive(),
});

export type MoverAsientosInput = z.input<typeof moverInputSchema>;

export type MoverAsientoResultItem = {
  asientoId: string;
  ok: boolean;
  numeroAnterior?: number;
  numeroNuevo?: number;
  error?: string;
};

export type MoverAsientosResult =
  | { ok: true; resultados: MoverAsientoResultItem[] }
  | { ok: false; error: string };

export async function moverAsientosDePeriodoAction(
  raw: MoverAsientosInput,
): Promise<MoverAsientosResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = moverInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const { asientoIds, periodoDestinoId } = parsed.data;

  const resultados: MoverAsientoResultItem[] = [];
  for (const asientoId of asientoIds) {
    try {
      const r = await withNumeracionRetry(() =>
        db.$transaction((tx) => moverAsientoDePeriodoEnTx(tx, asientoId, periodoDestinoId)),
      );
      resultados.push({
        asientoId,
        ok: true,
        numeroAnterior: r.numeroAnterior,
        numeroNuevo: r.numeroNuevo,
      });
    } catch (err) {
      if (err instanceof AsientoError) {
        resultados.push({ asientoId, ok: false, error: mapAsientoErrorMessage(err) });
      } else {
        console.error("moverAsientosDePeriodoAction failed", err);
        resultados.push({ asientoId, ok: false, error: "Error inesperado al mover el asiento." });
      }
    }
  }

  revalidatePathsMoverPeriodo();

  return { ok: true, resultados };
}

function revalidatePathsMoverPeriodo() {
  revalidatePath("/contabilidad/asientos");
  revalidatePath("/contabilidad/asientos/mover-periodo");
  revalidatePath("/contabilidad/periodos");
  revalidatePath("/reportes/libro-diario");
  revalidatePath("/reportes/libro-mayor");
  revalidatePath("/dashboard");
}

const cambiarFechaInputSchema = z.object({
  asientoIds: z.array(z.string().uuid()).min(1).max(500),
  nuevaFecha: z.coerce.date(),
});

export type CambiarFechaInput = z.input<typeof cambiarFechaInputSchema>;

export type CambiarFechaResultItem = {
  asientoId: string;
  ok: boolean;
  fechaNueva?: string;
  periodoNuevoId?: number;
  numeroNuevo?: number;
  error?: string;
};

export type CambiarFechaResult =
  | { ok: true; resultados: CambiarFechaResultItem[] }
  | { ok: false; error: string };

export async function cambiarFechaAsientosAction(
  raw: CambiarFechaInput,
): Promise<CambiarFechaResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = cambiarFechaInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const { asientoIds, nuevaFecha } = parsed.data;

  const resultados: CambiarFechaResultItem[] = [];
  for (const asientoId of asientoIds) {
    try {
      const r = await withNumeracionRetry(() =>
        db.$transaction((tx) => cambiarFechaAsientoEnTx(tx, asientoId, nuevaFecha)),
      );
      resultados.push({
        asientoId,
        ok: true,
        fechaNueva: r.fechaNueva.toISOString(),
        periodoNuevoId: r.periodoNuevoId,
        numeroNuevo: r.numeroNuevo,
      });
    } catch (err) {
      if (err instanceof AsientoError) {
        resultados.push({ asientoId, ok: false, error: mapAsientoErrorMessage(err) });
      } else {
        console.error("cambiarFechaAsientosAction failed", err);
        resultados.push({
          asientoId,
          ok: false,
          error: "Error inesperado al cambiar la fecha.",
        });
      }
    }
  }

  revalidatePathsMoverPeriodo();
  return { ok: true, resultados };
}

const autoCorrigirInputSchema = z.object({
  asientoIds: z.array(z.string().uuid()).min(1).max(500),
});

export type AutoCorrigirFechaInput = z.input<typeof autoCorrigirInputSchema>;

export type AutoCorrigirFechaResultItem = {
  asientoId: string;
  ok: boolean;
  fuente?: string;
  fechaAnterior?: string;
  fechaNueva?: string;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
};

export type AutoCorrigirFechaResult =
  | { ok: true; resultados: AutoCorrigirFechaResultItem[] }
  | { ok: false; error: string };

const FUENTE_SELECT = {
  id: true,
  fecha: true,
  movimiento: { select: { fecha: true } },
  compra: { select: { fecha: true } },
  venta: { select: { fecha: true } },
  gasto: { select: { fecha: true } },
  embarqueCosto: { select: { fechaFactura: true } },
  despacho: { select: { fecha: true } },
  entregaVenta: { select: { fecha: true } },
  gastoFijoRegistro: { select: { fecha: true } },
  chequeRecibidoCobro: { select: { fechaPago: true } },
} satisfies Prisma.AsientoSelect;

type AsientoConFuente = Prisma.AsientoGetPayload<{ select: typeof FUENTE_SELECT }>;

function resolverFuenteFecha(a: AsientoConFuente): { fuente: string; fecha: Date } | null {
  if (a.movimiento) return { fuente: "movimiento", fecha: a.movimiento.fecha };
  if (a.compra) return { fuente: "compra", fecha: a.compra.fecha };
  if (a.venta) return { fuente: "venta", fecha: a.venta.fecha };
  if (a.gasto) return { fuente: "gasto", fecha: a.gasto.fecha };
  if (a.embarqueCosto?.fechaFactura)
    return { fuente: "embarqueCosto", fecha: a.embarqueCosto.fechaFactura };
  if (a.despacho) return { fuente: "despacho", fecha: a.despacho.fecha };
  if (a.entregaVenta) return { fuente: "entregaVenta", fecha: a.entregaVenta.fecha };
  if (a.gastoFijoRegistro) return { fuente: "gastoFijoRegistro", fecha: a.gastoFijoRegistro.fecha };
  if (a.chequeRecibidoCobro)
    return { fuente: "chequeRecibidoCobro", fecha: a.chequeRecibidoCobro.fechaPago };
  return null;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export async function autoCorrigirFechaAsientosAction(
  raw: AutoCorrigirFechaInput,
): Promise<AutoCorrigirFechaResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = autoCorrigirInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const { asientoIds } = parsed.data;

  const resultados: AutoCorrigirFechaResultItem[] = [];
  for (const asientoId of asientoIds) {
    try {
      const asiento = await db.asiento.findUnique({
        where: { id: asientoId },
        select: FUENTE_SELECT,
      });
      if (!asiento) {
        resultados.push({ asientoId, ok: false, error: "Asiento inexistente." });
        continue;
      }
      const fuente = resolverFuenteFecha(asiento);
      if (!fuente) {
        resultados.push({
          asientoId,
          ok: true,
          skipped: true,
          skipReason: "Sin fuente para autocorrección (origen MANUAL/AJUSTE o préstamo/embarque).",
        });
        continue;
      }
      if (sameDay(asiento.fecha, fuente.fecha)) {
        resultados.push({
          asientoId,
          ok: true,
          skipped: true,
          skipReason: "Fecha ya coincide con la fuente.",
          fuente: fuente.fuente,
          fechaAnterior: asiento.fecha.toISOString(),
          fechaNueva: fuente.fecha.toISOString(),
        });
        continue;
      }
      const r = await withNumeracionRetry(() =>
        db.$transaction((tx) => cambiarFechaAsientoEnTx(tx, asientoId, fuente.fecha)),
      );
      resultados.push({
        asientoId,
        ok: true,
        fuente: fuente.fuente,
        fechaAnterior: r.fechaAnterior.toISOString(),
        fechaNueva: r.fechaNueva.toISOString(),
      });
    } catch (err) {
      if (err instanceof AsientoError) {
        resultados.push({ asientoId, ok: false, error: mapAsientoErrorMessage(err) });
      } else {
        console.error("autoCorrigirFechaAsientosAction failed", err);
        resultados.push({
          asientoId,
          ok: false,
          error: "Error inesperado al autocorregir la fecha.",
        });
      }
    }
  }

  revalidatePathsMoverPeriodo();
  return { ok: true, resultados };
}
