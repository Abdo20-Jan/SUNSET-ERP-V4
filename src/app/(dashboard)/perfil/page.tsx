import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

import { MonedaPreferidaForm } from "./_components/moneda-preferida-form";
import { ModoRetroactivoForm } from "./_components/modo-retroactivo-form";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="container mx-auto p-6">
        <p className="text-muted-foreground">No autorizado.</p>
      </main>
    );
  }

  const initial = session.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Mi perfil"
        description={`${session.user.nombre} · @${session.user.username}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferencias de reportes</CardTitle>
        </CardHeader>
        <CardContent>
          <MonedaPreferidaForm initial={initial} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Carga de documentos</CardTitle>
        </CardHeader>
        <CardContent>
          <ModoRetroactivoForm initial={modoRetroactivo} />
        </CardContent>
      </Card>
    </div>
  );
}
