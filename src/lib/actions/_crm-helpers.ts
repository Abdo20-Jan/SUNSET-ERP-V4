import "server-only";

import { requireSessionUser } from "@/lib/auth-guard";
import { isCrmEnabled } from "@/lib/features";

export type CrmAuthOk = { ok: true; userId: string };
export type CrmAuthErr = { ok: false; error: string };

export async function requireCrmAuth(): Promise<CrmAuthOk | CrmAuthErr> {
  if (!isCrmEnabled()) {
    return {
      ok: false,
      error: "CRM no está habilitado (flag CRM_ENABLED=false).",
    };
  }
  // Valida que el user del JWT siga existiendo y activo; si no, redirige a
  // /login con motivo claro (en vez de romper al escribir el ownerId).
  const userId = await requireSessionUser();
  return { ok: true, userId };
}

export function fdString(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export function fdStringOrUndefined(formData: FormData, name: string): string | undefined {
  const v = fdString(formData, name);
  return v.length > 0 ? v : undefined;
}

export function fdBool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}
