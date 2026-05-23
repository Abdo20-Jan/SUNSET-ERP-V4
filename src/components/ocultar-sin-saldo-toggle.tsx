"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Alterna entre ocultar cuentas sin saldo (default) y mostrar todas, vía el
 * searchParam `todas`. La ausencia del param se interpreta como "solo con
 * saldo". Sigue el patrón de MonedaToggle.
 */
export function OcultarSinSaldoToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const mostrarTodas = searchParams.get("todas") === "1";

  const buildHref = (todas: boolean): string => {
    const next = new URLSearchParams(searchParams.toString());
    if (todas) next.set("todas", "1");
    else next.delete("todas");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
      <button
        type="button"
        onClick={() => router.push(buildHref(false))}
        className={cn(
          "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
          !mostrarTodas
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Solo con saldo
      </button>
      <button
        type="button"
        onClick={() => router.push(buildHref(true))}
        className={cn(
          "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
          mostrarTodas
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Todas las cuentas
      </button>
    </div>
  );
}
