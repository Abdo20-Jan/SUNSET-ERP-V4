// Schema de validación (zod) para crear una factura de costo de
// nacionalización (EmbarqueCosto, momento=DESPACHO) vinculada a un despacho
// cruzado en BORRADOR. Vive fuera de la action porque ese archivo es
// "use server" y sólo puede exportar funciones async — exportar el schema
// (un objeto) desde allí rompe el build de Next. Acá no hay "use server" ni
// dependencias de servidor (sólo zod + enums), así que el schema es reusable
// y testeable directamente.
import { z } from "zod";

import { Moneda, TipoCostoEmbarque } from "@/generated/prisma/client";

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const lineaSchema = z.object({
  tipo: z.nativeEnum(TipoCostoEmbarque).default(TipoCostoEmbarque.GASTOS_EXTRAS),
  cuentaContableGastoId: z.number().int().positive("Seleccione la cuenta de gasto"),
  descripcion: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
});

export const crearCostoDespachoCruzadoSchema = z
  .object({
    despachoId: z.string().min(1, "Despacho requerido"),
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
    facturaNumero: z
      .string()
      .max(64)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    fechaFactura: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    iva: z.string().regex(moneyRegex, "IVA inválido").default("0"),
    iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
    otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
    notas: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lineas: z.array(lineaSchema).min(1, "Agregue al menos un gasto"),
  })
  .superRefine((data, ctx) => {
    // El TC debe ser > 0 siempre (evita división/multiplicación degenerada).
    if (!(Number(data.tipoCambio) > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "El tipo de cambio debe ser mayor a 0",
      });
    }
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, tipo de cambio debe ser 1",
      });
    }
    if (data.moneda === Moneda.USD && !(Number(data.tipoCambio) > 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para USD, el tipo de cambio debe ser mayor a 1",
      });
    }
  });

export type CrearCostoDespachoCruzadoLineaInput = z.input<typeof lineaSchema>;
export type CrearCostoDespachoCruzadoInput = z.input<typeof crearCostoDespachoCruzadoSchema>;
