"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type Moneda = "ARS" | "USD";

type Props = {
  current: Moneda;
  /** Datos para mostrar el TC vigente y permitir editarlo rápido. */
  tcInfo?: {
    valor: string;
    fecha: string; // YYYY-MM-DD
    fuente: string | null;
  } | null;
};

function buildHref(
  pathname: string,
  searchParams: URLSearchParams,
  moneda: Moneda,
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (moneda === "ARS") {
    next.delete("moneda");
  } else {
    next.set("moneda", "USD");
  }
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function MonedaToggle({ current, tcInfo }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const onClick = (m: Moneda) => {
    router.push(buildHref(pathname, new URLSearchParams(searchParams), m));
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
        <button
          type="button"
          onClick={() => onClick("ARS")}
          className={cn(
            "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
            current === "ARS"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          ARS
        </button>
        <button
          type="button"
          onClick={() => onClick("USD")}
          className={cn(
            "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
            current === "USD"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          disabled={!tcInfo && current !== "USD"}
          title={
            !tcInfo
              ? "Cargá una cotización en /maestros/cotizaciones para ver en USD"
              : undefined
          }
        >
          USD
        </button>
      </div>

      {current === "USD" && tcInfo ? (
        <span className="text-xs text-muted-foreground">
          1 USD ={" "}
          <span className="font-mono tabular-nums text-foreground">
            {Number(tcInfo.valor).toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
          </span>{" "}
          ARS · {tcInfo.fecha}
          {tcInfo.fuente ? ` · ${tcInfo.fuente}` : ""}
        </span>
      ) : null}

      <Link
        href="/maestros/cotizaciones"
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {tcInfo ? "Editar TC" : "Cargar TC del día"}
      </Link>
    </div>
  );
}
