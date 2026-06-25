import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { isTopNavEnabled } from "@/lib/features";
import { AppShell } from "@/components/layout/app-shell";
import { AppTopnav } from "@/components/layout/app-topnav";
import { ShellProvider } from "@/components/layout/shell-provider";
import { PermissionsProvider } from "@/components/auth/permissions-provider";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  // PR-007: expõe o snapshot de permissões do PR-006 (`session.user.permisos`) ao FE via um
  // provider client fino. Envolve ambos os shells; com RBAC OFF chega `undefined` e nada muda.
  if (isTopNavEnabled()) {
    // PR-002: novo global shell (top-nav + abas internas + busca) atrás de feature-flag.
    return (
      <PermissionsProvider permisos={session.user.permisos}>
        <AppShell user={session.user} modoRetroactivo={modoRetroactivo}>
          {children}
        </AppShell>
      </PermissionsProvider>
    );
  }

  // Flag OFF (default) → mantém o shell atual (ShellProvider + AppTopnav) intacto.
  return (
    <PermissionsProvider permisos={session.user.permisos}>
      <ShellProvider>
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
      </ShellProvider>
    </PermissionsProvider>
  );
}
