import { cn } from "@/lib/utils";
import { fmtMoney, convertirAUsd } from "@/lib/format";

type Mode = "signed" | "debit-column" | "credit-column" | "plain";

type MoneyAmountProps = {
  /** Valor numérico serializado como string (preserva precisão Decimal). */
  value: string;
  /**
   * - `signed` (default): positivo en verde con `+`, negativo en rojo con `($n)`, cero en muted.
   * - `debit-column`: solo renderiza si valor < 0; muestra valor absoluto en rojo (sin signo).
   * - `credit-column`: solo renderiza si valor > 0; muestra valor en verde (sin signo).
   * - `plain`: formato sin color, mantiene signo nativo.
   */
  mode?: Mode;
  /** Tipo de cambio para conversión a USD (opcional). */
  tcParaUsd?: string | null;
  /** Prefijo de moneda — ej: "$ ", "ARS ", "USD ". */
  symbol?: string;
  className?: string;
};

export function MoneyAmount({
  value,
  mode = "signed",
  tcParaUsd,
  symbol,
  className,
}: MoneyAmountProps) {
  const converted = convertirAUsd(value, tcParaUsd);
  const n = Number.parseFloat(converted);

  if (!Number.isFinite(n)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  const abs = fmtMoney(Math.abs(n).toFixed(2));
  const prefix = symbol ?? "";

  if (mode === "plain") {
    return (
      <span className={cn("font-mono tabular-nums", className)}>
        {prefix}
        {fmtMoney(converted)}
      </span>
    );
  }

  if (mode === "debit-column") {
    if (n >= 0) {
      return <span className={cn("text-muted-foreground/40", className)}>—</span>;
    }
    return (
      <span
        className={cn(
          "font-mono tabular-nums text-rose-700 dark:text-rose-400",
          className,
        )}
      >
        {prefix}
        {abs}
      </span>
    );
  }

  if (mode === "credit-column") {
    if (n <= 0) {
      return <span className={cn("text-muted-foreground/40", className)}>—</span>;
    }
    return (
      <span
        className={cn(
          "font-mono tabular-nums text-emerald-700 dark:text-emerald-400",
          className,
        )}
      >
        {prefix}
        {abs}
      </span>
    );
  }

  // mode === "signed"
  if (n === 0) {
    return (
      <span className={cn("font-mono tabular-nums text-muted-foreground", className)}>
        {prefix}
        {fmtMoney("0")}
      </span>
    );
  }
  if (n < 0) {
    return (
      <span
        className={cn(
          "font-mono tabular-nums text-rose-700 dark:text-rose-400",
          className,
        )}
      >
        ({prefix}
        {abs})
      </span>
    );
  }
  return (
    <span
      className={cn(
        "font-mono tabular-nums text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      + {prefix}
      {abs}
    </span>
  );
}
