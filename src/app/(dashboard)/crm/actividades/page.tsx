import { auth } from "@/lib/auth";
import { listarActividadesPendientes } from "@/lib/actions/actividades";
import { isCrmEnabled } from "@/lib/features";

import { ActividadItem } from "./_components/actividad-item";

export default async function ActividadesPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Actividades</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const session = await auth();
  if (!session?.user.id) {
    return (
      <main className="container mx-auto p-6">
        <p>No autorizado.</p>
      </main>
    );
  }

  const actividades = await listarActividadesPendientes(session.user.id);
  const ahora = Date.now();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Mis actividades pendientes</h1>
        <p className="text-sm text-muted-foreground">{actividades.length} pendiente(s)</p>
      </header>

      {actividades.length === 0 ? (
        <p className="text-muted-foreground">Sin actividades pendientes.</p>
      ) : (
        <ul className="space-y-2">
          {actividades.map((a) => (
            <ActividadItem key={a.id} a={a} ahora={ahora} />
          ))}
        </ul>
      )}
    </main>
  );
}
