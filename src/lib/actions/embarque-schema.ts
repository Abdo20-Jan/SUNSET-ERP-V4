// Schema de validación del embarque (zod). Vive fuera de embarques.ts porque
// ese archivo es "use server" y sólo puede exportar funciones async — exportar
// el schema (un objeto) desde allí rompe el build de Next. Acá no hay "use
// server" ni dependencias de servidor (sólo zod + enums), así que el schema es
// reusable y testeable directamente.
import { z } from "zod";

import { EmbarqueEstado, Incoterm, Moneda, TipoCostoEmbarque } from "@/generated/prisma/client";

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const costoLineaSchema = z.object({
  tipo: z.nativeEnum(TipoCostoEmbarque),
  cuentaContableGastoId: z.number().int().positive("Seleccione la cuenta"),
  descripcion: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
});

const costoSchema = z.object({
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
  momento: z.enum(["ZONA_PRIMARIA", "DESPACHO"]).default("DESPACHO"),
  // IVA/IIBB/otros a nivel factura (no por línea)
  iva: z.string().regex(moneyRegex, "IVA inválido").default("0"),
  iibb: z.string().regex(moneyRegex, "IIBB inválido").default("0"),
  otros: z.string().regex(moneyRegex, "Otros inválido").default("0"),
  notas: z
    .string()
    .max(500)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  lineas: z.array(costoLineaSchema).min(1, "Agregue al menos un gasto"),
});

export type CostoEmbarqueLineaInput = z.input<typeof costoLineaSchema>;
export type CostoEmbarqueInput = z.input<typeof costoSchema>;

export const embarqueInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    codigo: z.string().min(1, "Código requerido").max(32),
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    depositoDestinoId: z.string().uuid("Seleccione un depósito de destino"),
    moneda: z.nativeEnum(Moneda),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
    incoterm: z
      .nativeEnum(Incoterm)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    lugarIncoterm: z
      .string()
      .max(80)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    // Valores informativos cuando incoterm = CIF (flete + seguro contratados
    // por el proveedor) o CFR (sólo flete). Vacíos = null.
    valorFleteOrigen: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine((v) => v === null || moneyRegex.test(v), "Valor de flete inválido"),
    valorSeguroOrigen: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
      .refine((v) => v === null || moneyRegex.test(v), "Valor de seguro inválido"),
    // Datos de transporte
    nombreBuque: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lineaMaritima: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    lugarTransbordo: z
      .string()
      .max(120)
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
    fechaEmpaque: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    fechaTransbordo: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    fechaSalida: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    fechaLlegada: z
      .string()
      .optional()
      .transform((v) => {
        if (!v || v.trim().length === 0) return null;
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
      }),
    diasPagoDespuesLlegada: z
      .union([z.number().int().min(0), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null || v === "") return null;
        const n = typeof v === "string" ? Number.parseInt(v, 10) : v;
        return Number.isFinite(n) && n >= 0 ? n : null;
      }),
    estado: z.nativeEnum(EmbarqueEstado),
    die: z.string().regex(moneyRegex, "Valor inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Valor inválido"),
    arancelSim: z.string().regex(moneyRegex, "Valor inválido"),
    iva: z.string().regex(moneyRegex, "Valor inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Valor inválido"),
    ganancias: z.string().regex(moneyRegex, "Valor inválido"),
    iibb: z.string().regex(moneyRegex, "Valor inválido"),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid("Seleccione un producto"),
          cantidad: z.number().int().positive("Cantidad > 0"),
          precioUnitarioFob: z.string().regex(moneyRegex, "Valor inválido"),
        }),
      )
      .min(1, "Agregue al menos un ítem"),
    costos: z.array(costoSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.estado === EmbarqueEstado.CERRADO) {
      ctx.addIssue({
        code: "custom",
        path: ["estado"],
        message: "Para cerrar el embarque utilice la acción 'Cerrar y Contabilizar'.",
      });
    }
    if (data.moneda === Moneda.ARS && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, tipo de cambio debe ser 1",
      });
    }
    // Gap #7: USD con TC=1 corrompe el arribo/costeo (costo unitario explota).
    if (data.moneda === Moneda.USD && !(Number(data.tipoCambio) > 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para USD, el tipo de cambio debe ser mayor a 1",
      });
    }
    data.costos.forEach((c, idx) => {
      if (c.moneda === Moneda.ARS && c.tipoCambio !== "1") {
        ctx.addIssue({
          code: "custom",
          path: ["costos", idx, "tipoCambio"],
          message: "Para ARS, tipo de cambio debe ser 1",
        });
      }
      if (c.moneda === Moneda.USD && !(Number(c.tipoCambio) > 1)) {
        ctx.addIssue({
          code: "custom",
          path: ["costos", idx, "tipoCambio"],
          message: "Para USD, el tipo de cambio debe ser mayor a 1",
        });
      }
    });
  });

export type GuardarEmbarqueInput = z.input<typeof embarqueInputSchema>;
