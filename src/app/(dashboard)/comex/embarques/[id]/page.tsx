import { notFound } from "next/navigation";

import {
  listarCuentasParaCostoLogistico,
  listarDepositosParaEmbarque,
  listarProductosParaEmbarque,
  listarProveedoresParaEmbarque,
  obtenerEmbarquePorId,
} from "@/lib/actions/embarques";
import { EmbarqueEstado } from "@/generated/prisma/client";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { EmbarqueForm } from "../_components/embarque-form";

type PageParams = Promise<{ id: string }>;

export const dynamic = "force-dynamic";

export default async function EditarEmbarquePage({ params }: { params: PageParams }) {
  const { id } = await params;

  const [embarque, proveedores, productos, depositos, cuentasGasto, defaultFecha] =
    await Promise.all([
      obtenerEmbarquePorId(id),
      listarProveedoresParaEmbarque(),
      listarProductosParaEmbarque(),
      listarDepositosParaEmbarque(),
      listarCuentasParaCostoLogistico(),
      getDefaultFecha(),
    ]);

  if (!embarque) notFound();

  const readonly = embarque.estado === EmbarqueEstado.CERRADO;

  return (
    <EmbarqueForm
      mode="edit"
      proveedores={proveedores}
      productos={productos}
      depositos={depositos}
      cuentasGasto={cuentasGasto}
      initialData={embarque}
      readonly={readonly}
      defaultFecha={defaultFecha}
    />
  );
}
