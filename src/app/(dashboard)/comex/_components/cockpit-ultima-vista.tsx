"use client";

/**
 * Polish read-only (PR-022d): "lembrar última vista" del Cockpit Comex.
 *
 * Persiste en `localStorage` la combinación de filtros activa (vista/proveedor/
 * ETA/estado + moneda) y, al abrir `/comex` SIN parámetros en la URL, restaura la
 * última vista guardada. 100% client, sin schema y sin mutación de servidor:
 * sólo lee/escribe `localStorage` y hace `router.replace` de la URL. Renderiza
 * `null` (efecto puro). El restore corre una sola vez por montaje.
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "comex-cockpit-ultima-vista";
const FILTRO_KEYS = ["vista", "proveedor", "eta_desde", "eta_hasta", "estado"] as const;

function leerUltimaVista(): string | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function persistirVista(hayFiltros: boolean, qs: string): void {
  try {
    if (hayFiltros && qs.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, qs);
    } else if (qs === "") {
      // Sólo se limpia cuando el usuario borró TODO (Limpiar). `moneda` suelto no toca la vista.
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    return;
  }
}

export function CockpitUltimaVista() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const montado = useRef(false);

  useEffect(() => {
    const qs = searchParams.toString();
    const hayFiltros = FILTRO_KEYS.some((k) => searchParams.get(k) != null);

    if (!montado.current) {
      montado.current = true;
      if (qs === "") {
        const guardada = leerUltimaVista();
        if (guardada) {
          router.replace(`${pathname}?${guardada}`);
          return;
        }
      }
    }

    persistirVista(hayFiltros, qs);
  }, [searchParams, pathname, router]);

  return null;
}
