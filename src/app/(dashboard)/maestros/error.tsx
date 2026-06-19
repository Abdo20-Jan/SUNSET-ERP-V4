"use client";

import { RouteError } from "@/components/route-error";

export default function ModuloError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} titulo="No se pudo cargar Maestros" modulo="maestros" />;
}
