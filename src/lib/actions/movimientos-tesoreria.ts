"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { isRetencionGananciasEnabled } from "@/lib/features";
import {
  AsientoError,
  calcularPernaPagoUsd,
  construirLineaDiferenciaCambiaria,
  contabilizarAsiento,
  crearAsientoManual,
  crearAsientoMovimientoTesoreria,
  crearAsientoTransferencia,
  type LineaInput,
} from "@/lib/services/asiento-automatico";
import { getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { RETENCION_GANANCIAS_CODIGOS } from "@/lib/services/cuenta-registry";
import {
  construirRetencionManualParaPago,
  registrarRetencionPracticada,
  resolverRetencionGananciasParaPago,
} from "@/lib/services/retencion-ganancias-pago";
import { validarSaldoSuficientePrestamo } from "@/lib/services/prestamo";
import {
  AsientoOrigen,
  ConceptoRG830,
  CuentaTipo,
  Moneda,
  MovimientoTesoreriaTipo,
  Prisma,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

// Grava rows en AplicacionPagoEmbarqueCosto/Compra/Gasto vinculando línea
// DEBE del asiento a la(s) factura(s) que está pagando. Las líneas se
// matchean por ORDEN: el caller pasa `bindings` en el mismo orden que las
// líneas DEBE fueron insertadas en el asiento; este helper queries las
// líneas DEBE ordenadas por id (orden de inserción) y aplica los appliedTo.
async function gravarAplicacionesPago(
  tx: TxClient,
  asientoId: string,
  bindings: Array<{ appliedTo?: AplicarPagoA | AplicarPagoA[] | null }>,
): Promise<void> {
  const tieneAppliedTo = bindings.some((b) => b.appliedTo);
  if (!tieneAppliedTo) return;

  const lineasDebe = await tx.lineaAsiento.findMany({
    where: { asientoId, debe: { gt: 0 } },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    if (!b?.appliedTo) continue;
    const linea = lineasDebe[i];
    if (!linea) continue;
    const apls = Array.isArray(b.appliedTo) ? b.appliedTo : [b.appliedTo];
    for (const apl of apls) {
      const data = { lineaAsientoId: linea.id, montoArs: apl.montoArs } as const;
      if (apl.tipo === "embarqueCosto") {
        await tx.aplicacionPagoEmbarqueCosto.create({
          data: { ...data, embarqueCostoId: apl.id },
        });
      } else if (apl.tipo === "compra") {
        await tx.aplicacionPagoCompra.create({
          data: { ...data, compraId: apl.id },
        });
      } else {
        await tx.aplicacionPagoGasto.create({
          data: { ...data, gastoId: apl.id },
        });
      }
    }
  }
}

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

export async function listarCuentasBancariasParaMovimiento(): Promise<CuentaBancariaOption[]> {
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

// Discriminated union para vincular linea DEBE a factura específica.
// Cuando presente, grava una row en AplicacionPagoEmbarqueCosto|Compra|Gasto
// que sirve como Layer 0 (FK estructural) en las views de cuentas-a-pagar.
const aplicarPagoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("embarqueCosto"),
    id: z.number().int().positive(),
    montoArs: z.string().regex(MONEY_RE, "montoArs inválido"),
  }),
  z.object({
    tipo: z.literal("compra"),
    id: z.string().uuid(),
    montoArs: z.string().regex(MONEY_RE, "montoArs inválido"),
  }),
  z.object({
    tipo: z.literal("gasto"),
    id: z.string().uuid(),
    montoArs: z.string().regex(MONEY_RE, "montoArs inválido"),
  }),
]);

export type AplicarPagoA = z.infer<typeof aplicarPagoSchema>;

const lineaContrapartidaSchema = z.object({
  cuentaContableId: z.number().int().positive(),
  monto: z.string().regex(MONEY_RE, "Monto inválido (máx. 2 decimales)"),
  descripcion: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  // Opcional: vincular esta línea DEBE a una o más facturas pagadas.
  // El total de montoArs debe coincidir con `monto` (validado en superRefine).
  appliedTo: z.array(aplicarPagoSchema).optional(),
});

const crearMovimientoSchema = z
  .object({
    tipo: z.enum([MovimientoTesoreriaTipo.COBRO, MovimientoTesoreriaTipo.PAGO]),
    cuentaBancariaId: z.string().uuid(),
    fecha: z.coerce.date(),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(FX_RE, "Tipo de cambio inválido (máx. 6 decimales)"),
    // 1+ contrapartidas. El total del movimiento bancario es la suma
    // de sus montos. Para casos simples (1 sola contrapartida) se
    // mantiene el comportamiento clásico (incluyendo split IDCB 33/67%).
    lineas: z.array(lineaContrapartidaSchema).min(1, "Agregue al menos una línea de contrapartida"),
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
    // Retención de Ganancias cargada MANUALMENTE en el diálogo de pago: el
    // usuario ingresa el importe a retener (no se calcula). Cuando viene,
    // el pago se hace por el NETO y la retención queda como pasivo 2.1.3.07.
    // Sólo válida en PAGO en ARS a un único proveedor (ver action).
    retencionGananciasManual: z
      .object({
        importeRetenido: z.string().regex(MONEY_RE, "Importe de retención inválido"),
        concepto: z.nativeEnum(ConceptoRG830),
      })
      .optional(),
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
    if (data.retencionGananciasManual) {
      if (data.tipo !== MovimientoTesoreriaTipo.PAGO) {
        ctx.addIssue({
          path: ["retencionGananciasManual"],
          code: "custom",
          message: "La retención de Ganancias sólo aplica a pagos",
        });
      }
      if (data.moneda !== Moneda.ARS) {
        ctx.addIssue({
          path: ["retencionGananciasManual"],
          code: "custom",
          message: "La retención de Ganancias sólo aplica a pagos en ARS",
        });
      }
      const imp = new Decimal(data.retencionGananciasManual.importeRetenido);
      if (imp.lte(0)) {
        ctx.addIssue({
          path: ["retencionGananciasManual", "importeRetenido"],
          code: "custom",
          message: "La retención debe ser mayor a 0",
        });
      } else if (imp.gte(total)) {
        ctx.addIssue({
          path: ["retencionGananciasManual", "importeRetenido"],
          code: "custom",
          message: "La retención no puede ser mayor o igual al total del pago",
        });
      }
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
  // Valida que el user del JWT siga existiendo (redirige a /login si no): el
  // pago con retención graba RetencionPracticada.createdById (FK obligatoria) y
  // tras un reseed ese id rompe con P2003 luego de montar medio asiento.
  const userId = await requireSessionUser();

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
    retencionGananciasManual,
  } = parsed.data;

  // La retención manual también queda detrás de la feature flag (consistente
  // con el camino automático): si está apagada, no se puede cargar.
  if (retencionGananciasManual && !isRetencionGananciasEnabled()) {
    return { ok: false, error: "La retención de Ganancias no está habilitada." };
  }

  const total = lineas.reduce((s, l) => s.plus(new Decimal(l.monto)), new Decimal(0));
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
      const saldoCheck = await validarSaldoSuficientePrestamo(linea.cuentaContableId, intentoArs);
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
      // Serializa pagos concurrentes a la MISMA cuenta de proveedor para que
      // el acumulado mensual RG 830 no se lea en paralelo (bajo READ COMMITTED
      // dos pagos simultáneos verían el mismo `prev` y aplicarían el mínimo no
      // sujeto dos veces). Lock por-cuenta; se libera al cerrar la transacción.
      // Sólo en PAGO con la feature activa — flujo normal no toma lock.
      if (isRetencionGananciasEnabled() && tipo === MovimientoTesoreriaTipo.PAGO) {
        // $executeRaw (no $queryRaw): pg_advisory_xact_lock devuelve `void` y
        // el adapter pg no puede deserializar esa columna en $queryRaw.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${primaryCuentaId}::bigint)`;
      }

      // Retención de Ganancias (RG 830): si el pago corresponde, se paga el
      // NETO al banco y la diferencia queda como pasivo a depositar en ARCA.
      // Se resuelve DENTRO de la transacción para que el acumulado mensual
      // sea consistente. `null` ⇒ flujo de pago normal (sin cambios).
      //   - Manual: el usuario cargó el importe → se usa tal cual (cualquier
      //     proveedor, sin chequear `sujetoRetencionGanancias`).
      //   - Automático: se calcula desde parámetros + acumulado mensual.
      const retencionCtx = retencionGananciasManual
        ? await construirRetencionManualParaPago(
            {
              tipo,
              moneda,
              lineas,
              base: total,
              importeRetenido: new Decimal(retencionGananciasManual.importeRetenido),
              concepto: retencionGananciasManual.concepto,
            },
            tx,
          )
        : isRetencionGananciasEnabled()
          ? await resolverRetencionGananciasParaPago(
              { tipo, moneda, fecha, lineas, base: total },
              tx,
            )
          : null;
      if (retencionGananciasManual && !retencionCtx) {
        throw new AsientoError(
          "LINEA_INVALIDA",
          "No se pudo aplicar la retención: el pago debe ser en ARS a un único proveedor identificable (todas las líneas a la misma cuenta del mismo proveedor).",
        );
      }
      const retencionMonto = retencionCtx ? retencionCtx.resultado.importeRetenido : new Decimal(0);
      const netoBanco = total.minus(retencionMonto);
      // El movimiento bancario refleja la salida REAL de caja: el neto
      // cuando hay retención, el total cuando no.
      const montoMovimiento = retencionCtx ? netoBanco.toDecimalPlaces(2).toFixed(2) : totalStr;

      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo,
          cuentaBancariaId,
          fecha,
          monto: montoMovimiento,
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

      if (retencionCtx) {
        // Pago con retención Ganancias. Asiento:
        //   DEBE  [proveedor]  (1 línea por factura, suma = total bruto)
        //   HABER [banco]      neto (total − retención)
        //   HABER [2.1.3.07]   retención (pasivo a depositar a ARCA)
        // El proveedor se cancela por el BRUTO (saldo CxP baja por el total
        // facturado); la retención es un detalle de financiación.
        const cuentaRetencionId = await getOrCreateCuenta(
          tx,
          RETENCION_GANANCIAS_CODIGOS.RETENCIONES_GANANCIAS_POR_PAGAR,
        );
        const retencionStr = retencionMonto.toDecimalPlaces(2).toFixed(2);
        const netoStr = netoBanco.toDecimalPlaces(2).toFixed(2);

        const asientoLineas: LineaInput[] = lineas.map((l) => ({
          cuentaId: l.cuentaContableId,
          debe: l.monto,
          haber: 0,
          descripcion: l.descripcion ?? undefined,
        }));
        asientoLineas.push({
          cuentaId: cuentaBancaria.cuentaContableId,
          debe: 0,
          haber: netoStr,
          descripcion: `Pago neto — retención Ganancias ${retencionStr}`,
        });
        asientoLineas.push({
          cuentaId: cuentaRetencionId,
          debe: 0,
          haber: retencionStr,
          descripcion: `Retención Ganancias RG 830 — ${retencionCtx.proveedor.nombre}`,
        });

        const asiento = await crearAsientoManual(
          {
            fecha,
            descripcion:
              descripcion ?? `Pago ${moneda} ${totalStr} (ret. Ganancias ${retencionStr})`,
            origen: AsientoOrigen.TESORERIA,
            moneda,
            tipoCambio,
            lineas: asientoLineas,
          },
          tx,
        );
        const updMovRet = await tx.movimientoTesoreria.updateMany({
          where: { id: mov.id, asientoId: null },
          data: { asientoId: asiento.id },
        });
        if (updMovRet.count !== 1) {
          throw new AsientoError(
            "CONCURRENCIA",
            `MovimientoTesoreria ${mov.id} fue contabilizado simultáneamente por otro proceso.`,
          );
        }
        const contabilizado = await contabilizarAsiento(asiento.id, tx);
        asientoId = contabilizado.id;
        asientoNumero = contabilizado.numero;
        // Las N primeras líneas DEBE (orden de `lineas`) son las facturas.
        await gravarAplicacionesPago(tx, contabilizado.id, lineas);
        // Registrar la retención practicada + auditoría.
        await registrarRetencionPracticada(tx, {
          contexto: retencionCtx,
          movimientoTesoreriaId: mov.id,
          fecha,
          createdById: userId,
        });
      } else if (lineas.length === 1) {
        // 1 contrapartida — flujo clásico con split IDCB automático.
        const asiento = await crearAsientoMovimientoTesoreria(mov.id, tx);
        const contabilizado = await contabilizarAsiento(asiento.id, tx);
        asientoId = contabilizado.id;
        asientoNumero = contabilizado.numero;
        // Línea DEBE = primera línea del asiento split (la otra es el banco HABER).
        // Si hay appliedTo, vincular esa línea con la(s) factura(s).
        if (tipo === MovimientoTesoreriaTipo.PAGO && lineas[0]!.appliedTo) {
          await gravarAplicacionesPago(tx, contabilizado.id, [{ appliedTo: lineas[0]!.appliedTo }]);
        }
      } else {
        // N contrapartidas — asiento manual de N+1 líneas.
        // Libro ARS-único: si el movimiento es USD, cada línea va en pesos
        // (monto × TC, redondeo por parcela) con el principal USD en su
        // metadata; el banco cierra con la SUMA exacta de las parcelas ARS
        // para que la partida no se desbalancee por redondeo.
        const esUsd = moneda !== Moneda.ARS;
        const tcDec = new Decimal(tipoCambio);
        const lineaArs = (monto: string) =>
          esUsd
            ? new Decimal(monto).times(tcDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            : new Decimal(monto);
        const metaUsd = (montoUsd: string) =>
          esUsd
            ? {
                monedaOrigen: Moneda.USD,
                montoOrigen: montoUsd,
                tipoCambioOrigen: tcDec.toFixed(6),
              }
            : {};
        const bancoArs = lineas
          .reduce((s, l) => s.plus(lineaArs(l.monto)), new Decimal(0))
          .toFixed(2);

        const asientoLineas: LineaInput[] = [];
        if (tipo === MovimientoTesoreriaTipo.COBRO) {
          asientoLineas.push({
            cuentaId: cuentaBancaria.cuentaContableId,
            debe: bancoArs,
            haber: 0,
            ...metaUsd(totalStr),
          });
          for (const l of lineas) {
            asientoLineas.push({
              cuentaId: l.cuentaContableId,
              debe: 0,
              haber: lineaArs(l.monto).toFixed(2),
              descripcion: l.descripcion ?? undefined,
              ...metaUsd(l.monto),
            });
          }
        } else {
          // PAGO: para movimiento USD, cada pierna con saldo USD pendiente
          // cancela el pasivo al TC de la factura (FIFO ponderado) y el spread
          // contra el TC del pago se acumula en una única línea de diferencia
          // cambiaria realizada (Fase 2). El banco cierra por el desembolso
          // real (Σ monto × TC pago), sin tocar por la diferencia.
          let spreadNeto = new Decimal(0);
          // USD ya consumido por cuenta dentro de ESTE pago: evita que dos
          // piernas a la misma cuenta de proveedor consuman dos veces las
          // mismas facturas (el FIFO sólo ve líneas ya contabilizadas).
          const usdConsumidoPorCuenta = new Map<number, Decimal>();
          for (const l of lineas) {
            let debeArs = lineaArs(l.monto);
            let meta = metaUsd(l.monto);
            if (esUsd) {
              const usdLinea = new Decimal(l.monto);
              const yaConsumido = usdConsumidoPorCuenta.get(l.cuentaContableId) ?? new Decimal(0);
              const perna = await calcularPernaPagoUsd(
                tx,
                l.cuentaContableId,
                usdLinea,
                tcDec,
                yaConsumido,
              );
              if (perna.esFase2) {
                debeArs = perna.debeArs;
                meta = {
                  monedaOrigen: Moneda.USD,
                  montoOrigen: l.monto,
                  tipoCambioOrigen: perna.tcOrigen.toFixed(6),
                };
                spreadNeto = spreadNeto.plus(perna.spread);
                usdConsumidoPorCuenta.set(l.cuentaContableId, yaConsumido.plus(usdLinea));
              }
            }
            asientoLineas.push({
              cuentaId: l.cuentaContableId,
              debe: debeArs.toFixed(2),
              haber: 0,
              descripcion: l.descripcion ?? undefined,
              ...meta,
            });
          }
          asientoLineas.push({
            cuentaId: cuentaBancaria.cuentaContableId,
            debe: 0,
            haber: bancoArs,
            ...metaUsd(totalStr),
          });
          // Diferencia cambiaria consolidada (neta) de las piernas Fase 2.
          const difLinea = await construirLineaDiferenciaCambiaria(tx, spreadNeto);
          if (difLinea) asientoLineas.push(difLinea);
        }
        const asiento = await crearAsientoManual(
          {
            fecha,
            descripcion: descripcion ?? `${tipo} ${moneda} ${totalStr}`,
            origen: AsientoOrigen.TESORERIA,
            moneda: Moneda.ARS,
            tipoCambio: 1,
            lineas: asientoLineas,
          },
          tx,
        );
        const updMovMulti = await tx.movimientoTesoreria.updateMany({
          where: { id: mov.id, asientoId: null },
          data: { asientoId: asiento.id },
        });
        if (updMovMulti.count !== 1) {
          throw new AsientoError(
            "CONCURRENCIA",
            `MovimientoTesoreria ${mov.id} fue contabilizado simultáneamente por otro proceso.`,
          );
        }
        const contabilizado = await contabilizarAsiento(asiento.id, tx);
        asientoId = contabilizado.id;
        asientoNumero = contabilizado.numero;
        // Para PAGO multi-contrapartida, las primeras N líneas son las DEBE
        // (en orden de `lineas`). Pasamos los bindings en mismo orden.
        if (tipo === MovimientoTesoreriaTipo.PAGO) {
          await gravarAplicacionesPago(tx, contabilizado.id, lineas);
        }
      }

      return { movimientoId: mov.id, asientoId, asientoNumero };
    });

    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/tesoreria/movimientos");
    revalidatePath("/tesoreria/prestamos");
    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    // Colisión de número de certificado de retención (count+1 bajo concurrencia):
    // el @unique aborta la tx sin datos corruptos — pedir reintento limpio.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        error: "Conflicto de numeración (certificado de retención). Reintentá el pago.",
      };
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
          // Opcional: vincular esta factura a un EmbarqueCosto / Compra / Gasto.
          // El montoArs debe coincidir con `monto` (mismo significado en ARS).
          // Acepta singular (1 factura por línea DEBE) o array (split FIFO de
          // varias facturas pagadas con un único monto agregado).
          appliedTo: z.union([aplicarPagoSchema, z.array(aplicarPagoSchema)]).optional(),
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
  const subtotal = data.facturas.reduce((s, f) => s.plus(new Decimal(f.monto)), new Decimal(0));
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
    new Set([...data.facturas.map((f) => f.cuentaContableId), data.beneficiarioCuentaId]),
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
      // Libro ARS-único: en USD cada línea va en pesos (monto × TC, redondeo
      // por parcela) con el principal USD en su metadata.
      const esUsd = data.moneda !== Moneda.ARS;
      const tcDec = new Decimal(data.tipoCambio);
      const lineaArs = (monto: string) =>
        esUsd
          ? new Decimal(monto).times(tcDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : new Decimal(monto);
      const metaUsd = (montoUsd: string) =>
        esUsd
          ? {
              monedaOrigen: Moneda.USD,
              montoOrigen: montoUsd,
              tipoCambioOrigen: tcDec.toFixed(6),
            }
          : {};
      const lineas: LineaInput[] = [];

      for (const f of data.facturas) {
        lineas.push({
          cuentaId: f.cuentaContableId,
          debe: lineaArs(f.monto).toFixed(2),
          haber: 0,
          descripcion: f.descripcion ?? undefined,
          ...metaUsd(f.monto),
        });
      }

      if (diferencia.gt(0)) {
        lineas.push({
          cuentaId: data.beneficiarioCuentaId,
          debe: lineaArs(diferencia.toFixed(2)).toFixed(2),
          haber: 0,
          descripcion: "Anticipo / saldo a favor",
          ...metaUsd(diferencia.toFixed(2)),
        });
      } else if (diferencia.lt(0)) {
        lineas.push({
          cuentaId: data.beneficiarioCuentaId,
          debe: 0,
          haber: lineaArs(diferencia.abs().toFixed(2)).toFixed(2),
          descripcion: "Saldo pendiente con intermediario",
          ...metaUsd(diferencia.abs().toFixed(2)),
        });
      }

      // El banco cierra la partida: suma exacta de DEBEs menos HABERs no-banco
      // (en USD el redondeo por parcela podría no coincidir con total × TC).
      const bancoArs = lineas
        .reduce(
          (s, l) =>
            s.plus(new Decimal(String(l.debe ?? 0))).minus(new Decimal(String(l.haber ?? 0))),
          new Decimal(0),
        )
        .toFixed(2);
      lineas.push({
        cuentaId: cuentaBancaria.cuentaContableId,
        debe: 0,
        haber: bancoArs,
        ...metaUsd(total.toFixed(2)),
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
          moneda: Moneda.ARS,
          tipoCambio: 1,
          lineas,
        },
        tx,
      );
      const updMovInter = await tx.movimientoTesoreria.updateMany({
        where: { id: mov.id, asientoId: null },
        data: { asientoId: asiento.id },
      });
      if (updMovInter.count !== 1) {
        throw new AsientoError(
          "CONCURRENCIA",
          `MovimientoTesoreria ${mov.id} fue contabilizado simultáneamente por otro proceso.`,
        );
      }
      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // Gravar AplicacionPago* para las facturas que tienen appliedTo.
      // El orden de DEBE en el asiento es: facturas[] primero (en orden),
      // luego eventual beneficiario anticipo. Los primeros N DEBE = facturas.
      await gravarAplicacionesPago(
        tx,
        contabilizado.id,
        data.facturas.map((f) => ({ appliedTo: f.appliedTo })),
      );

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

    const tipoDiferencia: "exacto" | "anticipo" | "saldo_pendiente" = diferencia.eq(0)
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
    fechaDestino: z.coerce.date().optional(),
    montoOrigen: z.string().regex(MONEY_RE, "Monto origen inválido (máx. 2 decimales)"),
    montoDestino: z.string().regex(MONEY_RE, "Monto destino inválido (máx. 2 decimales)"),
    tipoCambioOrigen: z.string().regex(FX_RE, "Tipo de cambio origen inválido (máx. 6 decimales)"),
    tipoCambioDestino: z
      .string()
      .regex(FX_RE, "Tipo de cambio destino inválido (máx. 6 decimales)"),
    referenciaBancoOrigen: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    referenciaBancoDestino: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
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
    fechaDestino,
    montoOrigen,
    montoDestino,
    tipoCambioOrigen,
    tipoCambioDestino,
    referenciaBancoOrigen,
    referenciaBancoDestino,
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
          fechaDestino: fechaDestino ?? null,
          cuentaBancariaOrigenId,
          cuentaBancariaDestinoId,
          montoOrigen,
          montoDestino,
          tipoCambioOrigen,
          tipoCambioDestino,
          referenciaBancoOrigen,
          referenciaBancoDestino,
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
