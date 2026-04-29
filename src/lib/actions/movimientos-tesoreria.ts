"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoManual,
  crearAsientoMovimientoTesoreria,
  crearAsientoTransferencia,
  type LineaInput,
} from "@/lib/services/asiento-automatico";
import { validarSaldoSuficientePrestamo } from "@/lib/services/prestamo";
import {
  AsientoOrigen,
  CuentaTipo,
  Moneda,
  MovimientoTesoreriaTipo,
} from "@/generated/prisma/client";

export type CuentaBancariaOption = {
  id: string;
  banco: string;
  moneda: Moneda;
  numero: string | null;
  cuentaContableId: number;
  cuentaContableCodigo: string;
  cuentaContableNombre: string;
};

export type CuentaContableContrapartidaOption = {
  id: number;
  codigo: string;
  nombre: string;
  categoria: "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO";
};

export async function listarCuentasBancariasParaMovimiento(): Promise<
  CuentaBancariaOption[]
> {
  const cuentas = await db.cuentaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    select: {
      id: true,
      banco: true,
      moneda: true,
      numero: true,
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
    },
  });

  return cuentas.map((c) => ({
    id: c.id,
    banco: c.banco,
    moneda: c.moneda,
    numero: c.numero,
    cuentaContableId: c.cuentaContable.id,
    cuentaContableCodigo: c.cuentaContable.codigo,
    cuentaContableNombre: c.cuentaContable.nombre,
  }));
}

export async function listarCuentasContablesParaContrapartida(): Promise<
  CuentaContableContrapartidaOption[]
> {
  const [cuentas, bancarias] = await Promise.all([
    db.cuentaContable.findMany({
      where: {
        tipo: CuentaTipo.ANALITICA,
        activa: true,
      },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true, categoria: true },
    }),
    db.cuentaBancaria.findMany({ select: { cuentaContableId: true } }),
  ]);

  const bancariasIds = new Set(bancarias.map((b) => b.cuentaContableId));
  return cuentas
    .filter((c) => !bancariasIds.has(c.id))
    .map((c) => ({
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      categoria: c.categoria,
    }));
}

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const lineaContrapartidaSchema = z.object({
  cuentaContableId: z.number().int().positive(),
  monto: z.string().regex(MONEY_RE, "Monto inválido (máx. 2 decimales)"),
  descripcion: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const crearMovimientoSchema = z
  .object({
    tipo: z.enum([MovimientoTesoreriaTipo.COBRO, MovimientoTesoreriaTipo.PAGO]),
    cuentaBancariaId: z.string().uuid(),
    fecha: z.coerce.date(),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z
      .string()
      .regex(FX_RE, "Tipo de cambio inválido (máx. 6 decimales)"),
    // 1+ contrapartidas. El total del movimiento bancario es la suma
    // de sus montos. Para casos simples (1 sola contrapartida) se
    // mantiene el comportamiento clásico (incluyendo split IDCB 33/67%).
    lineas: z
      .array(lineaContrapartidaSchema)
      .min(1, "Agregue al menos una línea de contrapartida"),
    descripcion: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    comprobante: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    referenciaBanco: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((data, ctx) => {
    let total = new Decimal(0);
    for (let i = 0; i < data.lineas.length; i++) {
      const m = new Decimal(data.lineas[i]!.monto);
      if (m.lte(0)) {
        ctx.addIssue({
          path: ["lineas", i, "monto"],
          code: "custom",
          message: "El monto debe ser mayor a 0",
        });
      }
      total = total.plus(m);
    }
    if (total.lte(0)) {
      ctx.addIssue({
        path: ["lineas"],
        code: "custom",
        message: "El total del movimiento debe ser mayor a 0",
      });
    }
    // Cuentas duplicadas → permitimos (el user puede partir un mismo
    // gasto en 2 líneas con descripciones distintas). Sin chequeo.
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

export type CrearMovimientoInput = z.input<typeof crearMovimientoSchema>;

export type CrearMovimientoResult =
  | {
      ok: true;
      movimientoId: string;
      asientoId: string;
      asientoNumero: number;
    }
  | { ok: false; error: string };

export async function crearMovimientoTesoreriaAction(
  raw: CrearMovimientoInput,
): Promise<CrearMovimientoResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = crearMovimientoSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const {
    tipo,
    cuentaBancariaId,
    fecha,
    moneda,
    tipoCambio,
    lineas,
    descripcion,
    comprobante,
    referenciaBanco,
  } = parsed.data;

  const total = lineas.reduce(
    (s, l) => s.plus(new Decimal(l.monto)),
    new Decimal(0),
  );
  const totalStr = total.toDecimalPlaces(2).toFixed(2);

  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: cuentaBancariaId },
    select: { id: true, moneda: true, cuentaContableId: true },
  });

  if (!cuentaBancaria) {
    return { ok: false, error: "La cuenta bancaria seleccionada no existe." };
  }

  if (cuentaBancaria.moneda !== moneda) {
    return {
      ok: false,
      error: `La moneda del movimiento (${moneda}) no coincide con la moneda de la cuenta bancaria (${cuentaBancaria.moneda}).`,
    };
  }

  // Validar cada contrapartida: existe, activa, ANALITICA, distinta del banco.
  const cuentaIds = lineas.map((l) => l.cuentaContableId);
  const cuentasContrapartida = await db.cuentaContable.findMany({
    where: { id: { in: cuentaIds } },
    select: { id: true, codigo: true, tipo: true, activa: true },
  });
  const cuentaById = new Map(cuentasContrapartida.map((c) => [c.id, c]));

  for (const linea of lineas) {
    const c = cuentaById.get(linea.cuentaContableId);
    if (!c) {
      return {
        ok: false,
        error: `La cuenta contrapartida ${linea.cuentaContableId} no existe.`,
      };
    }
    if (!c.activa) {
      return { ok: false, error: `La cuenta ${c.codigo} está inactiva.` };
    }
    if (c.tipo !== CuentaTipo.ANALITICA) {
      return {
        ok: false,
        error: `La cuenta ${c.codigo} no es ANALITICA.`,
      };
    }
    if (cuentaBancaria.cuentaContableId === c.id) {
      return {
        ok: false,
        error: "La contrapartida no puede ser la misma cuenta contable del banco.",
      };
    }
  }

  // Préstamo amortization: validar saldo por línea cuyo cuenta es préstamo.
  if (tipo === MovimientoTesoreriaTipo.PAGO) {
    for (const linea of lineas) {
      const prestamoEnCuenta = await db.prestamoExterno.findFirst({
        where: { cuentaContableId: linea.cuentaContableId },
        select: { id: true, prestamista: true },
      });
      if (!prestamoEnCuenta) continue;

      const intentoArs = new Decimal(linea.monto)
        .times(new Decimal(tipoCambio))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const saldoCheck = await validarSaldoSuficientePrestamo(
        linea.cuentaContableId,
        intentoArs,
      );
      if (!saldoCheck.ok) {
        return {
          ok: false,
          error: `El monto excede el saldo pendiente del préstamo "${prestamoEnCuenta.prestamista}" (saldo: ARS ${saldoCheck.saldoActual.toFixed(2)}, intento: ARS ${saldoCheck.intento.toFixed(2)}, falta: ARS ${saldoCheck.faltante.toFixed(2)}).`,
        };
      }
    }
  }

  const primaryCuentaId = lineas[0]!.cuentaContableId;

  try {
    const result = await db.$transaction(async (tx) => {
      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo,
          cuentaBancariaId,
          fecha,
          monto: totalStr,
          moneda,
          tipoCambio,
          cuentaContableId: primaryCuentaId,
          descripcion,
          comprobante,
          referenciaBanco,
        },
        select: { id: true },
      });

      let asientoId: string;
      let asientoNumero: number;

      if (lineas.length === 1) {
        // 1 contrapartida — flujo clásico con split IDCB automático.
        const asiento = await crearAsientoMovimientoTesoreria(mov.id, tx);
        const contabilizado = await contabilizarAsiento(asiento.id, tx);
        asientoId = contabilizado.id;
        asientoNumero = contabilizado.numero;
      } else {
        // N contrapartidas — asiento manual de N+1 líneas.
        const asientoLineas: LineaInput[] = [];
        if (tipo === MovimientoTesoreriaTipo.COBRO) {
          asientoLineas.push({
            cuentaId: cuentaBancaria.cuentaContableId,
            debe: totalStr,
            haber: 0,
          });
          for (const l of lineas) {
            asientoLineas.push({
              cuentaId: l.cuentaContableId,
              debe: 0,
              haber: l.monto,
              descripcion: l.descripcion ?? undefined,
            });
          }
        } else {
          for (const l of lineas) {
            asientoLineas.push({
              cuentaId: l.cuentaContableId,
              debe: l.monto,
              haber: 0,
              descripcion: l.descripcion ?? undefined,
            });
          }
          asientoLineas.push({
            cuentaId: cuentaBancaria.cuentaContableId,
            debe: 0,
            haber: totalStr,
          });
        }
        const asiento = await crearAsientoManual(
          {
            fecha,
            descripcion: descripcion ?? `${tipo} ${moneda} ${totalStr}`,
            origen: AsientoOrigen.TESORERIA,
            moneda,
            tipoCambio,
            lineas: asientoLineas,
          },
          tx,
        );
        await tx.movimientoTesoreria.update({
          where: { id: mov.id },
          data: { asientoId: asiento.id },
        });
        const contabilizado = await contabilizarAsiento(asiento.id, tx);
        asientoId = contabilizado.id;
        asientoNumero = contabilizado.numero;
      }

      return { movimientoId: mov.id, asientoId, asientoNumero };
    });

    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/tesoreria/movimientos");
    revalidatePath("/tesoreria/prestamos");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("crearMovimientoTesoreriaAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al registrar el movimiento.",
    };
  }
}

// ============================================================
// Pago a través de intermediário (despachante, agente, etc).
// El usuário transfiere $X al despachante; el despachante paga las
// facturas a los proveedores finales. La diferencia entre el monto
// transferido y la suma de las facturas queda como anticipo (a favor
// del usuário) o saldo pendiente con el intermediário.
// ============================================================

const pagoIntermediarioSchema = z
  .object({
    cuentaBancariaId: z.string().uuid(),
    fecha: z.coerce.date(),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(FX_RE),
    // Monto que efectivamente sale del banco hacia el intermediario.
    // Puede ser distinto al subtotal de facturas pagadas.
    montoTransferido: z.string().regex(MONEY_RE),
    // Facturas que el intermediario va a pagar en nuestro nombre.
    facturas: z
      .array(
        z.object({
          cuentaContableId: z.number().int().positive(),
          monto: z.string().regex(MONEY_RE),
          descripcion: z
            .string()
            .trim()
            .max(255)
            .optional()
            .transform((v) => (v && v.length > 0 ? v : null)),
        }),
      )
      .min(1),
    // Cuenta del intermediario (despachante, agente). Absorbe la
    // diferencia entre montoTransferido y subtotal facturas.
    beneficiarioCuentaId: z.number().int().positive(),
    descripcion: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    comprobante: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    referenciaBanco: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((data, ctx) => {
    const total = new Decimal(data.montoTransferido);
    if (total.lte(0)) {
      ctx.addIssue({
        path: ["montoTransferido"],
        code: "custom",
        message: "Monto transferido debe ser > 0",
      });
    }
    let subtotal = new Decimal(0);
    data.facturas.forEach((f, i) => {
      const m = new Decimal(f.monto);
      if (m.lte(0)) {
        ctx.addIssue({
          path: ["facturas", i, "monto"],
          code: "custom",
          message: "Monto factura > 0",
        });
      }
      subtotal = subtotal.plus(m);
    });
    if (subtotal.lte(0)) {
      ctx.addIssue({
        path: ["facturas"],
        code: "custom",
        message: "Subtotal facturas > 0",
      });
    }
    if (data.moneda === Moneda.ARS && Number(data.tipoCambio) !== 1) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: "custom",
        message: "TC debe ser 1 para ARS",
      });
    }
  });

export type PagoIntermediarioInput = z.input<typeof pagoIntermediarioSchema>;

export type PagoIntermediarioResult =
  | {
      ok: true;
      movimientoId: string;
      asientoId: string;
      asientoNumero: number;
      diferencia: string;
      tipoDiferencia: "exacto" | "anticipo" | "saldo_pendiente";
    }
  | { ok: false; error: string };

export async function pagarConIntermediarioAction(
  raw: PagoIntermediarioInput,
): Promise<PagoIntermediarioResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = pagoIntermediarioSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const data = parsed.data;
  const total = new Decimal(data.montoTransferido);
  const subtotal = data.facturas.reduce(
    (s, f) => s.plus(new Decimal(f.monto)),
    new Decimal(0),
  );
  const diferencia = total.minus(subtotal);

  // Validaciones de cuentas
  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: data.cuentaBancariaId },
    select: { id: true, moneda: true, cuentaContableId: true },
  });
  if (!cuentaBancaria) {
    return { ok: false, error: "Cuenta bancaria no existe." };
  }
  if (cuentaBancaria.moneda !== data.moneda) {
    return {
      ok: false,
      error: `Moneda movimiento (${data.moneda}) ≠ moneda cuenta (${cuentaBancaria.moneda}).`,
    };
  }

  const cuentaIds = Array.from(
    new Set([
      ...data.facturas.map((f) => f.cuentaContableId),
      data.beneficiarioCuentaId,
    ]),
  );
  const cuentas = await db.cuentaContable.findMany({
    where: { id: { in: cuentaIds } },
    select: { id: true, codigo: true, tipo: true, activa: true },
  });
  const cuentaById = new Map(cuentas.map((c) => [c.id, c]));

  for (const id of cuentaIds) {
    const c = cuentaById.get(id);
    if (!c) {
      return { ok: false, error: `Cuenta ${id} no existe.` };
    }
    if (!c.activa) {
      return { ok: false, error: `Cuenta ${c.codigo} inactiva.` };
    }
    if (c.tipo !== CuentaTipo.ANALITICA) {
      return { ok: false, error: `Cuenta ${c.codigo} no es ANALITICA.` };
    }
    if (id === cuentaBancaria.cuentaContableId) {
      return {
        ok: false,
        error: "Las cuentas de contrapartida no pueden ser la cuenta del banco.",
      };
    }
  }

  const beneficiarioCuenta = cuentaById.get(data.beneficiarioCuentaId)!;

  try {
    const result = await db.$transaction(async (tx) => {
      // El MovimientoTesoreria registra el monto bancario real y apunta al
      // beneficiario como contrapartida primária (para listados/CxP).
      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo: MovimientoTesoreriaTipo.PAGO,
          cuentaBancariaId: data.cuentaBancariaId,
          fecha: data.fecha,
          monto: total.toFixed(2),
          moneda: data.moneda,
          tipoCambio: data.tipoCambio,
          cuentaContableId: data.beneficiarioCuentaId,
          descripcion: data.descripcion,
          comprobante: data.comprobante,
          referenciaBanco: data.referenciaBanco,
        },
        select: { id: true },
      });

      // Construir asiento manual:
      //   DEBE [cada factura proveedor]   por su monto
      //   DEBE [beneficiario] diferencia  si transferimos demás (anticipo)
      //   HABER [beneficiario] |diferencia|  si transferimos de menos
      //   HABER [banco] montoTransferido
      const lineas: LineaInput[] = [];

      for (const f of data.facturas) {
        lineas.push({
          cuentaId: f.cuentaContableId,
          debe: f.monto,
          haber: 0,
          descripcion: f.descripcion ?? undefined,
        });
      }

      if (diferencia.gt(0)) {
        lineas.push({
          cuentaId: data.beneficiarioCuentaId,
          debe: diferencia.toFixed(2),
          haber: 0,
          descripcion: `Anticipo / saldo a favor`,
        });
      } else if (diferencia.lt(0)) {
        lineas.push({
          cuentaId: data.beneficiarioCuentaId,
          debe: 0,
          haber: diferencia.abs().toFixed(2),
          descripcion: `Saldo pendiente con intermediario`,
        });
      }

      lineas.push({
        cuentaId: cuentaBancaria.cuentaContableId,
        debe: 0,
        haber: total.toFixed(2),
      });

      const asiento = await crearAsientoManual(
        {
          fecha: data.fecha,
          descripcion:
            data.descripcion ??
            `Pago vía intermediario — ${data.facturas.length} factura${
              data.facturas.length === 1 ? "" : "s"
            }`,
          origen: AsientoOrigen.TESORERIA,
          moneda: data.moneda,
          tipoCambio: data.tipoCambio,
          lineas,
        },
        tx,
      );
      await tx.movimientoTesoreria.update({
        where: { id: mov.id },
        data: { asientoId: asiento.id },
      });
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      return {
        movimientoId: mov.id,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
      };
    });

    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/tesoreria/movimientos");
    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/tesoreria/saldos-proveedores");
    revalidatePath("/contabilidad/asientos");

    const tipoDiferencia: "exacto" | "anticipo" | "saldo_pendiente" =
      diferencia.eq(0)
        ? "exacto"
        : diferencia.gt(0)
          ? "anticipo"
          : "saldo_pendiente";

    return {
      ok: true,
      ...result,
      diferencia: diferencia.toFixed(2),
      tipoDiferencia,
    };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("pagarConIntermediarioAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al registrar el pago.",
    };
  }
}

const crearTransferenciaSchema = z
  .object({
    cuentaBancariaOrigenId: z.string().uuid(),
    cuentaBancariaDestinoId: z.string().uuid(),
    fecha: z.coerce.date(),
    montoOrigen: z
      .string()
      .regex(MONEY_RE, "Monto origen inválido (máx. 2 decimales)"),
    montoDestino: z
      .string()
      .regex(MONEY_RE, "Monto destino inválido (máx. 2 decimales)"),
    tipoCambioOrigen: z
      .string()
      .regex(FX_RE, "Tipo de cambio origen inválido (máx. 6 decimales)"),
    tipoCambioDestino: z
      .string()
      .regex(FX_RE, "Tipo de cambio destino inválido (máx. 6 decimales)"),
    descripcion: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((data, ctx) => {
    if (data.cuentaBancariaOrigenId === data.cuentaBancariaDestinoId) {
      ctx.addIssue({
        path: ["cuentaBancariaDestinoId"],
        code: "custom",
        message: "La cuenta destino debe ser distinta de la origen.",
      });
    }
    if (Number(data.montoOrigen) <= 0) {
      ctx.addIssue({
        path: ["montoOrigen"],
        code: "custom",
        message: "El monto origen debe ser mayor a 0",
      });
    }
    if (Number(data.montoDestino) <= 0) {
      ctx.addIssue({
        path: ["montoDestino"],
        code: "custom",
        message: "El monto destino debe ser mayor a 0",
      });
    }
    if (Number(data.tipoCambioOrigen) <= 0) {
      ctx.addIssue({
        path: ["tipoCambioOrigen"],
        code: "custom",
        message: "El tipo de cambio origen debe ser mayor a 0",
      });
    }
    if (Number(data.tipoCambioDestino) <= 0) {
      ctx.addIssue({
        path: ["tipoCambioDestino"],
        code: "custom",
        message: "El tipo de cambio destino debe ser mayor a 0",
      });
    }
  });

export type CrearTransferenciaInput = z.input<typeof crearTransferenciaSchema>;

export type CrearTransferenciaResult =
  | {
      ok: true;
      movimientoId: string;
      asientoId: string;
      asientoNumero: number;
    }
  | { ok: false; error: string };

export async function crearTransferenciaAction(
  raw: CrearTransferenciaInput,
): Promise<CrearTransferenciaResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = crearTransferenciaSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos." };
  }

  const {
    cuentaBancariaOrigenId,
    cuentaBancariaDestinoId,
    fecha,
    montoOrigen,
    montoDestino,
    tipoCambioOrigen,
    tipoCambioDestino,
    descripcion,
  } = parsed.data;

  const [origen, destino] = await Promise.all([
    db.cuentaBancaria.findUnique({
      where: { id: cuentaBancariaOrigenId },
      select: { id: true, moneda: true },
    }),
    db.cuentaBancaria.findUnique({
      where: { id: cuentaBancariaDestinoId },
      select: { id: true, moneda: true },
    }),
  ]);

  if (!origen) {
    return { ok: false, error: "La cuenta origen no existe." };
  }
  if (!destino) {
    return { ok: false, error: "La cuenta destino no existe." };
  }

  if (origen.moneda === Moneda.ARS && Number(tipoCambioOrigen) !== 1) {
    return {
      ok: false,
      error: "Para una cuenta origen en ARS el tipo de cambio debe ser 1.",
    };
  }
  if (destino.moneda === Moneda.ARS && Number(tipoCambioDestino) !== 1) {
    return {
      ok: false,
      error: "Para una cuenta destino en ARS el tipo de cambio debe ser 1.",
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const { asiento, movimientoId } = await crearAsientoTransferencia(
        {
          fecha,
          cuentaBancariaOrigenId,
          cuentaBancariaDestinoId,
          montoOrigen,
          montoDestino,
          tipoCambioOrigen,
          tipoCambioDestino,
          descripcion,
        },
        tx,
      );

      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      return {
        movimientoId,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
      };
    });

    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/tesoreria/movimientos");
    revalidatePath("/tesoreria/transferencias");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("crearTransferenciaAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al registrar la transferencia.",
    };
  }
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
    default:
      return err.message;
  }
}
