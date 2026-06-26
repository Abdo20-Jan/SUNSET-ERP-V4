// Serializador determinístico para golden files do motor de rateio Comex
// (CRIT-04/05). Converte Decimal → string e Map → objeto, recursivamente,
// para travar a saída byte a byte via `toEqual`. NÃO é um arquivo de teste
// (fora do glob `*.test.ts`).

function esDecimalLike(value: object): value is { toString(): string } {
  return typeof (value as { toFixed?: unknown }).toFixed === "function";
}

export function serializeGolden(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) out[String(k)] = serializeGolden(v);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => serializeGolden(v));
  if (esDecimalLike(value)) return value.toString();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = serializeGolden((value as Record<string, unknown>)[k]);
  }
  return out;
}
