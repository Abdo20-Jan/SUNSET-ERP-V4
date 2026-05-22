// Schema de validación del gasto (zod). Vive fuera de gastos.ts porque ese
// archivo es "use server" y sólo puede exportar funciones async — exportar el
// schema (un objeto) o el tipo desde allí rompe el build de Next (igual que
// embarque-schema.ts). Acá no hay "use server" ni dependencias de servidor
// (sólo zod + enums), así que el schema es reusable y testeable directamente.
import { z } from "zod";

import { CondicionPago, DeduccionGanancias, Moneda } from "@/generated/prisma/client";

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const lineaSchema = z.object({
  cuentaContableGastoId: z.number().int().positive("Seleccione cuenta de gasto"),
  descripcion: z.string().min(1, "Descripción requerida").max(200),
  subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
});

export const gastoInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    numero: z.string().min(1).max(32),
    proveedorId: z.string().uuid("Seleccione proveedor"),
    fecha: z.string().min(1, "Fecha requerida"),
    fechaVencimiento: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : null)),
    condicionPago: z.nativeEnum(CondicionPago),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    facturaNumero: z
      .string()
      .max(64)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    iva: z.string().regex(moneyRegex, "IVA inválido").default("0"),
    iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
    otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
    deducibleGanancias: z.nativeEnum(DeduccionGanancias).default("NETO"),
    notas: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lineas: z.array(lineaSchema).min(1, "Al menos una línea"),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
    if (data.fechaVencimiento) {
      if (new Date(data.fechaVencimiento) < new Date(data.fecha)) {
        ctx.addIssue({
          code: "custom",
          path: ["fechaVencimiento"],
          message: "Fecha de vencimiento no puede ser anterior a la factura",
        });
      }
    }
  });

export type GastoInput = z.input<typeof gastoInputSchema>;
