import "server-only";

import { auth } from "@/lib/auth";

/**
 * Devuelve el default para el campo `fecha` de un formulario de creación
 * de documento contable. Si el usuario tiene `modoRetroactivo` activo, el
 * default es vacío (forzar entrada consciente de la fecha del documento
 * físico). Caso contrario, hoy en formato yyyy-mm-dd.
 */
export async function getDefaultFecha(): Promise<string> {
  const session = await auth();
  if (session?.user.modoRetroactivo) return "";
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
