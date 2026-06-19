"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { classifyRouteError } from "@/lib/route-error";

export function RouteError({
  error,
  reset,
  titulo = "No se pudo cargar la página",
  modulo,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  titulo?: string;
  modulo?: string;
}) {
  useEffect(() => {
    console.error(modulo ? `[${modulo}] route error` : "route error", error);
  }, [error, modulo]);

  const kind = classifyRouteError(error.message);

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h1 className="text-lg font-semibold">{titulo}</h1>
          {kind === "schema" ? (
            <p className="text-sm text-muted-foreground">
              El esquema de la base de datos está desactualizado respecto al código desplegado. Esto
              pasa cuando se cambió el schema y todavía hay migraciones pendientes de aplicar.
              Generá la migración con <code>pnpm db:migrate</code> y, al desplegar, se aplican
              automáticamente.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Detalle: {error.message}</p>
          )}
          <div className="flex gap-2 pt-2">
            <Button onClick={reset} size="sm">
              Reintentar
            </Button>
          </div>
          {error.digest && (
            <p className="pt-2 text-[10px] text-muted-foreground">digest: {error.digest}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
