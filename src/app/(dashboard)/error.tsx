"use client";

import { RouteError } from "@/components/route-error";

export default function DashboardError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} titulo="No se pudo cargar la página" />;
}
