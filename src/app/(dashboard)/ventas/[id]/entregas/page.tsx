import { redirect } from "next/navigation";

type PageParams = Promise<{ id: string }>;

// La lista de entregas dejó de ser una ruta propia: ahora es la tab "Entregas"
// del detalle de venta (NS-4 record-shell). Redirige para no romper links ni
// bookmarks. El alta sigue en /ventas/[id]/entregas/nueva.
export default async function EntregasPage({ params }: { params: PageParams }) {
  const { id } = await params;
  redirect(`/ventas/${id}?tab=entregas`);
}
