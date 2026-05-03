export function fdString(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export function fdStringOrUndefined(
  formData: FormData,
  name: string,
): string | undefined {
  const v = fdString(formData, name);
  return v.length > 0 ? v : undefined;
}

export function fdBool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export function fdNumber(formData: FormData, name: string, fallback: number): number {
  const v = formData.get(name);
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
