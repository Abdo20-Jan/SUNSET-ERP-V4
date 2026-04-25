import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DineroInput = Decimal.Value;

function toDecimal(value: DineroInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value.toString());
}

export const ALICUOTAS_IMPORTACION = {
  DIE: new Decimal("0.16"),
  TASA_ESTADISTICA: new Decimal("0.03"),
  ARANCEL_SIM: new Decimal("0.005"),
  IVA: new Decimal("0.21"),
  IVA_ADICIONAL: new Decimal("0.20"),
  GANANCIAS: new Decimal("0.06"),
  IIBB: new Decimal("0.025"),
} as const;

const TWO_DP = 2;

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
}

export function calcularCif(
  fobTotal: DineroInput,
  flete: DineroInput,
  seguro: DineroInput,
): Decimal {
  return round2(
    toDecimal(fobTotal).plus(toDecimal(flete)).plus(toDecimal(seguro)),
  );
}

export type TributosSugeridos = {
  die: Decimal;
  tasaEstadistica: Decimal;
  arancelSim: Decimal;
  baseTributaria: Decimal;
  iva: Decimal;
  ivaAdicional: Decimal;
  ganancias: Decimal;
  baseIibb: Decimal;
  iibb: Decimal;
};

export function calcularTributosSugeridos(
  cifTotal: DineroInput,
): TributosSugeridos {
  const cif = toDecimal(cifTotal);

  const die = round2(cif.times(ALICUOTAS_IMPORTACION.DIE));
  const tasaEstadistica = round2(
    cif.times(ALICUOTAS_IMPORTACION.TASA_ESTADISTICA),
  );
  const arancelSim = round2(cif.times(ALICUOTAS_IMPORTACION.ARANCEL_SIM));
  const baseTributaria = round2(cif.plus(die).plus(tasaEstadistica));
  const iva = round2(baseTributaria.times(ALICUOTAS_IMPORTACION.IVA));
  const ivaAdicional = round2(
    baseTributaria.times(ALICUOTAS_IMPORTACION.IVA_ADICIONAL),
  );
  const ganancias = round2(
    baseTributaria.times(ALICUOTAS_IMPORTACION.GANANCIAS),
  );
  const baseIibb = round2(baseTributaria.plus(iva));
  const iibb = round2(baseIibb.times(ALICUOTAS_IMPORTACION.IIBB));

  return {
    die,
    tasaEstadistica,
    arancelSim,
    baseTributaria,
    iva,
    ivaAdicional,
    ganancias,
    baseIibb,
    iibb,
  };
}

export type EmbarqueRateio = {
  fobTotal: DineroInput;
  flete: DineroInput;
  seguro: DineroInput;
  die: DineroInput;
  tasaEstadistica: DineroInput;
  arancelSim: DineroInput;
  gastosPortuarios: DineroInput;
  honorariosDespachante: DineroInput;
};

export type ItemRateioInput = {
  cantidad: number;
  precioUnitarioFob: DineroInput;
};

export type ItemRateioResult<T> = T & {
  fobItem: Decimal;
  costoTotal: Decimal;
  costoUnitario: Decimal;
};

// IVA, IVA Adicional, IIBB y Ganancias son créditos fiscales (Activo) y
// NO forman parte del costo de la mercadería; por eso no se ratean.
export function calcularRateioEmbarque<T extends ItemRateioInput>(
  embarque: EmbarqueRateio,
  items: readonly T[],
): Array<ItemRateioResult<T>> {
  if (items.length === 0) return [];

  const fobTotal = toDecimal(embarque.fobTotal);
  if (!fobTotal.gt(0)) {
    throw new Error("fobTotal debe ser > 0 para ratear");
  }

  const costoRateable = round2(
    fobTotal
      .plus(toDecimal(embarque.flete))
      .plus(toDecimal(embarque.seguro))
      .plus(toDecimal(embarque.die))
      .plus(toDecimal(embarque.tasaEstadistica))
      .plus(toDecimal(embarque.arancelSim))
      .plus(toDecimal(embarque.gastosPortuarios))
      .plus(toDecimal(embarque.honorariosDespachante)),
  );

  const lastIdx = items.length - 1;
  let acumulado = new Decimal(0);

  return items.map((item, idx) => {
    const fobItem = round2(
      toDecimal(item.precioUnitarioFob).times(item.cantidad),
    );

    let costoTotal: Decimal;
    if (idx === lastIdx) {
      // La última línea absorbe el residuo para que sum(costoTotal) === costoRateable.
      costoTotal = round2(costoRateable.minus(acumulado));
    } else {
      const proporcion = fobItem.dividedBy(fobTotal);
      costoTotal = round2(costoRateable.times(proporcion));
      acumulado = acumulado.plus(costoTotal);
    }

    const costoUnitario =
      item.cantidad > 0
        ? round2(costoTotal.dividedBy(item.cantidad))
        : new Decimal(0);

    return { ...item, fobItem, costoTotal, costoUnitario };
  });
}
