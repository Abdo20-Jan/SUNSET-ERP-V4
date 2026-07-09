import { redirect } from "next/navigation";

// PR-030 (CRM-01): la edición del lead vive ahora en el record
// (`/crm/leads/[id]`) dentro de una FloatingWorkWindow — esta ruta full-page
// queda como redirect por compatibilidad con links/bookmarks viejos
// (precedente: `ventas/[id]/entregas`).
export default async function EditarLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/crm/leads/${id}`);
}
