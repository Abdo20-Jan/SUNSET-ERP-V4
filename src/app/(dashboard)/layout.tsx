import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={session.user} />
      <SidebarInset>
        <AppHeader />
        {modoRetroactivo ? (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
            Modo retroactivo activo · las fechas no se autocompletan ·{" "}
            <Link href="/perfil" className="underline hover:text-amber-950">
              ajustar en perfil
            </Link>
          </div>
        ) : null}
        <main className="flex-1 px-4 py-3">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
