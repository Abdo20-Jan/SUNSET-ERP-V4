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
  type LineaInput,
} from "@/lib/services/asiento-automatico";
import {
  getPagosUsdPorCuenta,
  pagadoUsdParaFactura,
  TIPOS_PROVEEDOR_EXTERIOR,
} from "@/lib/services/cuentas-a-pagar";
import {
  AsientoOrigen,
  CompraEstado,
  EmbarqueCostoEstado,
  EmbarqueEstado,
  Moneda,
  MovimientoTesoreriaTipo,
  Prisma,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const ESTADOS_EMBARQUE_CON_SALDO: EmbarqueEstado[] = [
  EmbarqueEstado.EN_ZONA_PRIMARIA,
  EmbarqueEstado.EN_ADUANA,
  EmbarqueEstado.DESPACHADO,
  EmbarqueEstado.EN_DEPOSITO,
  EmbarqueEstado.CERRADO,
];

// El input acepta UNO de los dos: tipoCambioBanco O montoArs. El otro se
// deriva automáticamente del USD a pagar. No se calcula diferencia cambial
// en el momento del pago — el asiento siempre es de 2 líneas (DEBE cuenta
// proveedor / HABER cuenta banco) por el mismo monto ARS. La diferencia
// con el saldo contable HABER del proveedor (que viene del asiento de
// ingreso ZP al TC del día) surge naturalmente como saldo residual y se
// concilia por separado (ajuste manual de fechamento si necesario).
const pagarFacturaExteriorSchema = z
  .object({
    // "compra"      → Compra USD (id = uuid)
    // "embarqueCosto" → EmbarqueCosto USD (id = entero)
    // "embarqueFob" → factura virtual derivada del Embarque + ItemEmbarque (id = uuid del Embarque)
    facturaOrigen: z.enum(["compra", "embarqueCosto", "embarqueFob"]),
    /** UUID (compra / embarqueFob) o número entero (embarqueCosto). */
    facturaId: z.union([z.string().uuid(), z.number().int().positive()]),
    cuentaBancariaArsId: z.string().uuid(),
    fecha: z.coerce.date(),
    montoUsdAPagar: z.string().regex(MONEY_RE, "Monto USD inválido (máx. 2 decimales)").optional(),
    // UNO de los dos (exclusivo) — el otro se calcula automáticamente:
    tipoCambioBanco: z
      .string()
      .regex(FX_RE, "Tipo de cambio inválido (máx. 6 decimales)")
      .optional(),
    montoArs: z.string().regex(MONEY_RE, "Monto ARS inválido (máx. 2 decimales)").optional(),
    comprobante: z.string().trim().max(100).optional(),
    referenciaBanco: z.string().trim().max(100).optional(),
    descripcionExtra: z.string().trim().max(255).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.facturaOrigen === "compra" && typeof data.facturaId !== "string") {
      ctx.addIssue({
        path: ["facturaId"],
        code: "custom",
        message: "Para una Compra el id debe ser UUID.",
      });
    }
    if (data.facturaOrigen === "embarqueCosto" && typeof data.facturaId !== "number") {
      ctx.addIssue({
        path: ["facturaId"],
        code: "custom",
        message: "Para un EmbarqueCosto el id debe ser un entero.",
      });
    }
    if (data.facturaOrigen === "embarqueFob" && typeof data.facturaId !== "string") {
      ctx.addIssue({
        path: ["facturaId"],
        code: "custom",
        message: "Para un Embarque FOB el id debe ser UUID.",
      });
    }
    const tcGiven = data.tipoCambioBanco !== undefined && data.tipoCambioBanco !== "";
    const arsGiven = data.montoArs !== undefined && data.montoArs !== "";
    if (tcGiven === arsGiven) {
      ctx.addIssue({
        path: ["tipoCambioBanco"],
        code: "custom",
        message: "Indique tipo de cambio del banco O monto ARS a debitar (exactamente uno).",
      });
    }
    if (tcGiven && Number(data.tipoCambioBanco) <= 0) {
      ctx.addIssue({
        path: ["tipoCambioBanco"],
        code: "custom",
        message: "El tipo de cambio debe ser mayor a 0.",
      });
    }
    if (arsGiven && Number(data.montoArs) <= 0) {
      ctx.addIssue({
        path: ["montoArs"],
        code: "custom",
        message: "El monto ARS debe ser mayor a 0.",
      });
    }
    if (data.montoUsdAPagar !== undefined && Number(data.montoUsdAPagar) <= 0) {
      ctx.addIssue({
        path: ["montoUsdAPagar"],
        code: "custom",
        message: "El monto a pagar debe ser mayor a 0.",
      });
    }
  });

export type PagarFacturaExteriorInput = z.input<typeof pagarFacturaExteriorSchema>;

export type PagarFacturaExteriorResult =
  | {
      ok: true;
      movimientoId: string;
      asientoId: string;
      asientoNumero: number;
      montoUsd: string;
      montoArs: string;
      tipoCambioAplicado: string; // dado o derivado de montoArs/montoUsd
    }
  | { ok: false; error: string };

interface FacturaCargada {
  id: string;
  numero: string;
  tipoCambioOriginal: Decimal;
  totalUsd: Decimal;
  proveedorId: string;
  proveedorNombre: string;
  proveedorPais: string | null;
  proveedorTipo: string;
  cuentaProveedorId: number;
  embarqueCodigo: string | null;
}

/**
 * Paga una factura USD de un proveedor del exterior debitando una
 * cuenta bancaria ARS. El usuário ingresa UNO de los dos: tipo de cambio
 * del banco O monto ARS efectivamente debitado del banco. El otro se
 * deriva automáticamente del USD a pagar.
 *
 * Asiento de SÓLO 2 líneas:
 *
 *   DEBE  cuentaProveedor   ARS = montoArs    (cancela parte del pasivo)
 *   HABER cuentaBanco ARS   ARS = montoArs    (salida real del banco)
 *
 * NO se genera diferencia cambiaria en el momento del pago. La cuenta
 * del proveedor vive en ARS en el libro; el TC del ingreso ZP (registrado
 * al cargar el embarque) sólo determinó el HABER original. Al pagar, se
 * debita el ARS efectivamente desembolsado — sin comparación con el TC
 * original ni cuentas 4.3.1.01 / 5.8.2.01.
 *
 * La diferencia entre el saldo HABER de la cuenta proveedor (al TC del
 * ingreso) y la suma de pagos DEBE (al TC del banco del día) surge como
 * saldo residual y se concilia con un ajuste manual de fechamento.
 *
 * La línea DEBE del proveedor lleva monedaOrigen=USD + montoOrigen +
 * tipoCambioOrigen: el principal USD pagado es metadata de la línea,
 * invariante a TC. `getSaldosExteriorPorProveedor` descuenta el saldo
 * USD del proveedor desde esa metadata (con AplicacionPago* como ancla
 * factura↔pago, y tokens en la descripción como fallback legacy).
 */
export async function pagarFacturaExteriorAction(
  raw: PagarFacturaExteriorInput,
): Promise<PagarFacturaExteriorResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = pagarFacturaExteriorSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const {
    facturaOrigen,
    facturaId,
    cuentaBancariaArsId,
    tipoCambioBanco,
    montoArs: montoArsInput,
    fecha,
    montoUsdAPagar,
    comprobante,
    referenciaBanco,
    descripcionExtra,
  } = parsed.data;

  const cuentaBancaria = await db.cuentaBancaria.findUnique({
    where: { id: cuentaBancariaArsId },
    select: {
      id: true,
      banco: true,
      numero: true,
      moneda: true,
      cuentaContableId: true,
    },
  });
  if (!cuentaBancaria) {
    return { ok: false, error: "La cuenta bancaria seleccionada no existe." };
  }
  if (cuentaBancaria.moneda !== Moneda.ARS) {
    return {
      ok: false,
      error: "La cuenta bancaria debe ser en ARS — el pago USD se hace con TC del banco.",
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const factura = await cargarFactura(tx, facturaOrigen, facturaId);

      // Validar proveedor exterior por tipo o país.
      const esExteriorPorTipo = TIPOS_PROVEEDOR_EXTERIOR.some((t) => t === factura.proveedorTipo);
      const esExteriorPorPais =
        factura.proveedorPais !== null && factura.proveedorPais.toUpperCase() !== "AR";
      if (!esExteriorPorTipo && !esExteriorPorPais) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El proveedor "${factura.proveedorNombre}" no es exterior (ni por tipo ni por país).`,
        );
      }

      // Saldo USD pendiente de la factura: total − pagado USD acumulado.
      const pagadoUsd = await pagadoUsdDeFactura(tx, facturaOrigen, factura);
      const saldoUsd = factura.totalUsd.minus(pagadoUsd);
      if (saldoUsd.lte(0.005)) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `La factura ${factura.numero} no tiene saldo USD pendiente.`,
        );
      }

      const montoUsd = montoUsdAPagar !== undefined ? new Decimal(montoUsdAPagar) : saldoUsd;
      if (montoUsd.minus(saldoUsd).gt(0.005)) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `El monto a pagar (USD ${montoUsd.toFixed(2)}) excede el saldo pendiente (USD ${saldoUsd.toFixed(2)}).`,
        );
      }

      // Resolver montoArs y tcAplicado: uno se da, el otro se deriva.
      let montoArs: Decimal;
      let tcAplicado: Decimal;
      if (montoArsInput !== undefined && montoArsInput !== "") {
        montoArs = new Decimal(montoArsInput);
        tcAplicado = montoArs.dividedBy(montoUsd).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
      } else {
        tcAplicado = new Decimal(tipoCambioBanco ?? "0");
        montoArs = montoUsd.times(tcAplicado).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      }

      const refFactura = factura.embarqueCodigo
        ? `${factura.numero} ${factura.embarqueCodigo}`
        : factura.numero;
      const descripcionBase = `Pago factura exterior ${refFactura} — ${factura.proveedorNombre}`;
      const descripcionAsiento = descripcionExtra
        ? `${descripcionBase} — ${descripcionExtra}`
        : descripcionBase;

      // Asiento de 2 líneas — sin diferencia cambial. La línea DEBE lleva
      // el principal USD como metadata (monedaOrigen/montoOrigen) — fuente
      // canónica del pagado USD, invariante a TC. La descripción mantiene
      // numero + embarqueCodigo como tokens para el fallback de pagos
      // legacy sin AplicacionPago* (embarqueFob).
      const lineas: LineaInput[] = [
        {
          cuentaId: factura.cuentaProveedorId,
          debe: montoArs.toFixed(2),
          haber: 0,
          descripcion: `Cancelación ${refFactura}`,
          monedaOrigen: Moneda.USD,
          montoOrigen: montoUsd.toFixed(2),
          tipoCambioOrigen: tcAplicado.toFixed(6),
        },
        {
          cuentaId: cuentaBancaria.cuentaContableId,
          debe: 0,
          haber: montoArs.toFixed(2),
          descripcion: `Pago ${cuentaBancaria.banco}${
            cuentaBancaria.numero ? ` ${cuentaBancaria.numero}` : ""
          } — ${refFactura}`,
        },
      ];

      // MovimientoTesoreria en USD: el saldo bancario ARS se ajusta por
      // la línea HABER del asiento (en ARS), no por el monto del movimiento.
      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo: MovimientoTesoreriaTipo.PAGO,
          cuentaBancariaId: cuentaBancaria.id,
          fecha,
          monto: montoUsd.toFixed(2),
          moneda: Moneda.USD,
          tipoCambio: tcAplicado.toFixed(6),
          cuentaContableId: factura.cuentaProveedorId,
          descripcion: descripcionAsiento,
          comprobante: comprobante && comprobante.length > 0 ? comprobante : null,
          referenciaBanco: referenciaBanco && referenciaBanco.length > 0 ? referenciaBanco : null,
        },
        select: { id: true },
      });

      // Las líneas ya están en ARS (la DEBE lleva el principal USD en su
      // metadata); el asiento sigue la convención del libro diario en pesos.
      const asiento = await crearAsientoManual(
        {
          fecha,
          descripcion: descripcionAsiento,
          origen: AsientoOrigen.TESORERIA,
          moneda: Moneda.ARS,
          tipoCambio: 1,
          lineas,
        },
        tx,
      );

      // Vincular movimiento ↔ asiento con guard de concurrencia.
      const updMov = await tx.movimientoTesoreria.updateMany({
        where: { id: mov.id, asientoId: null },
        data: { asientoId: asiento.id },
      });
      if (updMov.count !== 1) {
        throw new AsientoError(
          "CONCURRENCIA",
          `MovimientoTesoreria ${mov.id} fue contabilizado simultáneamente por otro proceso.`,
        );
      }

      const contabilizado = await contabilizarAsiento(asiento.id, tx);

      // Recuperar id de la línea DEBE proveedor (única DEBE — modelo 2 líneas).
      const lineaDebeProv = await tx.lineaAsiento.findFirst({
        where: { asientoId: contabilizado.id, debe: { gt: 0 } },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (!lineaDebeProv) {
        throw new AsientoError(
          "LINEA_INVALIDA",
          "No se encontró línea DEBE del proveedor para vincular la aplicación de pago.",
        );
      }

      const aplicacionData = {
        lineaAsientoId: lineaDebeProv.id,
        montoArs: montoArs.toFixed(2),
      } as const;

      if (facturaOrigen === "compra") {
        await tx.aplicacionPagoCompra.create({
          data: { ...aplicacionData, compraId: factura.id },
        });
      } else if (facturaOrigen === "embarqueCosto") {
        await tx.aplicacionPagoEmbarqueCosto.create({
          data: { ...aplicacionData, embarqueCostoId: Number(factura.id) },
        });
      }
      // facturaOrigen === "embarqueFob": no hay tabla de aplicación dedicada;
      // el saldo se descuenta por match de tokens (embarque.codigo) en la
      // descripción de la línea DEBE — mismo algoritmo que getSaldosExteriorPorProveedor.

      return {
        movimientoId: mov.id,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
        montoUsd: montoUsd.toFixed(2),
        montoArs: montoArs.toFixed(2),
        tipoCambioAplicado: tcAplicado.toFixed(6),
      };
    });

    revalidatePath("/comex/proveedores");
    revalidatePath("/tesoreria/cuentas-a-pagar");
    revalidatePath("/tesoreria/cuentas");
    revalidatePath("/tesoreria/movimientos");
    revalidatePath("/contabilidad/asientos");

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    console.error("pagarFacturaExteriorAction failed", err);
    return {
      ok: false,
      error: "Error inesperado al registrar el pago.",
    };
  }
}

async function cargarFactura(
  tx: TxClient,
  origen: "compra" | "embarqueCosto" | "embarqueFob",
  id: string | number,
): Promise<FacturaCargada> {
  if (origen === "embarqueFob") {
    return cargarFacturaFobDelEmbarque(tx, String(id));
  }
  if (origen === "compra") {
    const compra = await tx.compra.findUnique({
      where: { id: String(id) },
      select: {
        id: true,
        numero: true,
        total: true,
        tipoCambio: true,
        moneda: true,
        estado: true,
        proveedor: {
          select: {
            id: true,
            nombre: true,
            pais: true,
            tipoProveedor: true,
            cuentaContableId: true,
          },
        },
        pedidoCompra: {
          select: {
            embarques: { select: { codigo: true }, take: 1 },
          },
        },
      },
    });
    if (!compra) {
      throw new AsientoError("DOMINIO_INVALIDO", `Compra ${id} no encontrada.`);
    }
    if (compra.moneda !== Moneda.USD) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Compra ${compra.numero} no es en USD — moneda: ${compra.moneda}.`,
      );
    }
    if (compra.estado !== CompraEstado.EMITIDA && compra.estado !== CompraEstado.RECIBIDA) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Compra ${compra.numero} en estado ${compra.estado} — no se puede pagar.`,
      );
    }
    if (compra.proveedor.cuentaContableId === null) {
      throw new AsientoError(
        "CUENTA_INVALIDA",
        `Proveedor "${compra.proveedor.nombre}" no tiene cuenta contable asignada.`,
      );
    }
    return {
      id: compra.id,
      numero: compra.numero,
      tipoCambioOriginal: new Decimal(compra.tipoCambio.toString()),
      totalUsd: new Decimal(compra.total.toString()),
      proveedorId: compra.proveedor.id,
      proveedorNombre: compra.proveedor.nombre,
      proveedorPais: compra.proveedor.pais,
      proveedorTipo: compra.proveedor.tipoProveedor,
      cuentaProveedorId: compra.proveedor.cuentaContableId,
      embarqueCodigo: compra.pedidoCompra?.embarques[0]?.codigo ?? null,
    };
  }

  const costo = await tx.embarqueCosto.findUnique({
    where: { id: Number(id) },
    select: {
      id: true,
      facturaNumero: true,
      tipoCambio: true,
      moneda: true,
      estado: true,
      iva: true,
      iibb: true,
      otros: true,
      proveedor: {
        select: {
          id: true,
          nombre: true,
          pais: true,
          tipoProveedor: true,
          cuentaContableId: true,
        },
      },
      embarque: { select: { codigo: true, estado: true } },
      lineas: { select: { subtotal: true } },
    },
  });
  if (!costo) {
    throw new AsientoError("DOMINIO_INVALIDO", `EmbarqueCosto ${id} no encontrado.`);
  }
  if (costo.moneda !== Moneda.USD) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `EmbarqueCosto ${costo.id} no es en USD — moneda: ${costo.moneda}.`,
    );
  }
  if (costo.estado === EmbarqueCostoEstado.ANULADA) {
    throw new AsientoError("DOMINIO_INVALIDO", `EmbarqueCosto ${costo.id} está anulado.`);
  }
  if (!ESTADOS_EMBARQUE_CON_SALDO.includes(costo.embarque.estado)) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Embarque ${costo.embarque.codigo} en estado ${costo.embarque.estado} — sin saldo a pagar.`,
    );
  }
  if (costo.proveedor.cuentaContableId === null) {
    throw new AsientoError(
      "CUENTA_INVALIDA",
      `Proveedor "${costo.proveedor.nombre}" no tiene cuenta contable asignada.`,
    );
  }

  const subtotalLineas = costo.lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.subtotal.toString())),
    new Decimal(0),
  );
  const totalUsd = subtotalLineas
    .plus(new Decimal(costo.iva.toString()))
    .plus(new Decimal(costo.iibb.toString()))
    .plus(new Decimal(costo.otros.toString()));

  return {
    id: String(costo.id),
    numero: costo.facturaNumero ?? `Factura #${costo.id}`,
    tipoCambioOriginal: new Decimal(costo.tipoCambio.toString()),
    totalUsd,
    proveedorId: costo.proveedor.id,
    proveedorNombre: costo.proveedor.nombre,
    proveedorPais: costo.proveedor.pais,
    proveedorTipo: costo.proveedor.tipoProveedor,
    cuentaProveedorId: costo.proveedor.cuentaContableId,
    embarqueCodigo: costo.embarque.codigo,
  };
}

/**
 * Carga una "factura virtual" derivada del Embarque + ItemEmbarque cuando
 * no existe Compra ni EmbarqueCosto USD del proveedor exterior (flujo
 * Modelo Y bonded). El total USD es Σ items.cantidad × precioUnitarioFob.
 * El TC original es el del propio embarque (registrado al cargarlo).
 */
async function cargarFacturaFobDelEmbarque(
  tx: TxClient,
  embarqueId: string,
): Promise<FacturaCargada> {
  const embarque = await tx.embarque.findUnique({
    where: { id: embarqueId },
    select: {
      id: true,
      codigo: true,
      estado: true,
      moneda: true,
      tipoCambio: true,
      proveedor: {
        select: {
          id: true,
          nombre: true,
          pais: true,
          tipoProveedor: true,
          cuentaContableId: true,
        },
      },
      items: { select: { cantidad: true, precioUnitarioFob: true } },
    },
  });
  if (!embarque) {
    throw new AsientoError("DOMINIO_INVALIDO", `Embarque ${embarqueId} no encontrado.`);
  }
  if (embarque.moneda !== Moneda.USD) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Embarque ${embarque.codigo} no es en USD — moneda: ${embarque.moneda}.`,
    );
  }
  if (!ESTADOS_EMBARQUE_CON_SALDO.includes(embarque.estado)) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Embarque ${embarque.codigo} en estado ${embarque.estado} — sin saldo a pagar.`,
    );
  }
  if (embarque.proveedor.cuentaContableId === null) {
    throw new AsientoError(
      "CUENTA_INVALIDA",
      `Proveedor "${embarque.proveedor.nombre}" no tiene cuenta contable asignada.`,
    );
  }
  const totalUsd = embarque.items.reduce(
    (acc, i) => acc.plus(new Decimal(i.precioUnitarioFob.toString()).times(i.cantidad)),
    new Decimal(0),
  );
  if (totalUsd.lte(0.005)) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Embarque ${embarque.codigo} no tiene valor FOB (sin items o items con precio 0).`,
    );
  }

  return {
    id: embarque.id,
    numero: embarque.codigo, // tokens del código son la única ancora del match
    tipoCambioOriginal: new Decimal(embarque.tipoCambio.toString()),
    totalUsd,
    proveedorId: embarque.proveedor.id,
    proveedorNombre: embarque.proveedor.nombre,
    proveedorPais: embarque.proveedor.pais,
    proveedorTipo: embarque.proveedor.tipoProveedor,
    cuentaProveedorId: embarque.proveedor.cuentaContableId,
    embarqueCodigo: embarque.codigo,
  };
}

/**
 * Suma los pagos USD ya aplicados a una factura. Usa el MISMO helper que
 * `getSaldosExteriorPorProveedor` (montoOrigen + AplicacionPago* como
 * fuente de verdad, tokens como fallback legacy) para que el monto
 * descontado acá coincida exactamente con el saldo mostrado en la UI
 * (sin desfase entre validación y vista).
 */
async function pagadoUsdDeFactura(
  tx: TxClient,
  origen: "compra" | "embarqueCosto" | "embarqueFob",
  factura: FacturaCargada,
): Promise<Decimal> {
  const pagosPorCuenta = await getPagosUsdPorCuenta(tx, [factura.cuentaProveedorId]);
  return pagadoUsdParaFactura(pagosPorCuenta.get(factura.cuentaProveedorId), {
    origen,
    id: factura.id,
    numero: factura.numero,
    embarqueCodigo: factura.embarqueCodigo,
  });
}
