import { cn } from "@/lib/utils";
import {
  fmtDateOrDash,
  vencimientoLabel,
  vencimientoStatus,
} from "@/lib/format";

type Props = {
  fecha: Date | string | null | undefined;
  /** Si true, muestra "Vence en X días" en lugar de la fecha cruda. */
  relative?: boolean;
  className?: string;
};

const STATUS_CLASS: Record<string, string> = {
  overdue:
    "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 border-red-300 dark:border-red-900",
  soon: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border-amber-300 dark:border-amber-900",
  ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-300 dark:border-emerald-900",
  none: "bg-muted/50 text-muted-foreground border-muted",
};

/**
 * Pílula de fecha con cores semánticas:
 * - rojo: vencida
 * - ámbar: vence en ≤7 días
 * - verde: ok (>7 días)
 * - gris: sin fecha
 */
export function DateBadge({ fecha, relative = false, className }: Props) {
  const status = vencimientoStatus(fecha);
  const label = relative ? vencimientoLabel(fecha) : fmtDateOrDash(fecha);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_CLASS[status] ?? STATUS_CLASS.none,
        className,
      )}
      title={fmtDateOrDash(fecha)}
    >
      {label}
    </span>
  );
}
