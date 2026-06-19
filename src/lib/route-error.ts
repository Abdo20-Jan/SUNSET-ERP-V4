export type RouteErrorKind = "schema" | "generic";

/**
 * Clasifica el mensaje de error de un route boundary para decidir qué ayuda
 * mostrar. "schema" cubre el caso de schema de la DB desactualizado respecto al
 * código desplegado (columna inexistente / Prisma P2022); todo lo demás es
 * "generic".
 */
export function classifyRouteError(message: string | undefined): RouteErrorKind {
  if (!message) return "generic";
  const lower = message.toLowerCase();
  if (lower.includes("column") && lower.includes("does not exist")) return "schema";
  if (lower.includes("p2022")) return "schema";
  return "generic";
}
