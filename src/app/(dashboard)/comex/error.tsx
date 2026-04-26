"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ComexError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Comex route error", error);
  }, [error]);

  const isMissingColumn =
    error.message?.includes("column") &&
    error.message?.includes("does not exist");

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h1 className="text-lg font-semibold">No se pudo cargar Comex</h1>
          {isMissingColumn ? (
            <>
              <p className="text-sm text-muted-foreground">
                El esquema de la base de datos está desactualizado respecto al
                código desplegado. Esto pasa si se hizo un cambio de schema y
                aún no se aplicó la migración en Railway.
              </p>
              <pre className="rounded-md border bg-muted/40 p-3 text-xs">
                {`# Ejecutar localmente con tu DATABASE_URL apuntando a Railway:
DATABASE_URL="<railway-direct-url>" pnpm db:push --accept-data-loss`}
              </pre>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Detalle: {error.message}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <Button onClick={reset} size="sm">
              Reintentar
            </Button>
          </div>
          {error.digest && (
            <p className="pt-2 text-[10px] text-muted-foreground">
              digest: {error.digest}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
