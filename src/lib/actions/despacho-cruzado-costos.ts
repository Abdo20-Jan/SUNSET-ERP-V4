"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, toDecimal } from "@/lib/decimal";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import {
  crearCostoDespachoCruzadoSchema,
  type CrearCostoDespachoCruzadoInput,
} from "@/lib/actions/despacho-cruzado-costos-schema";

export type CrearCostoDespachoCruzadoResult =
  | { ok: true; embarqueCostoId: number }
  | { ok: false; error: string };

// Crea una factura de costo de nacionalización (EmbarqueCosto, momento=DESPACHO)
// en BORRADOR vinculada a un despacho cruzado en BORRADOR, dejándola ya linkada
// (despachoId seteado). NO emite asiento — la capitalización/contabilización de
// la factura DESPACHO ocurre al contabilizar el despacho (otro flujo). Acá sólo
// se persiste el documento + sus líneas para que el operador pueda cargar
// despachante/fletes/etc. directamente desde el editor de tributos del despacho.
export async function crearCostoDespachoCruzadoAction(
  input: CrearCostoDespachoCruzadoInput,
): Promise<CrearCostoDespachoCruzadoResult> {
  if (!isContenedorDesconsolidacionEnabled()) {
    return { ok: false, error: "La función de desconsolidación no está habilitada." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = crearCostoDespachoCruzadoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const data = parsed.data;

  try {
    const result = await db.$transaction(async (tx) => {
      const despacho = await tx.despacho.findUnique({
        where: { id: data.despachoId },
        select: {
          embarqueId: true,
          estado: true,
          items: { select: { itemContenedorId: true } },
        },
      });
      if (!despacho) {
        throw new DominioError("Despacho no existe.");
      }
      if (despacho.estado !== "BORRADOR") {
        throw new DominioError("El despacho ya fue contabilizado.");
      }
      const esCruzado = despacho.items.some((i) => i.itemContenedorId != null);
      if (!esCruzado) {
        throw new DominioError(
          "Este despacho no es cruzado — usá el formulario legacy para sus costos.",
        );
      }

      // Validar que el proveedor exista (FK explícita para mensaje claro).
      const proveedor = await tx.proveedor.findUnique({
        where: { id: data.proveedorId },
        select: { id: true },
      });
      if (!proveedor) {
        throw new DominioError("El proveedor no existe.");
      }

      const created = await tx.embarqueCosto.create({
        data: {
          embarqueId: despacho.embarqueId,
          despachoId: data.despachoId,
          proveedorId: data.proveedorId,
          moneda: data.moneda,
          tipoCambio: money(toDecimal(data.tipoCambio)),
          facturaNumero: data.facturaNumero,
          fechaFactura: data.fechaFactura,
          momento: "DESPACHO",
          estado: "BORRADOR",
          iva: money(toDecimal(data.iva)),
          iibb: money(toDecimal(data.iibb)),
          otros: money(toDecimal(data.otros)),
          notas: data.notas,
        },
      });

      await tx.embarqueCostoLinea.createMany({
        data: data.lineas.map((l) => ({
          embarqueCostoId: created.id,
          tipo: l.tipo,
          cuentaContableGastoId: l.cuentaContableGastoId,
          descripcion: l.descripcion,
          subtotal: money(toDecimal(l.subtotal)),
        })),
      });

      return { embarqueCostoId: created.id, embarqueId: despacho.embarqueId };
    });

    revalidatePath(`/comex/embarques/${result.embarqueId}/despachos`);
    revalidatePath(`/comex/embarques/${result.embarqueId}`);
    return { ok: true, embarqueCostoId: result.embarqueCostoId };
  } catch (err) {
    if (err instanceof DominioError) {
      return { ok: false, error: err.message };
    }
    console.error("crearCostoDespachoCruzadoAction failed", err);
    return { ok: false, error: "Error inesperado al crear el costo." };
  }
}

// Error de dominio interno: se mapea a `{ ok: false, error }`. No se exporta
// (un archivo "use server" sólo puede exportar funciones async).
class DominioError extends Error {}
