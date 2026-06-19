"use client";

import { RouteError } from "@/components/route-error";

export default function ComexError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} titulo="No se pudo cargar Comex" modulo="comex" />;
}
