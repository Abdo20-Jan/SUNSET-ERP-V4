"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Loading03Icon } from "@hugeicons/core-free-icons";

import { login } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Mensajes para el motivo con que el guard de sesión redirige a /login. Tras un
// reseed de la base, el id del JWT puede apuntar a un User inexistente; en vez
// de "Error inesperado" llevamos al usuario acá con una explicación clara.
const MENSAJES_MOTIVO: Record<string, string> = {
  "sesion-expirada": "Tu sesión expiró. Iniciá sesión nuevamente.",
  "sesion-invalida": "Tu sesión ya no es válida. Iniciá sesión nuevamente para continuar.",
  "usuario-inactivo": "Tu usuario está inactivo. Contactá a un administrador.",
};

function MotivoSesionAlert() {
  const motivo = useSearchParams().get("motivo");
  const mensaje = motivo ? MENSAJES_MOTIVO[motivo] : undefined;
  if (!mensaje) return null;
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <HugeiconsIcon icon={Alert02Icon} className="size-4" />
      {mensaje}
    </p>
  );
}

export default function LoginPage() {
  const [errorMessage, formAction, isPending] = useActionState(login, undefined);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sunset Tires ERP</CardTitle>
        <CardDescription>Iniciar sesión para continuar.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <Suspense fallback={null}>
            <MotivoSesionAlert />
          </Suspense>
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Usuario</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isPending}
            />
          </div>

          {errorMessage ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" />
              {errorMessage}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending} className="mt-2">
            {isPending ? <HugeiconsIcon icon={Loading03Icon} className="animate-spin" /> : null}
            Ingresar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
