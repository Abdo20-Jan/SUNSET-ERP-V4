// Cálculo de Retención de Impuesto a las Ganancias (RG 830) que Sunset
// practica al PAGAR una factura de proveedor. Función PURA (sin I/O):
// recibe la base, el acumulado mensual previo, los datos fiscales del
// proveedor y el parámetro fiscal ya resuelto, y devuelve el importe a
// retener + el neto a pagar. La resolución del parámetro y del acumulado
// mensual la hace el caller (capa de aplicación, con I/O) — acá sólo se
// aplica la regla, para que sea testeable en aislamiento (como
// `percepcion-iibb.ts`).
//
// Criterio de base (decisión del negocio): la base sujeta es el TOTAL de
// la factura que se está pagando (neto + IVA + IIBB destacado), no el
// neto. El mínimo no sujeto de RG 830 es MENSUAL ACUMULADO por proveedor
// + concepto: se retiene sólo sobre el excedente que supera el mínimo
// dentro del mes calendario.
//
// Cortocircuitos (top-down) → retención 0:
//   1. Proveedor no sujeto a retención
//   2. Condición EXENTO
//   3. Condición MONOTRIBUTO (no sufre retención de Ganancias en v1)
//   4. Certificado de exclusión vigente (vigencia >= fecha de pago)
//   5. Sin concepto RG 830 asignado
//   6. Sin parámetro fiscal vigente para concepto + condición
//   7. Acumulado del mes (previo + actual) <= mínimo no sujeto

import { Decimal } from "decimal.js";
import type { CondicionGanancias, ConceptoRG830 } from "@/generated/prisma/client";

export type ParametroRetencionResuelto = {
  minimoNoSujeto: Decimal | string | number;
  montoFijo: Decimal | string | number;
  /** Alícuota en porcentaje (2 = 2%, 28 = 28%). */
  alicuota: Decimal | string | number;
};

export type ProveedorParaRetencionGanancias = {
  sujetoRetencionGanancias: boolean;
  condicionGanancias: CondicionGanancias;
  conceptoRG830: ConceptoRG830 | null;
  /** Override de alícuota (%) por certificado de reducción RG 830. */
  alicuotaRetencionGananciasOverride?: Decimal | string | number | null;
  certificadoExclusionGanancias?: string | null;
  vigenciaCertExclusionGanancias?: Date | null;
};

export type MotivoNoRetencion =
  | "NO_SUJETO"
  | "EXENTO"
  | "MONOTRIBUTO"
  | "CERT_EXCLUSION_VIGENTE"
  | "SIN_CONCEPTO"
  | "SIN_PARAMETRO"
  | "BAJO_MINIMO_MENSUAL";

export type ResultadoRetencionGanancias = {
  /** true sólo cuando hay un importe a retener > 0. */
  aplica: boolean;
  motivoNoAplica: MotivoNoRetencion | null;
  concepto: ConceptoRG830 | null;
  condicion: CondicionGanancias;
  /** Base sujeta de ESTA operación (total de la factura). */
  base: Decimal;
  baseAcumuladaMesPrevio: Decimal;
  minimoNoSujeto: Decimal;
  /** Porción de la base de esta operación que efectivamente se retiene. */
  baseExcedente: Decimal;
  montoFijo: Decimal;
  alicuota: Decimal;
  importeRetenido: Decimal;
  importeNetoAPagar: Decimal;
  detalleCalculo: string;
};

function d(v: Decimal | string | number | null | undefined): Decimal {
  if (v == null) return new Decimal(0);
  return new Decimal(v.toString());
}

function fmt(v: Decimal): string {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function calcularRetencionGanancias(args: {
  /** Total de la factura que se está pagando (gross). */
  base: Decimal | string | number;
  /** Suma de bases ya retenidas/pagadas en el mes (mismo proveedor + concepto). */
  baseAcumuladaMesPrevio?: Decimal | string | number | null;
  proveedor: ProveedorParaRetencionGanancias;
  parametro: ParametroRetencionResuelto | null;
  fechaPago: Date;
}): ResultadoRetencionGanancias {
  const { proveedor, parametro, fechaPago } = args;
  const base = d(args.base);
  const prev = d(args.baseAcumuladaMesPrevio);

  const baseSkeleton = {
    concepto: proveedor.conceptoRG830,
    condicion: proveedor.condicionGanancias,
    base,
    baseAcumuladaMesPrevio: prev,
  };

  const noAplica = (
    motivo: MotivoNoRetencion,
    detalle: string,
    extras?: Partial<ResultadoRetencionGanancias>,
  ): ResultadoRetencionGanancias => ({
    ...baseSkeleton,
    aplica: false,
    motivoNoAplica: motivo,
    minimoNoSujeto: extras?.minimoNoSujeto ?? new Decimal(0),
    baseExcedente: new Decimal(0),
    montoFijo: new Decimal(0),
    alicuota: extras?.alicuota ?? new Decimal(0),
    importeRetenido: new Decimal(0),
    importeNetoAPagar: base,
    detalleCalculo: detalle,
  });

  if (!proveedor.sujetoRetencionGanancias) {
    return noAplica("NO_SUJETO", "Proveedor no sujeto a retención de Ganancias.");
  }
  if (proveedor.condicionGanancias === "EXENTO") {
    return noAplica("EXENTO", "Proveedor exento de Ganancias.");
  }
  if (proveedor.condicionGanancias === "MONOTRIBUTO") {
    return noAplica("MONOTRIBUTO", "Proveedor monotributista — no sufre retención de Ganancias.");
  }
  if (
    proveedor.certificadoExclusionGanancias &&
    proveedor.vigenciaCertExclusionGanancias &&
    proveedor.vigenciaCertExclusionGanancias.getTime() >= fechaPago.getTime()
  ) {
    return noAplica(
      "CERT_EXCLUSION_VIGENTE",
      `Certificado de exclusión ${proveedor.certificadoExclusionGanancias} vigente — no se retiene.`,
    );
  }
  if (!proveedor.conceptoRG830) {
    return noAplica("SIN_CONCEPTO", "Proveedor sin concepto RG 830 asignado.");
  }
  if (!parametro) {
    return noAplica(
      "SIN_PARAMETRO",
      `Sin parámetro de retención vigente para ${proveedor.conceptoRG830} / ${proveedor.condicionGanancias}.`,
    );
  }

  const minimoNoSujeto = d(parametro.minimoNoSujeto);
  const montoFijoParam = d(parametro.montoFijo);
  const alicuota =
    proveedor.alicuotaRetencionGananciasOverride != null
      ? d(proveedor.alicuotaRetencionGananciasOverride)
      : d(parametro.alicuota);

  const acumuladoTotal = prev.plus(base);

  // Bajo el mínimo mensual acumulado → no se retiene todavía.
  if (acumuladoTotal.lte(minimoNoSujeto)) {
    return noAplica(
      "BAJO_MINIMO_MENSUAL",
      `Acumulado del mes ${fmt(acumuladoTotal)} no supera el mínimo no sujeto ${fmt(minimoNoSujeto)}.`,
      { minimoNoSujeto, alicuota },
    );
  }

  // Excedente imponible de ESTA operación = lo que supera el mínimo y aún
  // no fue gravado en pagos previos del mes.
  const baseExcedente = acumuladoTotal.minus(Decimal.max(minimoNoSujeto, prev));

  // El monto fijo de la escala (RG 830 Anexo VIII) se aplica una sola vez:
  // en el pago que cruza el mínimo del mes. Para alícuota plana (bienes 2%)
  // el monto fijo es 0, así que esto es exacto en el caso dominante.
  const cruzaUmbralAhora = prev.lt(minimoNoSujeto);
  const montoFijo = cruzaUmbralAhora ? montoFijoParam : new Decimal(0);

  const importeRetenido = montoFijo
    .plus(baseExcedente.mul(alicuota).div(100))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Defensa: si por redondeo/escala diera <= 0, no se retiene.
  if (importeRetenido.lte(0)) {
    return noAplica(
      "BAJO_MINIMO_MENSUAL",
      "Importe a retener no positivo tras aplicar la escala.",
      {
        minimoNoSujeto,
        alicuota,
      },
    );
  }

  const importeNetoAPagar = base.minus(importeRetenido);

  const detalleCalculo =
    `RG 830 — ${proveedor.conceptoRG830} (${proveedor.condicionGanancias}). ` +
    `Base ${fmt(base)}; acumulado mes previo ${fmt(prev)}; mínimo no sujeto ${fmt(minimoNoSujeto)}. ` +
    `Excedente gravado ${fmt(baseExcedente)} × ${alicuota.toString()}%` +
    (montoFijo.gt(0) ? ` + fijo ${fmt(montoFijo)}` : "") +
    ` = retención ${fmt(importeRetenido)}. Neto a pagar ${fmt(importeNetoAPagar)}.`;

  return {
    aplica: true,
    motivoNoAplica: null,
    concepto: proveedor.conceptoRG830,
    condicion: proveedor.condicionGanancias,
    base,
    baseAcumuladaMesPrevio: prev,
    minimoNoSujeto,
    baseExcedente,
    montoFijo,
    alicuota,
    importeRetenido,
    importeNetoAPagar,
    detalleCalculo,
  };
}
