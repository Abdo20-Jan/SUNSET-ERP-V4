"use client";

/**
 * Badge que aparece al lado del DatePicker cuando la fecha elegida no es hoy.
 * Hace explícito que el documento se está cargando con fecha histórica para
 * que el operador note antes de guardar.
 */
export function RetroactivoBadge({ fecha }: { fecha: string | null | undefined }) {
  if (!fecha || fecha.trim() === "") return null;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  if (fecha === todayIso) return null;
  // formatear DD/MM/YYYY
  const [y, m, d] = fecha.split("-");
  if (!y || !m || !d) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
      Retroactivo: {d}/{m}/{y}
    </span>
  );
}
