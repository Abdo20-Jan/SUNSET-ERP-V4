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
import { TIPOS_PROVEEDOR_EXTERIOR } from "@/lib/services/cuentas-a-pagar";
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

/** Cuenta contable usada cuando TCbanco < TCfactura (la deuda original
 *  valía más que lo que pagamos hoy → ganancia financiera). */
const CODIGO_DIFERENCIA_POSITIVA = "4.3.1.01";
/** Cuenta contable usada cuando TCbanco > TCfactura (pagamos hoy más
 *  ARS que el saldo original → pérdida financiera). */
const CODIGO_DIFERENCIA_NEGATIVA = "5.8.2.01";

const ESTADOS_EMBARQUE_CON_SALDO: EmbarqueEstado[] = [
  EmbarqueEstado.EN_ZONA_PRIMARIA,
  EmbarqueEstado.EN_ADUANA,
  EmbarqueEstado.DESPACHADO,
  EmbarqueEstado.EN_DEPOSITO,
  EmbarqueEstado.CERRADO,
];

const pagarFacturaExteriorSchema = z
  .object({
    facturaOrigen: z.enum(["compra", "embarqueCosto"]),
    /** UUID (compra) o número entero (embarqueCosto). */
    facturaId: z.union([z.string().uuid(), z.number().int().positive()]),
    cuentaBancariaArsId: z.string().uuid(),
    tipoCambioBanco: z.string().regex(FX_RE, "Tipo de cambio inválido (máx. 6 decimales)"),
    fecha: z.coerce.date(),
    montoUsdAPagar: z.string().regex(MONEY_RE, "Monto USD inválido (máx. 2 decimales)").optional(),
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
    if (Number(data.tipoCambioBanco) <= 0) {
      ctx.addIssue({
        path: ["tipoCambioBanco"],
        code: "custom",
        message: "El tipo de cambio debe ser mayor a 0.",
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
      /** Diferencia ARS = montoArsProveedor − montoArsBanco.
       *  Positiva = ganancia (4.3.1.01); negativa = pérdida (5.8.2.01). */
      diferenciaArs: string;
      tipoDiferencia: "ganancia" | "perdida" | "exacto";
      montoUsd: string;
      montoArsProveedor: string;
      montoArsBanco: string;
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
 * cuenta bancaria ARS con el TC del banco del día. Genera un asiento
 * de 2 o 3 líneas:
 *
 *   DEBE  cuentaProveedor   ARS = USD × TCfactura      (cancela pasivo)
 *   HABER cuentaBanco ARS   ARS = USD × TCbanco        (salida real)
 *   HABER 4.3.1.01          ARS = diff (si TCbanco < TCfactura → ganancia)
 *   DEBE  5.8.2.01          ARS = |diff| (si TCbanco > TCfactura → pérdida)
 *
 * El MovimientoTesoreria queda en moneda USD con tipoCambio=TCbanco
 * para que `getSaldosExteriorPorProveedor` lo detecte y reduzca el
 * saldo USD del proveedor. El saldo bancario en ARS se actualiza por
 * la línea HABER del asiento (en ARS), no por el monto del movimiento.
 *
 * Vincula la línea DEBE proveedor con la factura vía
 * AplicacionPagoCompra / AplicacionPagoEmbarqueCosto (montoArs en ARS
 * al TC original de la factura — coincide con el monto debitado).
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
    fecha,
    montoUsdAPagar,
    descripcionExtra,
  } = parsed.data;

  // Validaciones fuera de la transacción: cuenta bancaria + cuentas de diff.
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

  // Pre-cargar ambas cuentas de diferencia cambiaria. Una se usa si
  // hay ganancia, otra si hay pérdida; si la fxRate coincide con TC
  // original no se usa ninguna.
  const cuentasDiff = await db.cuentaContable.findMany({
    where: {
      codigo: { in: [CODIGO_DIFERENCIA_POSITIVA, CODIGO_DIFERENCIA_NEGATIVA] },
      activa: true,
    },
    select: { id: true, codigo: true },
  });
  const cuentaDiffPositiva = cuentasDiff.find((c) => c.codigo === CODIGO_DIFERENCIA_POSITIVA);
  const cuentaDiffNegativa = cuentasDiff.find((c) => c.codigo === CODIGO_DIFERENCIA_NEGATIVA);

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
      const pagadoUsd = await pagadoUsdDeFactura(tx, factura);
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

      const tcBanco = new Decimal(tipoCambioBanco);
      const montoArsProveedor = montoUsd
        .times(factura.tipoCambioOriginal)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const montoArsBanco = montoUsd.times(tcBanco).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const diff = montoArsProveedor.minus(montoArsBanco);

      const tipoDiferencia: "ganancia" | "perdida" | "exacto" = diff.abs().lt(0.005)
        ? "exacto"
        : diff.gt(0)
          ? "ganancia"
          : "perdida";

      if (tipoDiferencia === "ganancia" && !cuentaDiffPositiva) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Falta la cuenta ${CODIGO_DIFERENCIA_POSITIVA} (DIFERENCIA DE CAMBIO POSITIVA) activa en el plan de cuentas.`,
        );
      }
      if (tipoDiferencia === "perdida" && !cuentaDiffNegativa) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Falta la cuenta ${CODIGO_DIFERENCIA_NEGATIVA} (DIFERENCIA DE CAMBIO NEGATIVA) activa en el plan de cuentas.`,
        );
      }

      const refFactura = factura.embarqueCodigo
        ? `${factura.numero} ${factura.embarqueCodigo}`
        : factura.numero;
      const descripcionBase = `Pago factura exterior ${refFactura} — ${factura.proveedorNombre}`;
      const descripcionAsiento = descripcionExtra
        ? `${descripcionBase} — ${descripcionExtra}`
        : descripcionBase;

      // Línea DEBE proveedor: descripción incluye numero+embarqueCodigo
      // como tokens (mismo formato que tokenizar() de cuentas-a-pagar),
      // así pagadoUsdParaFactura matchea futuro pago contra esta factura.
      const lineas: LineaInput[] = [
        {
          cuentaId: factura.cuentaProveedorId,
          debe: montoArsProveedor.toFixed(2),
          haber: 0,
          descripcion: `Cancelación ${refFactura}`,
        },
        {
          cuentaId: cuentaBancaria.cuentaContableId,
          debe: 0,
          haber: montoArsBanco.toFixed(2),
          descripcion: `Pago ${cuentaBancaria.banco}${
            cuentaBancaria.numero ? ` ${cuentaBancaria.numero}` : ""
          } — ${refFactura}`,
        },
      ];

      if (tipoDiferencia === "ganancia") {
        lineas.push({
          cuentaId: cuentaDiffPositiva!.id,
          debe: 0,
          haber: diff.toFixed(2),
          descripcion: `Diferencia cambiaria favorable — ${refFactura}`,
        });
      } else if (tipoDiferencia === "perdida") {
        lineas.push({
          cuentaId: cuentaDiffNegativa!.id,
          debe: diff.abs().toFixed(2),
          haber: 0,
          descripcion: `Diferencia cambiaria desfavorable — ${refFactura}`,
        });
      }

      // MovimientoTesoreria en USD: registra el pago contra el proveedor
      // exterior. El saldo bancario ARS se ajusta por la línea HABER del
      // asiento (en ARS), no por este monto.
      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo: MovimientoTesoreriaTipo.PAGO,
          cuentaBancariaId: cuentaBancaria.id,
          fecha,
          monto: montoUsd.toFixed(2),
          moneda: Moneda.USD,
          tipoCambio: tcBanco.toFixed(6),
          cuentaContableId: factura.cuentaProveedorId,
          descripcion: descripcionAsiento,
          comprobante: null,
          referenciaBanco: null,
        },
        select: { id: true },
      });

      const asiento = await crearAsientoManual(
        {
          fecha,
          descripcion: descripcionAsiento,
          origen: AsientoOrigen.TESORERIA,
          moneda: Moneda.USD,
          tipoCambio: tcBanco.toFixed(6),
          lineas,
        },
        tx,
      );

      // Vincular movimiento ↔ asiento con guard de concurrencia
      // (mismo patrón de crearMovimientoTesoreriaAction).
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

      // Recuperar id de la línea DEBE proveedor (primera DEBE insertada,
      // ordenada por id asc) para vincular AplicacionPago*.
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
        montoArs: montoArsProveedor.toFixed(2),
      } as const;

      if (facturaOrigen === "compra") {
        await tx.aplicacionPagoCompra.create({
          data: { ...aplicacionData, compraId: factura.id },
        });
      } else {
        await tx.aplicacionPagoEmbarqueCosto.create({
          data: { ...aplicacionData, embarqueCostoId: Number(factura.id) },
        });
      }

      return {
        movimientoId: mov.id,
        asientoId: contabilizado.id,
        asientoNumero: contabilizado.numero,
        diferenciaArs: diff.toFixed(2),
        tipoDiferencia,
        montoUsd: montoUsd.toFixed(2),
        montoArsProveedor: montoArsProveedor.toFixed(2),
        montoArsBanco: montoArsBanco.toFixed(2),
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
  origen: "compra" | "embarqueCosto",
  id: string | number,
): Promise<FacturaCargada> {
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
 * Suma los pagos USD ya aplicados a una factura. Espelha la lógica de
 * `pagadoUsdParaFactura` en getSaldosExteriorPorProveedor: match por
 * tokens del numero de factura o del código del embarque en la
 * descripción de la línea DEBE del proveedor en un asiento USD
 * contabilizado vinculado a un MovimientoTesoreria PAGO USD.
 *
 * Mantenemos el mismo algoritmo del servicio de saldos para que el
 * monto descontado acá coincida exactamente con el saldo mostrado en
 * la UI (sin desfase entre validación y vista).
 */
async function pagadoUsdDeFactura(tx: TxClient, factura: FacturaCargada): Promise<Decimal> {
  const lineasPago = await tx.lineaAsiento.findMany({
    where: {
      cuentaId: factura.cuentaProveedorId,
      debe: { gt: 0 },
      asiento: {
        estado: "CONTABILIZADO",
        moneda: Moneda.USD,
        movimiento: {
          tipo: MovimientoTesoreriaTipo.PAGO,
          moneda: Moneda.USD,
        },
      },
    },
    select: {
      descripcion: true,
      asiento: { select: { movimiento: { select: { monto: true } } } },
    },
  });

  const numTokens = new Set(factura.numero.split(/[\s—,;]+/).filter((t) => t.length > 0));
  let pagado = new Decimal(0);
  for (const l of lineasPago) {
    const desc = l.descripcion ?? "";
    const tokens = new Set(desc.split(/[\s—,;]+/).filter((t) => t.length > 0));
    const matchNumero = numTokens.size > 0 && [...numTokens].every((t) => tokens.has(t));
    const matchEmb = factura.embarqueCodigo !== null && tokens.has(factura.embarqueCodigo);
    if ((matchNumero || matchEmb) && l.asiento.movimiento) {
      pagado = pagado.plus(new Decimal(l.asiento.movimiento.monto.toString()));
    }
  }
  return pagado;
}
