"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  parsearExtractoPDF,
  SONNET_MODEL,
  type LineaParseada,
} from "@/lib/services/extracto-parser";
import { getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import {
  CuentaCategoria,
  ImportacionExtractoStatus,
  LineaExtractoStatus,
} from "@/generated/prisma/client";

const SUGGESTED_CUENTA_DEFAULTS: Record<
  string,
  { nombre: string; categoria: CuentaCategoria }
> = {
  "5.8.1.01": { nombre: "COMISIONES BANCARIAS", categoria: CuentaCategoria.EGRESO },
  "5.8.1.04": { nombre: "IMPUESTO DE SELLOS", categoria: CuentaCategoria.EGRESO },
  "5.8.1.06": { nombre: "IMPUESTO LEY 25413 (DEB/CRED BANCARIOS)", categoria: CuentaCategoria.EGRESO },
  "5.8.2.02": { nombre: "INTERESES PAGADOS", categoria: CuentaCategoria.EGRESO },
  "1.1.4.01": { nombre: "IVA CRÉDITO FISCAL", categoria: CuentaCategoria.ACTIVO },
  "1.1.4.02": { nombre: "PERCEPCIÓN IVA RG 2408 (BANCARIA)", categoria: CuentaCategoria.ACTIVO },
  "1.1.4.10": { nombre: "PERCEPCIÓN IIBB SIRCREB", categoria: CuentaCategoria.ACTIVO },
  "1.1.6.01": { nombre: "INVERSIONES EN FONDOS COMUNES", categoria: CuentaCategoria.ACTIVO },
};

function normalizarCuit(raw: string | null): string | null {
  if (!raw) return null;
  const onlyDigits = raw.replace(/\D/g, "");
  return onlyDigits.length === 11 ? onlyDigits : null;
}

function formatCuit(digits: string): string {
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

const importarSchema = z.object({
  // Opcional — si se omite, el sistema lo detecta del PDF (CBU/numero)
  cuentaBancariaId: z.string().uuid().nullable().optional(),
  archivoNombre: z.string().min(1).max(255),
  pdfBase64: z.string().min(100),
});

export type ImportarExtractoInput = z.input<typeof importarSchema>;

export type ImportarExtractoResult =
  | {
      ok: true;
      importacionId: string;
      totalLineas: number;
      bancoDetectado: string;
      periodoDetectado: string;
    }
  | { ok: false; error: string };

function normalizarCBU(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 22 ? digits : null;
}

function normalizarNumero(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^\dA-Za-z]/g, "").toLowerCase();
}

function detectarPeriodoFromLineas(
  lineas: Array<{ fecha: string }>,
): { year: number; month: number } | null {
  if (lineas.length === 0) return null;
  // Usamos la fecha más reciente (saldo final del mes)
  const fechas = lineas.map((l) => new Date(l.fecha + "T12:00:00Z"));
  const last = fechas.reduce((a, b) => (a > b ? a : b));
  return {
    year: last.getUTCFullYear(),
    month: last.getUTCMonth() + 1,
  };
}

export async function importarExtractoAction(
  raw: ImportarExtractoInput,
): Promise<ImportarExtractoResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = importarSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { cuentaBancariaId: cuentaIdInput, archivoNombre, pdfBase64 } = parsed.data;

  type CuentaInfo = {
    id: string;
    banco: string;
    moneda: "ARS" | "USD";
    numero: string | null;
    cbu: string | null;
  };

  // Si el user pre-seleccionó cuenta, usamos su moneda y banco como hint.
  // Si no, parseamos con ARS por default y detectamos cuenta por CBU/numero.
  let cuentaPre: CuentaInfo | null = null;
  if (cuentaIdInput) {
    const found = await db.cuentaBancaria.findUnique({
      where: { id: cuentaIdInput },
      select: { id: true, banco: true, moneda: true, numero: true, cbu: true },
    });
    if (!found) {
      return { ok: false, error: "La cuenta bancaria no existe." };
    }
    cuentaPre = found as CuentaInfo;
  }

  let parseado: Awaited<ReturnType<typeof parsearExtractoPDF>>;
  try {
    parseado = await parsearExtractoPDF({
      pdfBase64,
      banco: cuentaPre?.banco ?? null,
      moneda: cuentaPre?.moneda ?? "ARS",
    });
  } catch (err) {
    console.error("[extractos] parser failed", err);
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: `Falló el parseo del PDF: ${msg}` };
  }

  // Resolver la cuenta final: pre-seleccionada o auto-detectada
  let cuentaBancaria: CuentaInfo;

  if (cuentaPre) {
    // Validar banco parseado vs banco de la cuenta seleccionada
    const bancoParseadoNorm = parseado.banco.toLowerCase().replace(/\s+/g, "");
    const bancoCuentaNorm = cuentaPre.banco.toLowerCase().replace(/\s+/g, "");
    if (
      bancoParseadoNorm.length > 0 &&
      !bancoParseadoNorm.includes(bancoCuentaNorm) &&
      !bancoCuentaNorm.includes(bancoParseadoNorm)
    ) {
      return {
        ok: false,
        error: `El PDF parece ser de "${parseado.banco}" pero la cuenta seleccionada es "${cuentaPre.banco}". Cambiá la cuenta o subí el PDF correcto.`,
      };
    }
    cuentaBancaria = cuentaPre;
  } else {
    const cbuPdf = normalizarCBU(parseado.cbu);
    const numPdf = normalizarNumero(parseado.numeroCuenta);

    const todasRaw = await db.cuentaBancaria.findMany({
      select: { id: true, banco: true, moneda: true, numero: true, cbu: true },
    });
    const todas = todasRaw as CuentaInfo[];

    const matches = todas.filter((c) => {
      const cbuMatch =
        cbuPdf !== null && normalizarCBU(c.cbu) === cbuPdf;
      const numNorm = normalizarNumero(c.numero);
      const numMatch =
        numPdf.length > 0 &&
        numNorm.length > 0 &&
        (numNorm.includes(numPdf) || numPdf.includes(numNorm));
      return cbuMatch || numMatch;
    });

    if (matches.length === 1) {
      cuentaBancaria = matches[0];
    } else if (matches.length > 1) {
      return {
        ok: false,
        error: `El PDF coincide con ${matches.length} cuentas — seleccioná manualmente cuál.`,
      };
    } else {
      return {
        ok: false,
        error: `No se pudo identificar la cuenta bancaria del PDF (banco: "${parseado.banco}", CBU: ${parseado.cbu ?? "?"}, nº: ${parseado.numeroCuenta ?? "?"}). Seleccionala manualmente o creala primero en Tesorería.`,
      };
    }
  }

  // Auto-detectar período del PDF
  const periodo = detectarPeriodoFromLineas(parseado.lineas);
  if (!periodo) {
    return {
      ok: false,
      error: "No se detectaron movimientos en el PDF — no se puede inferir el período.",
    };
  }
  const periodoYear = periodo.year;
  const periodoMonth = periodo.month;

  const existente = await db.importacionExtracto.findUnique({
    where: {
      cuentaBancariaId_periodoYear_periodoMonth: {
        cuentaBancariaId: cuentaBancaria.id,
        periodoYear,
        periodoMonth,
      },
    },
    select: { id: true, status: true },
  });
  if (existente) {
    return {
      ok: false,
      error: `Ya existe una importación para ${cuentaBancaria.banco} ${String(periodoMonth).padStart(2, "0")}/${periodoYear} (estado: ${existente.status}). Eliminala antes de re-importar.`,
    };
  }

  const cuits = Array.from(
    new Set(
      parseado.lineas
        .map((l) => normalizarCuit(l.cuitDetectado))
        .filter((c): c is string => c !== null),
    ),
  );

  const codigosCuenta = Array.from(
    new Set(
      parseado.lineas
        .map((l) => l.codigoCuentaSugerida)
        .filter((c): c is string => c !== null && c.trim().length > 0),
    ),
  );

  const cuitVariants = cuits.flatMap((c) => [c, formatCuit(c)]);
  const [proveedores, clientes] = await Promise.all([
    cuitVariants.length > 0
      ? db.proveedor.findMany({
          where: { cuit: { in: cuitVariants } },
          select: { id: true, cuit: true, nombre: true, cuentaContableId: true },
        })
      : Promise.resolve([] as Array<{ id: string; cuit: string | null; nombre: string; cuentaContableId: number | null }>),
    cuitVariants.length > 0
      ? db.cliente.findMany({
          where: { cuit: { in: cuitVariants } },
          select: { id: true, cuit: true, nombre: true, cuentaContableId: true },
        })
      : Promise.resolve([] as Array<{ id: string; cuit: string | null; nombre: string; cuentaContableId: number | null }>),
  ]);

  const provByCuit = new Map<string, (typeof proveedores)[number]>();
  proveedores.forEach((p) => {
    const c = normalizarCuit(p.cuit);
    if (c) provByCuit.set(c, p);
  });
  const cliByCuit = new Map<string, (typeof clientes)[number]>();
  clientes.forEach((c) => {
    const norm = normalizarCuit(c.cuit);
    if (norm) cliByCuit.set(norm, c);
  });

  try {
    const result = await db.$transaction(
      async (tx) => {
        const cuentaIdByCodigo = new Map<string, number>();
        for (const codigo of codigosCuenta) {
          const def = SUGGESTED_CUENTA_DEFAULTS[codigo];
          if (def) {
            const id = await getOrCreateCuenta(tx, {
              codigo,
              nombre: def.nombre,
              categoria: def.categoria,
            });
            cuentaIdByCodigo.set(codigo, id);
          } else {
            const found = await tx.cuentaContable.findUnique({
              where: { codigo },
              select: { id: true },
            });
            if (found) cuentaIdByCodigo.set(codigo, found.id);
          }
        }

        const importacion = await tx.importacionExtracto.create({
          data: {
            cuentaBancariaId: cuentaBancaria.id,
            periodoYear,
            periodoMonth,
            saldoInicial: parseado.saldoInicial.toFixed(2),
            saldoFinal: parseado.saldoFinal.toFixed(2),
            archivoNombre,
            status: ImportacionExtractoStatus.PENDIENTE,
            totalLineas: parseado.lineas.length,
            modeloIA: SONNET_MODEL,
          },
          select: { id: true },
        });

        for (let i = 0; i < parseado.lineas.length; i++) {
          const l = parseado.lineas[i];
          const cuit = normalizarCuit(l.cuitDetectado);
          const proveedor = cuit ? provByCuit.get(cuit) : null;
          const cliente = cuit ? cliByCuit.get(cuit) : null;

          const cuentaSugeridaId = l.codigoCuentaSugerida
            ? (cuentaIdByCodigo.get(l.codigoCuentaSugerida) ?? null)
            : null;

          await tx.lineaExtractoSugerencia.create({
            data: {
              importacionId: importacion.id,
              ordenLinea: i + 1,
              fecha: new Date(l.fecha + "T12:00:00Z"),
              descripcion: l.descripcion.slice(0, 500),
              comprobante: l.comprobante,
              monto: l.monto.toFixed(2),
              saldoExtracto: l.saldoExtracto !== null ? l.saldoExtracto.toFixed(2) : null,
              cuentaSugeridaId,
              proveedorSugeridoId: proveedor?.id ?? null,
              clienteSugeridoId: cliente?.id ?? null,
              descripcionAsiento: l.descripcionAsiento,
              confianza: l.confianza,
              razonSugerencia: buildRazon(l, proveedor, cliente, cuit),
              status: LineaExtractoStatus.PENDIENTE,
            },
          });
        }

        return { importacionId: importacion.id, totalLineas: parseado.lineas.length };
      },
      { timeout: 60_000 },
    );

    revalidatePath("/tesoreria/extractos");
    return {
      ok: true,
      ...result,
      bancoDetectado: cuentaBancaria.banco,
      periodoDetectado: `${String(periodoMonth).padStart(2, "0")}/${periodoYear}`,
    };
  } catch (err) {
    console.error("[extractos] importarExtractoAction failed", err);
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: `Error guardando la importación: ${msg}` };
  }
}

function buildRazon(
  l: LineaParseada,
  proveedor: { nombre: string } | null | undefined,
  cliente: { nombre: string } | null | undefined,
  cuitDetectado: string | null,
): string | null {
  const parts: string[] = [];
  if (l.razon) parts.push(l.razon);
  if (cuitDetectado && !proveedor && !cliente) {
    parts.push(
      `CUIT ${formatCuit(cuitDetectado)} no matchea ningún proveedor/cliente — crear o asociar.`,
    );
  }
  if (proveedor) parts.push(`Match proveedor: ${proveedor.nombre}.`);
  if (cliente) parts.push(`Match cliente: ${cliente.nombre}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}
