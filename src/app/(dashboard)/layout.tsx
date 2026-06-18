import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { AppTopnav } from "@/components/layout/app-topnav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  return (
    <div className="flex min-h-svh flex-col">
      <AppTopnav user={session.user} />
      {modoRetroactivo ? (
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          Modo retroactivo activo · las fechas no se autocompletan ·{" "}
          <Link href="/perfil" className="underline hover:text-amber-950">
            ajustar en perfil
          </Link>
        </div>
      ) : null}
      <main className="flex-1 px-4 py-3">{children}</main>
    </div>
  );
}
