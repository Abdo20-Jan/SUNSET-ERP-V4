// Serializa un registro seleccionado (Prisma) a un objeto JSON-safe apto para
// AuditLog.datosAnteriores/datosNuevos. A diferencia del snapshot de Proveedor
// (todo String/Int), Venta y Asiento traen Decimal (Prisma.Decimal) y DateTime
// (Date), que NO son JSON-safe: Date → ISO, Decimal → string, escalares pasan
// directo. La detección de Decimal es por duck-typing (.toFixed) para mantener
// este helper puro y testeable en vitest node sin importar Prisma. Testeado.

type JsonScalar = string | number | boolean | null;

function esDecimal(value: object): value is { toString(): string } {
  return typeof (value as { toFixed?: unknown }).toFixed === "function";
}

export function serializarSnapshot(obj: Record<string, unknown>): Record<string, JsonScalar> {
  const out: Record<string, JsonScalar> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out[k] = null;
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (typeof v === "object") {
      out[k] = esDecimal(v) ? v.toString() : String(v);
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      // bigint, symbol, function — no esperados en un snapshot, pero serializa
      // a string para no romper el JSON.
      out[k] = String(v);
    }
  }
  return out;
}
