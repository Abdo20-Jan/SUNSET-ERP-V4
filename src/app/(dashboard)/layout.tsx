import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { AppTopnav } from "@/components/layout/app-topnav";
import { resolveNavVariant, UI_NAV_COOKIE } from "@/lib/nav/nav-flag";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const variant = resolveNavVariant(cookieStore.get(UI_NAV_COOKIE)?.value);
  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  const retroBanner = modoRetroactivo ? (
    <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
      Modo retroactivo activo · las fechas no se autocompletan ·{" "}
      <Link href="/perfil" className="underline hover:text-amber-950">ajustar en perfil</Link>
    </div>
  ) : null;

  if (variant === "topnav") {
    return (
      <div className="flex min-h-svh flex-col">
        <AppTopnav user={session.user} />
        {retroBanner}
        <main className="flex-1 px-4 py-3">{children}</main>
      </div>
    );
  }

  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={session.user} />
      <SidebarInset>
        <AppHeader />
        {retroBanner}
        <main className="flex-1 px-4 py-3">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
