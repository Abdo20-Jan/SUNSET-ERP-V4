import { notFound } from "next/navigation";

import {
  listarProductosParaSimulacion,
  listarProveedoresParaSimulacion,
  obtenerSimulacionPorId,
} from "@/lib/actions/simulaciones-importacion";

import { SimulacionForm } from "../_components/simulacion-form";

type Params = Promise<{ id: string }>;

export default async function EditarSimulacionPage({ params }: { params: Params }) {
  const { id } = await params;

  const [simulacion, proveedores, productos] = await Promise.all([
    obtenerSimulacionPorId(id),
    listarProveedoresParaSimulacion(),
    listarProductosParaSimulacion(),
  ]);

  if (!simulacion) notFound();

  return (
    <SimulacionForm
      mode="edit"
      proveedores={proveedores}
      productos={productos}
      initialData={simulacion}
    />
  );
}
